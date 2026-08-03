"""Learned card segmentation — the engine that handles overlapping cards.

The classical detector in ``card_splitter_v2`` reaches its ceiling when cards
overlap: a card that is partly hidden has no closed outline to trace, and its
visible part is an L-shape that no rectangle filter accepts. Measured on
synthetic scenes it recovers 97% of well-separated cards but only ~5% of
overlapping ones.

This module fills that gap with a small U-Net (see
``research/training/tiny_unet.py``) that predicts three classes per pixel —
background, card interior, card border. Predicting the border explicitly is what
separates the instances: two cards sharing an edge form one connected region
under a binary card/not-card mask, but their *interiors* are disconnected once
the border is carved out, so ordinary connected components recovers them one by
one.

The interior of an occluded card is a partial shape, so each component is
completed back to a full card rectangle before it is cropped — see
``_complete_to_card``. That keeps every crop the shape of a whole card, which is
what the existing suit and rank models were trained on, so nothing downstream
has to change to gain overlap support.

The weights are optional. If the file is missing the service runs the classical
engine instead, so a checkout without the model still works.
"""

from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Any

import cv2
import numpy as np

try:  # inside the service package
    from .card_splitter_v2 import (
        CARD_ASPECT,
        MAX_CARDS,
        CardQuad,
        _aspect_score,
        _merge_duplicates,
        _refine_quad_edges,
        order_points,
    )
except ImportError:  # standing alone, e.g. next to the file on Colab
    from card_splitter_v2 import (  # type: ignore
        CARD_ASPECT,
        MAX_CARDS,
        CardQuad,
        _aspect_score,
        _merge_duplicates,
        _refine_quad_edges,
        order_points,
    )

MODELS_DIR = Path(__file__).resolve().parent.parent.parent / "models"
# Overridable so the training notebook can score a freshly trained file, and so
# a deployment can point at weights mounted outside the image.
WEIGHTS_PATH = Path(os.environ.get("CARD_SEG_WEIGHTS")
                    or (MODELS_DIR / "card_seg_unet.pt"))


def set_weights_path(path: str | Path) -> None:
    """Point at a different weights file and drop any loaded model."""
    global WEIGHTS_PATH, _model, _load_failed
    WEIGHTS_PATH = Path(path)
    _model = None
    _load_failed = False


# Must match research/training/tiny_unet.py.
INPUT_W = 256
INPUT_H = 192
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)

LABEL_INTERIOR = 1
LABEL_BORDER = 2

_model: Any = None
_load_failed = False


def weights_available() -> bool:
    return WEIGHTS_PATH.is_file()


def _load():
    """Load the TorchScript module once per process."""
    global _model, _load_failed
    if _model is not None:
        return _model
    if _load_failed:
        raise RuntimeError("card segmentation weights previously failed to load")
    if not WEIGHTS_PATH.is_file():
        _load_failed = True
        raise FileNotFoundError(
            f"学習済みモデルが見つかりません: {WEIGHTS_PATH}\n"
            "research/notebooks/card_seg_synth_train.ipynb を Colab で実行して "
            "card_seg_unet.pt を作り、上記の場所に置いてください。"
            "（--engine auto なら学習モデル無しでも古典的手法で動きます）")
    try:
        import torch

        model = torch.jit.load(str(WEIGHTS_PATH), map_location="cpu")
        model.eval()
        _model = model
        return _model
    except Exception:
        _load_failed = True
        raise


def _predict(image: np.ndarray) -> np.ndarray:
    """Return the per-pixel class map at the network's own resolution."""
    import torch

    model = _load()
    resized = cv2.resize(image, (INPUT_W, INPUT_H), interpolation=cv2.INTER_AREA)
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    rgb = (rgb - MEAN) / STD
    tensor = torch.from_numpy(rgb).permute(2, 0, 1).unsqueeze(0)
    with torch.no_grad():
        logits = model(tensor)
    return logits.argmax(1)[0].cpu().numpy().astype(np.uint8)


def _axis_vectors(angle_deg: float) -> tuple[np.ndarray, np.ndarray]:
    """Unit vectors along a rotated rectangle's width and height axes."""
    rad = math.radians(angle_deg)
    along_w = np.array([math.cos(rad), math.sin(rad)], np.float32)
    along_h = np.array([-math.sin(rad), math.cos(rad)], np.float32)
    return along_w, along_h


def _occluded_side(label: np.ndarray, centre: np.ndarray, axis: np.ndarray,
                   half_extent: float, probe: float) -> int:
    """Which end of an axis the card continues under: -1, +1, or 0 if unclear.

    A card is cut short because another card lies on top of it, and that
    neighbour is itself card pixels. So the strip just beyond the cut end is
    full of interior/border labels, while the strip beyond a genuine card edge
    is background. Comparing the two ends says which way to grow — growing
    symmetrically instead would slide the reconstructed card sideways by half
    the hidden width and hand the rank model the wrong corner.
    """
    h, w = label.shape[:2]
    scores = []
    for sign in (-1.0, 1.0):
        base = centre + axis * sign * half_extent
        hits = total = 0
        for step in np.linspace(1.0, probe, 6):
            for lateral in np.linspace(-half_extent * 0.6, half_extent * 0.6, 7):
                perp = np.array([-axis[1], axis[0]], np.float32)
                p = base + axis * sign * step + perp * lateral
                x, y = int(round(p[0])), int(round(p[1]))
                if 0 <= x < w and 0 <= y < h:
                    total += 1
                    if label[y, x] != 0:
                        hits += 1
        scores.append(hits / total if total else 0.0)

    minus, plus = scores
    if abs(minus - plus) < 0.25:
        return 0
    return -1 if minus > plus else 1


