"""Synthesise labelled multi-card scenes from single-card photos.

Why synthesise
--------------
Separating cards that touch or overlap needs a learned segmenter, and training
one needs images labelled at pixel level. Hand-labelling those is exactly the
work this project is trying to remove, and the dataset we have is 363 photos of
*one* card each — no overlap to learn from.

The way out is to build the training set out of the real photos. Every
single-card photo yields two things the classical detector can extract reliably
(one well-separated card is its easy case): the card, flattened, and the table
it was lying on with the card painted out. Recombining those gives scenes with
real card printing, real table texture and real lighting, arranged into the
touching and overlapping layouts the dataset lacks — and because we place the
cards ourselves, every pixel of the label is exact and free.

Nothing here uses the app's display artwork; the source material is only ever
the photographs.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

import cv2
import numpy as np

# Flattened source cards are kept at this size: big enough that a scene card is
# usually downscaled (which hides resampling softness) and small enough to hold
# a few hundred of them in memory at once.
SOURCE_CARD_W = 320
SOURCE_CARD_H = 448

# Corner radius of a real card, as a fraction of its short side.
CORNER_RADIUS_FRAC = 0.055

CARD_ASPECT = 2.5 / 3.5

# Label ids for the segmentation target.
LABEL_BACKGROUND = 0
LABEL_INTERIOR = 1
LABEL_BORDER = 2


@dataclass
class SceneCard:
    """One card placed in a synthetic scene."""

    quad: np.ndarray          # (4, 2) float32 corners in scene coordinates
    visible: np.ndarray       # uint8 mask of the parts not covered by later cards
    full: np.ndarray          # uint8 mask of the whole card, occlusion ignored

    @property
    def visible_fraction(self) -> float:
        total = int(np.count_nonzero(self.full))
        if total == 0:
            return 0.0
        return int(np.count_nonzero(self.visible)) / total


@dataclass
class Scene:
    image: np.ndarray
    cards: list[SceneCard]

    def label_map(self, border_px: int = 3) -> np.ndarray:
        return build_label_map(self.cards, self.image.shape[:2], border_px)


# ---------------------------------------------------------------------------
# Source material
# ---------------------------------------------------------------------------

def rounded_card_alpha(w: int, h: int,
                       radius_frac: float = CORNER_RADIUS_FRAC) -> np.ndarray:
    """Alpha matte with a real card's rounded corners, anti-aliased."""
    ss = 4  # supersample, then average down for a soft edge
    W, H = w * ss, h * ss
    r = int(round(min(W, H) * radius_frac))
    m = np.zeros((H, W), np.uint8)
    cv2.rectangle(m, (r, 0), (W - r, H), 255, -1)
    cv2.rectangle(m, (0, r), (W, H - r), 255, -1)
    for cx, cy in ((r, r), (W - r, r), (r, H - r), (W - r, H - r)):
        cv2.circle(m, (cx, cy), r, 255, -1)
    return cv2.resize(m, (w, h), interpolation=cv2.INTER_AREA)


def _splitter():
    """Import the detector, whether we're in the repo or standing alone.

    In the repo it lives with the recognition service so the app and the tools
    can never drift apart. On Colab the notebook drops the same file next to
    this one, so a plain import finds it there instead.
    """
    import sys

    try:
        import card_splitter_v2 as v2  # type: ignore
        return v2
    except ImportError:
        pass
    service = Path(__file__).resolve().parents[2] / "services" / "recognition"
    if str(service) not in sys.path:
        sys.path.insert(0, str(service))
    from app.recognition import card_splitter_v2 as v2  # type: ignore
    return v2


def extract_card_and_plate(photo: np.ndarray) -> tuple[np.ndarray, "Plate"] | None:
    """Split a single-card photo into (flattened card, table with card removed).

    Returns None when the detector doesn't find exactly one convincing card, so
    a bad source photo drops out of the dataset instead of poisoning it.
    """
    v2 = _splitter()
    quads = v2.detect_cards_classic(photo, max_cards=2)
    if len(quads) != 1:
        return None
    quad = quads[0]
    short, long = quad.dims()
    if long <= 0 or not (0.55 <= short / long <= 0.92):
        return None

    card = v2.warp_card(photo, quad, (SOURCE_CARD_W, SOURCE_CARD_H))

    # Paint the card out of the photo so what remains is pure table. The mask is
    # dilated well past the card so the drop shadow goes with it — a shadow left
    # behind would be baked into every scene built on this plate.
    h, w = photo.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    grown = v2.expand_quad(quad.corners, ratio=0.22)
    cv2.fillConvexPoly(mask, grown.astype(np.int32), 255)
    plate = cv2.inpaint(photo, mask, 9, cv2.INPAINT_TELEA)

    return card, Plate(image=plate, hole=mask)


