"""Recognition pipeline: split one photo into cards, recognise each in parallel.

The rank pipeline (multi-scan HOG+SVM+template) is combinatorially heavy — a
single card can take seconds. To keep a multi-card photo responsive we fan the
per-card work out across a ``ProcessPoolExecutor``. Each worker process loads the
torch + sklearn models exactly once (lazily, on its first task) and reuses them.
"""

from __future__ import annotations

import base64
import multiprocessing as mp
import os
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch
from PIL import Image

MODELS_DIR = Path(__file__).resolve().parent.parent.parent / "models"
SUIT_MODEL_PATH = MODELS_DIR / "suit_cnn.pth"
RANK_MODEL_PATH = MODELS_DIR / "rank_multiscan_hog_svm_v2.joblib"

# Per-worker lazily-initialised model singletons.
_suit_classifier = None
_rank_classifier = None


@dataclass
class CardResult:
    index: int
    rank: int | None          # 1..13 (1=A, 11=J, 12=Q, 13=K)
    suit: str                 # "c" | "d" | "h" | "s"
    rank_label: str           # "A".."K"
    card_code: str            # e.g. "13h" (asset name) or "?h" when rank unknown
    rank_confidence: float | None
    suit_confidence: float
    suit_margin: float        # how far the read suit leads the runner-up
    accepted: bool            # both models confident enough to auto-accept


# A suit read has to clear both bars to be recorded without asking. The margin
# does the real work — spades and clubs split the model's mass when it is unsure,
# so a wrong answer can hold a decent top probability while its runner-up sits
# right behind it. The floor is there for the rest: a leader under this is a coin
# toss whatever the gap.
#
# Calibrated against the sample photos: the one genuine misread had a margin of
# 0.11 and a near-coin-toss ace had 0.32, while every other card cleared 0.5.
SUIT_MIN_MARGIN = 0.35
SUIT_MIN_CONFIDENCE = 0.55


def suit_is_confident(suit_result: Any) -> bool:
    """Whether a suit read is decisive enough to record without confirmation."""
    return (suit_result.margin >= SUIT_MIN_MARGIN
            and suit_result.confidence >= SUIT_MIN_CONFIDENCE)


def _ensure_models() -> None:
    global _suit_classifier, _rank_classifier
    if _suit_classifier is None:
        from .suit_model import SuitClassifier
        device = torch.device("cpu")
        _suit_classifier = SuitClassifier(SUIT_MODEL_PATH, device)
    if _rank_classifier is None:
        from .rank_model import RankClassifier
        _rank_classifier = RankClassifier(RANK_MODEL_PATH)


def _recognize_one(args: tuple[int, bytes, bool]) -> dict[str, Any]:
    """Worker task: recognise a single card given its crop as PNG bytes."""
    index, png_bytes, debug = args
    _ensure_models()

    from .rank_model import rank_to_display

    # Decode the crop.
    array = np.frombuffer(png_bytes, dtype=np.uint8)
    bgr = cv2.imdecode(array, cv2.IMREAD_COLOR)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    pil = Image.fromarray(rgb)

    # Suit (PIL image) + rank (needs a file path).
    suit_result = _suit_classifier.predict(pil)

    tmp_path = Path("/tmp") / f"handhistory_card_{os.getpid()}_{index}.png"
    pil.save(tmp_path)
    try:
        rank_result = _rank_classifier.predict(tmp_path, debug=debug)
    finally:
        tmp_path.unlink(missing_ok=True)

    rank_label = rank_to_display(rank_result.rank)
    accepted = (rank_result.accepted and rank_result.rank is not None
                and suit_is_confident(suit_result))
    rank_code = str(rank_result.rank) if rank_result.rank is not None else "?"

    payload = asdict(CardResult(
        index=index,
        rank=rank_result.rank,
        suit=suit_result.code,
        rank_label=rank_label,
        card_code=f"{rank_code}{suit_result.code}",
        rank_confidence=rank_result.confidence,
        suit_confidence=suit_result.confidence,
        suit_margin=suit_result.margin,
        accepted=accepted,
    ))

    if debug:
        debug_payload = dict(rank_result.debug or {})
        # The straightened crop the classifiers actually saw, plus the suit
        # network's full distribution — the two things a wrong read is usually
        # explained by.
        debug_payload["card_crop"] = "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")
        debug_payload["suit_probabilities"] = {
            code: round(float(p), 4)
            for code, p in zip(_suit_classifier.class_names, suit_result.probabilities)
        }
        payload["debug"] = debug_payload

    return payload


# ── Executor singleton ──────────────────────────────────────────────────────
_executor: ProcessPoolExecutor | None = None


def get_executor() -> ProcessPoolExecutor:
    global _executor
    if _executor is None:
        # Leave a couple of cores for the web server / OS.
        workers = max(1, (os.cpu_count() or 2) - 1)
        # Use "spawn", not the default "fork": torch initialises thread pools
        # (OpenMP/MKL) in the parent, and forking after that deadlocks the child.
        # Spawn starts a clean interpreter that imports torch fresh in each worker.
        _executor = ProcessPoolExecutor(max_workers=workers, mp_context=mp.get_context("spawn"))
    return _executor