def _complete_to_card(contour: np.ndarray,
                      label: np.ndarray | None = None) -> np.ndarray | None:
    """Fit a full card rectangle to a possibly partial component.

    An unoccluded card's component is already rectangular and the min-area
    rectangle is the answer. An occluded one is an L or a band, and its min-area
    rectangle is too small in whichever direction the neighbour cut into it. The
    card's aspect ratio is known exactly, so the deficient side is grown back to
    2.5:3.5 — the visible edges pin down the orientation and the two dimensions
    that survive, and the ratio supplies the one that didn't. Which *end* to grow
    from is decided by looking for the occluder (see ``_occluded_side``).
    """
    rect = cv2.minAreaRect(contour)
    (cx, cy), (rw, rh), angle = rect
    if rw <= 1 or rh <= 1:
        return None

    short, long = min(rw, rh), max(rw, rh)
    ratio = short / long
    new_short, new_long = short, long

    if ratio < CARD_ASPECT * 0.92:
        new_short = long * CARD_ASPECT          # neighbour ate into the short side
    elif ratio > CARD_ASPECT * 1.10:
        new_long = short / CARD_ASPECT          # the long side was clipped

    new_size = ((new_short, new_long) if rw <= rh else (new_long, new_short))
    centre = np.array([cx, cy], np.float32)

    grow_w = new_size[0] - rw
    grow_h = new_size[1] - rh
    if label is not None and (grow_w > 1e-3 or grow_h > 1e-3):
        along_w, along_h = _axis_vectors(angle)
        if grow_w > grow_h:
            side = _occluded_side(label, centre, along_w, rw / 2,
                                  max(grow_w, 2.0))
            centre = centre + along_w * side * (grow_w / 2)
        else:
            side = _occluded_side(label, centre, along_h, rh / 2,
                                  max(grow_h, 2.0))
            centre = centre + along_h * side * (grow_h / 2)

    box = cv2.boxPoints(((float(centre[0]), float(centre[1])), new_size,
                         angle)).astype(np.float32)
    return order_points(box)


def detect_cards_learned(image: np.ndarray, *, max_cards: int = MAX_CARDS,
                         debug: dict[str, Any] | None = None) -> list[CardQuad]:
    """Detect cards, including overlapping ones, with the trained segmenter."""
    h, w = image.shape[:2]
    label = _predict(image)

    interior = (label == LABEL_INTERIOR).astype(np.uint8)
    # Erode a little more: the network's border is a few pixels at 256x192, and
    # instances that still touch after it would merge back into one component.
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    seeds = cv2.morphologyEx(interior, cv2.MORPH_OPEN, k, iterations=1)

    n_labels, comp = cv2.connectedComponents(seeds, connectivity=4)
    scale_x, scale_y = w / INPUT_W, h / INPUT_H
    min_area = (INPUT_W * INPUT_H) * 0.004

    quads: list[CardQuad] = []
    for i in range(1, n_labels):
        blob = (comp == i).astype(np.uint8)
        if int(blob.sum()) < min_area:
            continue
        contours, _ = cv2.findContours(blob, cv2.RETR_EXTERNAL,
                                       cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        cnt = max(contours, key=cv2.contourArea)
        quad = _complete_to_card(cnt, label)
        if quad is None:
            continue

        # Occlusion shows up as a component much smaller than the card it sits
        # in; flag it so callers know the crop contains borrowed pixels.
        rect_area = cv2.contourArea(quad.astype(np.float32))
        occluded = rect_area > 0 and (cv2.contourArea(cnt) / rect_area) < 0.72

        full = quad * np.array([scale_x, scale_y], np.float32)
        q = CardQuad(corners=full.astype(np.float32),
                     sources={"unet"}, occluded=occluded)
        short, long = q.dims()
        q.aspect = short / long if long > 0 else 0.0
        q.extent = float(cv2.contourArea(cnt) / rect_area) if rect_area else 0.0
        q.score = 0.55 + 0.35 * _aspect_score(q.aspect)
        quads.append(q)

    quads = _merge_duplicates(quads, (h, w))
    quads = [q for q in quads if _aspect_score(q.aspect) > 0.25]

    # Snap onto real edges: the mask comes back at 256x192, so its outline is
    # several full-resolution pixels thick before this runs.
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    grad = cv2.magnitude(cv2.Scharr(gray, cv2.CV_32F, 1, 0),
                         cv2.Scharr(gray, cv2.CV_32F, 0, 1))
    for q in quads:
        q.corners = _refine_quad_edges(grad, q.corners)
        q._raster = None
        short, long = q.dims()
        q.aspect = short / long if long > 0 else 0.0

    quads.sort(key=lambda q: q.score, reverse=True)
    quads = quads[:max_cards]
    quads.sort(key=lambda q: float(q.center[0]))

    if debug is not None:
        debug["engine"] = "learned"
        debug["label_map"] = label
        debug["components"] = n_labels - 1
        debug["final"] = len(quads)

    return quads