@dataclass
class Plate:
    """A photographed table surface, and where the card used to be.

    Inpainting leaves a smear where the card was removed. Keeping the hole mask
    lets scene composition crop *around* it, so scenes are built on genuine
    table texture instead of on the repair.
    """

    image: np.ndarray
    hole: np.ndarray

    def sample(self, w: int, h: int, rng: np.random.Generator,
               tries: int = 12) -> np.ndarray:
        ph, pw = self.image.shape[:2]
        want = w / h
        best: np.ndarray | None = None
        best_cost = np.inf
        for _ in range(tries):
            ch = int(rng.uniform(0.5, 1.0) * ph)
            cw = int(ch * want)
            if cw > pw:
                cw = pw
                ch = int(cw / want)
            if ch < 16 or cw < 16:
                continue
            y = int(rng.integers(0, max(1, ph - ch + 1)))
            x = int(rng.integers(0, max(1, pw - cw + 1)))
            cost = float(self.hole[y:y + ch, x:x + cw].mean())
            if cost < best_cost:
                best_cost = cost
                best = self.image[y:y + ch, x:x + cw]
                if cost < 1.0:
                    break
        if best is None:
            best = self.image
        return cv2.resize(best, (w, h), interpolation=cv2.INTER_AREA)


def load_sources(photo_paths: Iterable[Path], *, limit: int | None = None,
                 progress: bool = True) -> tuple[list[np.ndarray], list[Plate]]:
    """Build the card and background-plate pools from single-card photos."""
    cards: list[np.ndarray] = []
    plates: list[Plate] = []
    paths = list(photo_paths)
    if limit is not None:
        paths = paths[:limit]
    for i, p in enumerate(paths):
        img = cv2.imread(str(p))
        if img is None:
            continue
        got = extract_card_and_plate(img)
        if got is None:
            continue
        card, plate = got
        cards.append(card)
        plates.append(plate)
        if progress and (i + 1) % 25 == 0:
            print(f"  {i + 1}/{len(paths)} photos -> {len(cards)} cards")
    return cards, plates


# ---------------------------------------------------------------------------
# Photometric effects
# ---------------------------------------------------------------------------