def _png_uri(image: np.ndarray) -> str | None:
    ok, buf = cv2.imencode(".png", image)
    if not ok:
        return None
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


def _splitter_debug(bgr: np.ndarray, quads: list[Any],
                    detect_debug: dict[str, Any]) -> dict[str, Any]:
    """The pictures the splitter would have written to disk, returned inline.

    Same three artefacts as the original research script — the source frame, the
    detection overlay and the mask the outlines came from — plus which engine ran
    and, when the learned one did, why it did or didn't.
    """
    annotated = bgr.copy()
    for i, card in enumerate(quads):
        box = card.corners.astype(np.int32)
        colour = (0, 165, 255) if card.occluded else (0, 255, 0)
        cv2.drawContours(annotated, [box], 0, colour, 3)
        x, y, _, _ = cv2.boundingRect(box)
        cv2.putText(annotated, f"card_{i + 1}", (x, max(y - 10, 20)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)

    # One mask picture: the union of the classical hypotheses, or the learned
    # label map rendered as background / interior / border.
    mask: np.ndarray | None = None
    masks = detect_debug.get("masks")
    if masks:
        for m in masks.values():
            mask = m if mask is None else cv2.bitwise_or(mask, m)
    else:
        label = detect_debug.get("label_map")
        if label is not None:
            mask = (label.astype(np.uint16) * 120).clip(0, 255).astype(np.uint8)

    return {
        "original": _png_uri(bgr),
        "annotated": _png_uri(annotated),
        "mask": _png_uri(mask) if mask is not None else None,
        "detected_count": len(quads),
        "engine": detect_debug.get("engine", "classic"),
        "fallback": detect_debug.get("fallback"),
        "candidates": [
            {
                "index": i,
                "area": round(float(c.area), 1),
                "aspect_ratio": round(float(c.aspect), 3),
                "extent": round(float(c.extent), 3),
                # Kept for the existing debug view. The rewritten detector scores
                # candidates on edge evidence rather than counting polygon
                # vertices, so this reports that score instead.
                "vertices": int(round(c.edge_support * 100)),
                "score": round(float(c.score), 3),
                "occluded": bool(c.occluded),
                "sources": sorted(c.sources),
            }
            for i, c in enumerate(quads)
        ],
    }


def recognize_image(
    image_bytes: bytes,
    expected_count: int | None = None,
    debug: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Split ``image_bytes`` into cards and recognise each.

    Pass ``expected_count`` when the caller knows how many cards are in frame —
    the live scanner does — so only that many candidates are kept and a phone or
    a hand in shot cannot be served up as an extra card.

    Returns (cards in reading order, splitter debug or None).
    """
    from . import card_splitter_v2 as splitter

    array = np.frombuffer(image_bytes, dtype=np.uint8)
    bgr = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("Could not decode the uploaded image")

    detect_debug: dict[str, Any] = {}
    quads = splitter.detect_cards(
        bgr,
        engine=os.environ.get("CARD_SPLIT_ENGINE", "auto"),
        max_cards=expected_count or splitter.MAX_CARDS,
        debug=detect_debug,
    )
    scene_debug = _splitter_debug(bgr, quads, detect_debug) if debug else None

    # 600x900 matches the rank pipeline's own normalisation size; cropping
    # straight to it keeps the glyphs at the resolution that model was trained on.
    crops = [splitter.warp_card(bgr, q, (splitter.CARD_W, splitter.CARD_H))
             for q in quads]
    if not crops:
        return [], scene_debug

    # Encode each crop to PNG bytes for cross-process transfer.
    tasks = []
    for i, crop in enumerate(crops):
        ok, buf = cv2.imencode(".png", crop)
        if not ok:
            raise RuntimeError("Failed to encode a card crop")
        tasks.append((i, buf.tobytes(), debug))

    executor = get_executor()
    results = list(executor.map(_recognize_one, tasks))
    results.sort(key=lambda r: r["index"])
    return results, scene_debug


def detect_boxes(image_bytes: bytes) -> list[dict[str, Any]]:
    """Fast detection only — return card bounding quads, no rank/suit inference.

    Cheap enough (~tens of ms) to poll from the live camera preview so the UI can
    draw a frame over each card it currently sees. Quads are returned in the
    ORIGINAL image's pixel coordinates, normalised to 0..1 so the client can map
    them onto the video element regardless of resolution.

    Deliberately still on the original lightweight detector: this endpoint is
    polled every 220ms and only needs a card count and rough outlines to drive
    the stillness check, so it is not worth the accuracy engine's latency. The
    accurate split runs once, in ``recognize_image``, after the shutter fires.
    """
    from .card_splitter import detect_card_regions

    array = np.frombuffer(image_bytes, dtype=np.uint8)
    bgr = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("Could not decode the uploaded image")

    h, w = bgr.shape[:2]
    selected, _ = detect_card_regions(bgr)

    boxes = []
    for i, card in enumerate(selected):
        quad = card["box"].astype(float)  # 4 points, clockwise from top-left
        boxes.append({
            "index": i,
            "quad": [[float(x) / w, float(y) / h] for x, y in quad],
        })
    return boxes