def _apply_shading(card: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """A soft linear light gradient across the card."""
    h, w = card.shape[:2]
    angle = rng.uniform(0, 2 * math.pi)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    ramp = (math.cos(angle) * xx / w) + (math.sin(angle) * yy / h)
    ramp = (ramp - ramp.min()) / (float(ramp.max() - ramp.min()) + 1e-6)
    strength = rng.uniform(0.06, 0.30)
    gain = (1.0 - strength / 2) + ramp * strength
    return np.clip(card.astype(np.float32) * gain[..., None], 0, 255).astype(np.uint8)


def _apply_glare(card: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Blow out an elliptical patch, the way a ceiling light reflects off gloss.

    This is the failure the whiteness-threshold splitter could never survive, so
    the segmenter has to meet it constantly during training.
    """
    h, w = card.shape[:2]
    spot = np.zeros((h, w), np.float32)
    for _ in range(rng.integers(1, 3)):
        cx = int(rng.uniform(0, w))
        cy = int(rng.uniform(0, h))
        ax = int(rng.uniform(w * 0.12, w * 0.55))
        ay = int(rng.uniform(h * 0.08, h * 0.40))
        cv2.ellipse(spot, (cx, cy), (ax, ay),
                    float(rng.uniform(0, 180)), 0, 360, 1.0, -1)
    spot = cv2.GaussianBlur(spot, (0, 0), sigmaX=max(w, h) * 0.06)
    strength = rng.uniform(60, 165)
    out = card.astype(np.float32) + spot[..., None] * strength
    return np.clip(out, 0, 255).astype(np.uint8)


def _perspective_quad(w: float, h: float, rng: np.random.Generator) -> np.ndarray:
    """Corners of a card seen from a slightly off-axis camera."""
    jitter = min(w, h) * rng.uniform(0.0, 0.085)
    base = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float32)
    return base + rng.uniform(-jitter, jitter, size=(4, 2)).astype(np.float32)


def _rotate(points: np.ndarray, deg: float) -> np.ndarray:
    rad = math.radians(deg)
    c, s = math.cos(rad), math.sin(rad)
    r = np.array([[c, -s], [s, c]], np.float32)
    return points @ r.T


# ---------------------------------------------------------------------------
# Scene composition
# ---------------------------------------------------------------------------

def _layout_positions(n: int, card_w: float, card_h: float,
                      rng: np.random.Generator,
                      mode: str) -> list[tuple[np.ndarray, float]]:
    """Centres and rotations for n cards under one of the layout styles."""
    out: list[tuple[np.ndarray, float]] = []

    if mode == "row_gap":
        gap = card_w * rng.uniform(0.14, 0.5)
    elif mode == "row_touch":
        # Edges within a hair of each other — the case a merged contour ruins.
        gap = card_w * rng.uniform(-0.01, 0.02)
    elif mode == "row_overlap":
        gap = -card_w * rng.uniform(0.18, 0.55)
    else:  # "fan" — the way hole cards are actually held
        gap = -card_w * rng.uniform(0.30, 0.62)

    total = n * card_w + (n - 1) * gap
    x = -total / 2 + card_w / 2
    base_tilt = rng.uniform(-14, 14)
    for i in range(n):
        if mode == "fan":
            rot = base_tilt + (i - (n - 1) / 2) * rng.uniform(6, 17)
            dy = abs(i - (n - 1) / 2) * card_h * rng.uniform(0.0, 0.05)
        else:
            rot = base_tilt + rng.uniform(-5, 5)
            dy = rng.uniform(-card_h * 0.05, card_h * 0.05)
        out.append((np.array([x, dy], np.float32), rot))
        x += card_w + gap
    return out


def compose_scene(cards: Sequence[np.ndarray], plates: Sequence[Plate],
                  rng: np.random.Generator, *,
                  size: tuple[int, int] = (640, 480),
                  n_cards: int | None = None,
                  mode: str | None = None) -> Scene:
    """Build one labelled scene. `size` is (width, height)."""
    W, H = size
    plate = plates[int(rng.integers(len(plates)))]
    bg = plate.sample(W, H, rng)
    if rng.random() < 0.5:
        bg = cv2.flip(bg, int(rng.integers(-1, 2)))

    n = int(n_cards if n_cards is not None else rng.integers(2, 6))
    mode = mode or str(rng.choice(["row_gap", "row_touch", "row_overlap", "fan"],
                                  p=[0.40, 0.24, 0.18, 0.18]))

    # Size the cards so n of them comfortably fit the frame.
    max_w = W / (n * 0.85 + 0.6)
    card_w = float(rng.uniform(max_w * 0.55, max_w))
    card_w = min(card_w, H * CARD_ASPECT * 0.82)
    card_h = card_w / CARD_ASPECT

    placements = _layout_positions(n, card_w, card_h, rng, mode)
    scene_center = np.array([W / 2, H / 2], np.float32)
    scene_center += rng.uniform(-0.06, 0.06, size=2).astype(np.float32) * [W, H]

    canvas = bg.copy()
    fulls: list[np.ndarray] = []
    quads: list[np.ndarray] = []

    for i, (offset, rot) in enumerate(placements):
        src = cards[int(rng.integers(len(cards)))]
        src = cv2.resize(src, (int(card_w * 1.4), int(card_h * 1.4)),
                         interpolation=cv2.INTER_AREA)
        if rng.random() < 0.5:
            src = cv2.rotate(src, cv2.ROTATE_180)
        src = _apply_shading(src, rng)
        if rng.random() < 0.45:
            src = _apply_glare(src, rng)
        alpha = rounded_card_alpha(src.shape[1], src.shape[0])

        local = _perspective_quad(card_w, card_h, rng)
        local -= local.mean(axis=0)
        dst = _rotate(local, rot) + scene_center + offset

        sh, sw = src.shape[:2]
        src_quad = np.array([[0, 0], [sw, 0], [sw, sh], [0, sh]], np.float32)
        m = cv2.getPerspectiveTransform(src_quad, dst.astype(np.float32))
        warped = cv2.warpPerspective(src, m, (W, H), flags=cv2.INTER_LINEAR)
        warped_a = cv2.warpPerspective(alpha, m, (W, H), flags=cv2.INTER_LINEAR)

        full = (warped_a > 127).astype(np.uint8)
        if int(full.sum()) < 200:
            continue

        # Drop shadow, offset the way a card lifts slightly off the table.
        shadow = cv2.GaussianBlur(warped_a.astype(np.float32) / 255.0, (0, 0),
                                  sigmaX=max(3.0, card_w * 0.035))
        sx, sy = int(card_w * rng.uniform(0.01, 0.05)), int(card_h * rng.uniform(0.01, 0.05))
        shadow = np.roll(np.roll(shadow, sy, axis=0), sx, axis=1)
        shadow *= rng.uniform(0.15, 0.42)
        canvas = np.clip(canvas.astype(np.float32) * (1.0 - shadow[..., None]),
                         0, 255).astype(np.uint8)

        a = (warped_a.astype(np.float32) / 255.0)[..., None]
        canvas = np.clip(canvas.astype(np.float32) * (1 - a)
                         + warped.astype(np.float32) * a, 0, 255).astype(np.uint8)

        fulls.append(full)
        quads.append(dst.astype(np.float32))

    # Later cards occlude earlier ones; recover what each one still shows.
    scene_cards: list[SceneCard] = []
    for i, (full, quad) in enumerate(zip(fulls, quads)):
        covered = np.zeros_like(full)
        for later in fulls[i + 1:]:
            covered |= later
        visible = (full & (1 - covered)).astype(np.uint8)
        card = SceneCard(quad=quad, visible=visible, full=full)
        # A card buried past recognition isn't a label, it's noise.
        if card.visible_fraction >= 0.18:
            scene_cards.append(card)

    canvas = _finish(canvas, rng)
    return Scene(image=canvas, cards=scene_cards)


def _finish(img: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Whole-frame camera effects: exposure, white balance, blur, noise, JPEG."""
    out = img.astype(np.float32)
    out *= rng.uniform(0.72, 1.24)                       # exposure
    out *= rng.uniform(0.94, 1.06, size=3)               # white balance
    out = np.clip(out, 0, 255).astype(np.uint8)

    if rng.random() < 0.55:
        k = int(rng.integers(1, 3)) * 2 + 1
        out = cv2.GaussianBlur(out, (k, k), 0)
    if rng.random() < 0.6:
        noise = rng.normal(0, rng.uniform(1.5, 7.0), out.shape)
        out = np.clip(out.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    if rng.random() < 0.6:
        q = int(rng.integers(45, 92))
        ok, enc = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, q])
        if ok:
            out = cv2.imdecode(enc, cv2.IMREAD_COLOR)
    return out


def build_label_map(cards: Sequence[SceneCard], shape: tuple[int, int],
                    border_px: int = 3) -> np.ndarray:
    """Three-class target: background, card interior, card border.

    The border class is what makes touching cards separable. Predicting "card"
    alone would merge two cards sharing an edge into one blob — the very failure
    being fixed. Carving a thin border out of every instance leaves the interiors
    disconnected, so plain connected components recovers them one by one.
    """
    h, w = shape
    label = np.zeros((h, w), np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                  (border_px * 2 + 1, border_px * 2 + 1))
    borders = np.zeros((h, w), np.uint8)
    interiors = np.zeros((h, w), np.uint8)
    for c in cards:
        vis = c.visible
        eroded = cv2.erode(vis, k, iterations=1)
        borders |= (vis & (1 - eroded)).astype(np.uint8)
        interiors |= eroded
    label[interiors > 0] = LABEL_INTERIOR
    label[borders > 0] = LABEL_BORDER
    return label


def generate_dataset(cards: Sequence[np.ndarray], plates: Sequence[Plate],
                     count: int, *, seed: int = 0,
                     size: tuple[int, int] = (640, 480),
                     border_px: int = 3,
                     progress: bool = True):
    """Yield (image, label_map, scene) tuples."""
    rng = np.random.default_rng(seed)
    for i in range(count):
        scene = compose_scene(cards, plates, rng, size=size)
        if not scene.cards:
            continue
        yield scene.image, scene.label_map(border_px), scene
        if progress and (i + 1) % 200 == 0:
            print(f"  generated {i + 1}/{count}")
