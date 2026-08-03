"""Card detection v2 — the shared detection core for the app and the CLI.

Why this exists
---------------
The original ``card_splitter_first.py`` finds cards by tracing Canny edges, and
``card_splitter_revenge.py`` finds them by thresholding "white". Both fail in
ways that are structural, not tuning problems:

* A white card on a bright wooden table has a *weak* outer edge, while a face
  card's printed inner frame has a *strong* one — so the edge tracer returns the
  inner frame and the crop is the middle of the K instead of the whole card.
* Specular highlights on the table are white, and so is the card's own face, so
  a "whiteness" threshold cannot separate them even in principle.
* Two cards laid touching merge into one contour whose bounding box is
  5.0 x 3.5 card-units — an aspect ratio of 1.428 against a single card's 1.400.
  The two are 2% apart, so *no* aspect-ratio filter can tell them apart. The
  merged blob sails through the filter and gets cropped as a single card.

Neither program uses the two facts that make this problem easy: a playing card
is a rounded rectangle with a fixed 2.5:3.5 aspect ratio, and every card in one
photo is the same physical size. This module is built around them.

The approach
------------
1. **Segment "not the table", not "white".** The table is a large, roughly
   uniform region; sample it from the image border and segment by colour
   distance from it, weighting chroma over lightness so glare doesn't matter.
2. **Propose from several independent binarisations and union the results.**
   No single threshold survives every lighting condition; a candidate only has
   to be found by one of them.
3. **Score candidates against the card prior** — aspect ratio, rectangularity,
   and how much real image gradient actually sits under the quad's four edges.
4. **Kill inner frames** by containment: a quad strictly inside a plausible card
   quad is a printed frame, not a card.
5. **Split merged blobs by rectifying first.** Warp the blob flat, and the seams
   between touching cards become exactly axis-parallel lines that a projection
   profile finds reliably. (This is what ``revenge.py`` attempted, but it ran the
   projection on the raw perspective image where seams are neither straight nor
   vertical.)
6. **Enforce one card size per photo.** The median accepted card size rejects
   both the too-small (inner frames) and the too-large (unsplit merges).

Everything here is classical CV with no learned weights, so it runs anywhere
OpenCV does. The optional learned engine (see ``card_seg_model.py``) plugs in as
a better *proposal* source and reuses stages 3-6 unchanged.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Sequence

import cv2
import numpy as np

# A playing card is 2.5 x 3.5 inches: short / long.
CARD_ASPECT = 2.5 / 3.5  # 0.7142857...

# Crop sizes. The service normalises to 600x900 because the rank model's own
# pipeline works at that size; the standalone annotation CLI emits 256x392 to
# stay byte-compatible with the original script's output.
CARD_W = 600
CARD_H = 900
PADDING_RATIO = 0.06

# Detection runs on a downscaled copy — card edges are low-frequency, and this
# keeps a 12MP phone photo inside the 0.5s budget on a 2-core shared CPU.
WORK_MAX_SIDE = 1024

# A card must cover at least this fraction of the frame to be considered. Five
# cards in a wide shot each cover ~2%, so this is deliberately permissive.
MIN_AREA_FRAC = 0.004
MAX_AREA_FRAC = 0.92

MAX_CARDS = 5


# Overlap tests rasterise quads onto this canvas instead of the working image:
# the answers are area ratios, which are scale-invariant, and it turns an O(n^2)
# sweep over megapixel masks into bitwise ops on a few tens of kilobytes.
OVERLAP_CANVAS = 256


@dataclass
class CardQuad:
    """One detected card: its four corners in full-resolution image space."""

    corners: np.ndarray               # (4, 2) float32, ordered TL, TR, BR, BL
    score: float = 0.0
    sources: set[str] = field(default_factory=set)
    aspect: float = 0.0               # short / long
    extent: float = 0.0               # contour area / rotated-rect area
    edge_support: float = 0.0
    split_index: int | None = None    # set when produced by seam splitting
    occluded: bool = False
    _raster: np.ndarray | None = field(default=None, repr=False, compare=False)

    @property
    def area(self) -> float:
        return float(cv2.contourArea(self.corners.astype(np.float32)))

    @property
    def center(self) -> np.ndarray:
        return self.corners.mean(axis=0)

    def dims(self) -> tuple[float, float]:
        """(short side, long side) in pixels, averaged over opposite edges."""
        tl, tr, br, bl = self.corners
        a = 0.5 * (math.dist(tr, tl) + math.dist(br, bl))
        b = 0.5 * (math.dist(bl, tl) + math.dist(br, tr))
        return (min(a, b), max(a, b))


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def order_points(pts: np.ndarray) -> np.ndarray:
    """Order 4 points as top-left, top-right, bottom-right, bottom-left.

    Uses the angle around the centroid rather than the sum/difference trick from
    the original script: the sum/difference rule mislabels corners once a card
    is rotated past ~45 degrees, which silently produced 90-degree-wrong crops.
    """
    pts = np.asarray(pts, dtype=np.float32).reshape(-1, 2)
    center = pts.mean(axis=0)
    angles = np.arctan2(pts[:, 1] - center[1], pts[:, 0] - center[0])
    order = np.argsort(angles)
    pts = pts[order]

    # Rotate the (now counter-clockwise-from-+x) ring so it starts top-left.
    sums = pts.sum(axis=1)
    start = int(np.argmin(sums))
    pts = np.roll(pts, -start, axis=0)

    # Ensure clockwise TL -> TR -> BR -> BL.
    if cv2.contourArea(pts.astype(np.float32)) < 0:
        pts = pts[::-1]
        start = int(np.argmin(pts.sum(axis=1)))
        pts = np.roll(pts, -start, axis=0)
    return pts.astype(np.float32)


def expand_quad(quad: np.ndarray, ratio: float = PADDING_RATIO) -> np.ndarray:
    """Grow a quad outward from its centre (keeps the original's 6% margin)."""
    quad = np.asarray(quad, dtype=np.float32)
    center = quad.mean(axis=0)
    return (center + (quad - center) * (1.0 + ratio)).astype(np.float32)


def _raster(q: CardQuad, shape: tuple[int, int]) -> np.ndarray:
    """Small binary rasterisation of a quad, cached on the candidate."""
    if q._raster is None:
        h, w = shape
        s = OVERLAP_CANVAS / max(h, w)
        ch, cw = max(1, int(h * s)), max(1, int(w * s))
        m = np.zeros((ch, cw), np.uint8)
        cv2.fillConvexPoly(m, (q.corners * s).astype(np.int32), 1)
        q._raster = m
    return q._raster


def _quad_iou(a: CardQuad, b: CardQuad, shape: tuple[int, int]) -> float:
    """Mask IoU of two quads. Exact for rotated shapes, unlike bbox IoU."""
    ma, mb = _raster(a, shape), _raster(b, shape)
    union = int(np.count_nonzero(ma | mb))
    if not union:
        return 0.0
    return int(np.count_nonzero(ma & mb)) / union


def _containment(inner: CardQuad, outer: CardQuad,
                 shape: tuple[int, int]) -> float:
    """Fraction of `inner`'s area that lies inside `outer`."""
    mi, mo = _raster(inner, shape), _raster(outer, shape)
    ai = int(np.count_nonzero(mi))
    if ai == 0:
        return 0.0
    return int(np.count_nonzero(mi & mo)) / ai


def _aspect_score(aspect: float) -> float:
    """1.0 at the true card ratio, falling off smoothly. `aspect` = short/long."""
    if aspect <= 0:
        return 0.0
    err = abs(aspect - CARD_ASPECT) / CARD_ASPECT
    return float(math.exp(-(err ** 2) / (2 * 0.11 ** 2)))


# ---------------------------------------------------------------------------
# Stage 1 — foreground hypotheses
# ---------------------------------------------------------------------------

def _fill_holes(mask: np.ndarray) -> np.ndarray:
    """Fill interior holes so a card's printed pips don't punch through it."""
    filled = mask.copy()
    contours, _ = cv2.findContours(filled, cv2.RETR_EXTERNAL,
                                   cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(filled, contours, -1, 255, thickness=cv2.FILLED)
    return filled


def _clean(mask: np.ndarray, k: int = 5, close_iter: int = 2) -> np.ndarray:
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=close_iter)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
    return _fill_holes(mask)


def _background_distance(lab: np.ndarray) -> np.ndarray:
    """Distance from the table's colour, in [0, 255].

    The table is sampled from a band around the image border and summarised with
    a *median* so a card touching the edge doesn't drag the estimate. Chroma
    (a*, b*) is weighted far above lightness (L*) because a specular highlight
    blows out L* while leaving the hue of the surface underneath intact — that
    single weighting is what makes this survive the glare that defeats a
    whiteness threshold.
    """
    h, w = lab.shape[:2]
    band = max(4, int(min(h, w) * 0.06))
    border = np.concatenate([
        lab[:band].reshape(-1, 3),
        lab[-band:].reshape(-1, 3),
        lab[:, :band].reshape(-1, 3),
        lab[:, -band:].reshape(-1, 3),
    ])
    bg = np.median(border, axis=0)

    diff = lab.astype(np.float32) - bg.astype(np.float32)
    chroma = np.sqrt(diff[..., 1] ** 2 + diff[..., 2] ** 2)
    light = np.abs(diff[..., 0])
    dist = chroma + 0.35 * light
    return np.clip(dist, 0, 255).astype(np.uint8)


def _kmeans_background(lab: np.ndarray, k: int = 4) -> np.ndarray:
    """Cluster the image and treat border-dominant clusters as background.

    Handles tables the median model can't summarise with one colour (a
    two-tone mat, a strong shadow gradient) by letting each cluster vote: a
    cluster that is over-represented in the border band relative to its share of
    the whole image is part of the table.
    """
    h, w = lab.shape[:2]
    step = max(1, int(math.sqrt(h * w / 20000)))
    sample = lab[::step, ::step].reshape(-1, 3).astype(np.float32)
    # Same chroma-over-lightness weighting as above.
    sample[:, 0] *= 0.35

    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 12, 1.0)
    _, _, centers = cv2.kmeans(sample, k, None, criteria, 2,
                               cv2.KMEANS_PP_CENTERS)

    # Label at quarter resolution and upsample: cards are large, low-frequency
    # regions, so the cluster map costs 16x less to build and looks the same.
    small = cv2.resize(lab, (max(1, w // 4), max(1, h // 4)),
                       interpolation=cv2.INTER_AREA).astype(np.float32)
    small[..., 0] *= 0.35
    sh, sw = small.shape[:2]

    # Assign per cluster rather than broadcasting an (H*W, k, 3) tensor, which
    # would allocate hundreds of megabytes on a phone-sized photo.
    best = np.full((sh, sw), np.inf, np.float32)
    labels = np.zeros((sh, sw), np.int32)
    for c in range(k):
        d = np.linalg.norm(small - centers[c], axis=2)
        closer = d < best
        best[closer] = d[closer]
        labels[closer] = c

    band = max(2, int(min(sh, sw) * 0.06))
    border_mask = np.zeros((sh, sw), bool)
    border_mask[:band] = border_mask[-band:] = True
    border_mask[:, :band] = border_mask[:, -band:] = True

    total = sh * sw
    border_total = int(border_mask.sum())
    background = np.zeros((sh, sw), np.uint8)
    for c in range(k):
        member = labels == c
        share = member.sum() / total
        border_share = (member & border_mask).sum() / max(border_total, 1)
        if share > 0 and border_share >= share:
            background |= member.astype(np.uint8)

    fg = ((1 - background) * 255).astype(np.uint8)
    return cv2.resize(fg, (w, h), interpolation=cv2.INTER_NEAREST)


def _hypothesis_masks(bgr: np.ndarray) -> dict[str, np.ndarray]:
    """Several independent foreground guesses; a card only needs one to hit."""
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    masks: dict[str, np.ndarray] = {}

    # H1 — distance from the table colour.
    dist = _background_distance(lab)
    _, m = cv2.threshold(dist, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    masks["bg_model"] = _clean(m)

    # H2 — table colour clusters.
    try:
        masks["bg_kmeans"] = _clean(_kmeans_background(lab))
    except cv2.error:
        pass

    # H3 — global Otsu on lightness. Wins when the table is dark.
    _, m = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    masks["otsu"] = _clean(m)

    # H4 — low saturation. Wins when the table is strongly coloured (green felt).
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    sat = hsv[..., 1]
    _, m = cv2.threshold(sat, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    masks["low_sat"] = _clean(m)

    # H5 — the original Canny route, kept because it is the one that works when
    # card and table are the same colour and only the shadow line separates them.
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    eq = clahe.apply(gray)
    eqb = cv2.GaussianBlur(eq, (5, 5), 0)
    med = float(np.median(eqb))
    edges = cv2.Canny(eqb, int(max(0, 0.66 * med)), int(min(255, 1.33 * med)))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
    edges = cv2.dilate(edges, kernel, iterations=1)
    masks["canny"] = _fill_holes(edges)

    return masks


# ---------------------------------------------------------------------------
# Stage 2 — contours to quads
# ---------------------------------------------------------------------------

def _quad_from_contour(cnt: np.ndarray) -> tuple[np.ndarray, float]:
    """Best 4-corner fit for a contour, plus its rectangularity.

    Prefers a genuine 4-point polygon approximation (which follows perspective)
    and falls back to the min-area rectangle when the outline is too ragged.
    """
    peri = cv2.arcLength(cnt, True)
    best: np.ndarray | None = None
    for eps in (0.02, 0.03, 0.04, 0.05, 0.015, 0.06, 0.08):
        approx = cv2.approxPolyDP(cnt, eps * peri, True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            best = approx.reshape(4, 2).astype(np.float32)
            break

    rect = cv2.minAreaRect(cnt)
    box = cv2.boxPoints(rect).astype(np.float32)
    rect_area = float(rect[1][0] * rect[1][1])
    cnt_area = float(cv2.contourArea(cnt))
    extent = cnt_area / rect_area if rect_area > 0 else 0.0

    if best is not None:
        quad_area = float(cv2.contourArea(best))
        # Only trust the polygon if it explains the contour about as well as the
        # rectangle does; a bad approximation collapses a corner.
        if quad_area > 0 and abs(quad_area - cnt_area) / max(cnt_area, 1) < 0.25:
            return order_points(best), extent

    return order_points(box), extent


def _border_fraction(cnt: np.ndarray, shape: tuple[int, int],
                     margin: int = 3) -> float:
    """Fraction of a contour's points that lie on the image border.

    A threshold that picks the *table* rather than the cards returns one blob
    whose outline is largely the image frame itself. Cards don't do that, so
    this cheaply rejects inverted-polarity masks at the source — which matters
    because such a blob would otherwise look like a container and swallow every
    real card in the containment test.
    """
    h, w = shape
    pts = cnt.reshape(-1, 2)
    if len(pts) == 0:
        return 0.0
    on = ((pts[:, 0] <= margin) | (pts[:, 0] >= w - 1 - margin)
          | (pts[:, 1] <= margin) | (pts[:, 1] >= h - 1 - margin))
    return float(on.mean())


def _candidates_from_mask(mask: np.ndarray, source: str,
                          image_area: float) -> list[CardQuad]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL,
                                   cv2.CHAIN_APPROX_SIMPLE)
    shape = mask.shape[:2]
    out: list[CardQuad] = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < image_area * MIN_AREA_FRAC or area > image_area * MAX_AREA_FRAC:
            continue
        if _border_fraction(cnt, shape) > 0.30:
            continue
        quad, extent = _quad_from_contour(cnt)
        short, long = CardQuad(quad).dims()
        if long <= 1:
            continue
        aspect = short / long
        # Keep anything from a single card up to five in a row; the seam splitter
        # decides what it actually is.
        if aspect < CARD_ASPECT / (MAX_CARDS + 0.6) or aspect > 1.02:
            continue
        if extent < 0.55:
            continue
        out.append(CardQuad(corners=quad, sources={source},
                            aspect=aspect, extent=extent))
    return out


# ---------------------------------------------------------------------------
# Stage 3 — scoring against the card prior
# ---------------------------------------------------------------------------

_EDGE_OFFSETS = np.array([-2.0, -1.0, 0.0, 1.0, 2.0], np.float32)


def _edge_support(grad: np.ndarray, thr: float, quad: np.ndarray,
                  samples: int = 48) -> float:
    """How much real image gradient sits under the quad's four edges.

    Samples across each edge along its normal and asks whether the image
    actually steps there. A quad hallucinated by a threshold has no step under
    it; a real card border does.
    """
    if thr <= 0:
        return 0.0
    h, w = grad.shape[:2]
    quad = quad.astype(np.float32)

    bases = []
    normals = []
    for i in range(4):
        p0, p1 = quad[i], quad[(i + 1) % 4]
        seg = p1 - p0
        length = float(np.linalg.norm(seg))
        if length < 4:
            continue
        n = max(8, min(samples, int(length / 3)))
        t = np.linspace(0.06, 0.94, n, dtype=np.float32)[:, None]
        bases.append(p0 + seg * t)
        normals.append(np.repeat(
            (np.array([-seg[1], seg[0]], np.float32) / length)[None, :], n, 0))
    if not bases:
        return 0.0

    base = np.concatenate(bases)                       # (N, 2)
    normal = np.concatenate(normals)                   # (N, 2)
    pts = base[None, :, :] + normal[None, :, :] * _EDGE_OFFSETS[:, None, None]
    xs = np.clip(np.rint(pts[..., 0]).astype(np.int32), 0, w - 1)
    ys = np.clip(np.rint(pts[..., 1]).astype(np.int32), 0, h - 1)
    best = grad[ys, xs].max(axis=0)                    # (N,)
    return float((best >= thr).mean())


def _refine_quad_edges(grad: np.ndarray, quad: np.ndarray,
                       band_frac: float = 0.028) -> np.ndarray:
    """Snap a quad's four sides onto the strongest edge near each of them.

    Thresholds put a border roughly where the card is; a few pixels of slop
    survives, and glare can bias a whole side inward. Each side is re-fitted to
    the gradient ridge beside it and the corners are recovered by intersecting
    consecutive sides — which also squares up corners that a ragged mask
    rounded off. The search band is deliberately narrow so the fit cannot jump
    to the card's own printed content.
    """
    h, w = grad.shape[:2]
    quad = np.asarray(quad, dtype=np.float32)
    short = min(CardQuad(quad).dims())
    band = max(2.0, short * band_frac)
    offsets = np.arange(-band, band + 1e-3, 1.0, dtype=np.float32)

    lines: list[tuple[np.ndarray, np.ndarray]] = []
    for i in range(4):
        p0, p1 = quad[i], quad[(i + 1) % 4]
        seg = p1 - p0
        length = float(np.linalg.norm(seg))
        if length < 8:
            return quad
        direction = seg / length
        normal = np.array([-direction[1], direction[0]], np.float32)

        n = max(12, min(40, int(length / 8)))
        t = np.linspace(0.12, 0.88, n, dtype=np.float32)[:, None]
        base = p0 + seg * t                                    # (n, 2)

        pts = base[None, :, :] + normal[None, None, :] * offsets[:, None, None]
        xs = np.clip(np.rint(pts[..., 0]).astype(np.int32), 0, w - 1)
        ys = np.clip(np.rint(pts[..., 1]).astype(np.int32), 0, h - 1)
        resp = grad[ys, xs]                                    # (len(offsets), n)

        best_idx = np.argmax(resp, axis=0)
        best_val = resp[best_idx, np.arange(resp.shape[1])]
        d = offsets[best_idx]

        # Keep only samples with a convincing ridge; if too few agree, leave the
        # side where the mask put it rather than fitting to noise.
        strong = best_val >= max(float(np.percentile(grad, 90)), 1e-6)
        if strong.sum() < max(6, n // 3):
            lines.append((p0.copy(), direction.copy()))
            continue

        # Reject outliers around the median offset before fitting.
        med = float(np.median(d[strong]))
        keep = strong & (np.abs(d - med) <= max(1.5, band * 0.6))
        if keep.sum() < max(5, n // 4):
            lines.append((p0 + normal * med, direction.copy()))
            continue

        fit_pts = base[keep] + normal * d[keep][:, None]
        centroid = fit_pts.mean(axis=0)
        _, _, vt = np.linalg.svd(fit_pts - centroid, full_matrices=False)
        fitted_dir = vt[0].astype(np.float32)
        if float(np.dot(fitted_dir, direction)) < 0:
            fitted_dir = -fitted_dir
        lines.append((centroid.astype(np.float32), fitted_dir))

    corners = []
    for i in range(4):
        p_prev, d_prev = lines[(i - 1) % 4]
        p_cur, d_cur = lines[i]
        cross = float(d_prev[0] * d_cur[1] - d_prev[1] * d_cur[0])
        if abs(cross) < 1e-3:            # near-parallel: no usable intersection
            return quad
        diff = p_cur - p_prev
        t = (diff[0] * d_cur[1] - diff[1] * d_cur[0]) / cross
        corners.append(p_prev + d_prev * t)

    refined = np.asarray(corners, np.float32)
    if not np.all(np.isfinite(refined)):
        return quad
    # A refinement should nudge, not redraw: reject a fit that moved a corner
    # more than the search band could justify.
    if float(np.max(np.linalg.norm(refined - quad, axis=1))) > band * 3.0:
        return quad
    return order_points(refined)


def _score_quad(q: CardQuad, grad: np.ndarray, thr: float) -> float:
    q.edge_support = _edge_support(grad, thr, q.corners)
    a = _aspect_score(q.aspect)
    # Several independent binarisations agreeing is real evidence, so let the
    # source count nudge the score — but cap it so it can't outweigh geometry.
    agreement = min(len(q.sources), 3) / 3.0
    q.score = float(0.42 * a + 0.24 * q.extent + 0.24 * q.edge_support
                    + 0.10 * agreement)
    return q.score


# ---------------------------------------------------------------------------
# Stage 4 — split blobs of touching cards, after rectifying them
# ---------------------------------------------------------------------------

def _rectify(gray: np.ndarray, quad: np.ndarray,
             out_w: int, out_h: int) -> tuple[np.ndarray, np.ndarray]:
    dst = np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1],
                    [0, out_h - 1]], np.float32)
    m = cv2.getPerspectiveTransform(quad.astype(np.float32), dst)
    return cv2.warpPerspective(gray, m, (out_w, out_h)), m


def _seam_profile(rect_gray: np.ndarray) -> np.ndarray:
    """Per-column "is there a full-height edge here" score, in [0, 1].

    The seam where two cards touch runs the entire height of the pair; the
    printed pips and indices that also throw gradients span only a fraction of
    it. So the score is the *fraction of rows* in which the column carries a
    strong gradient — near 1 over a seam, small over a pip. Using the fraction
    rather than the mean is what keeps card artwork from reading as a seam.

    A low quantile down each column expresses the same idea without needing a
    threshold, and was tried; it measured worse on the benchmark, because a real
    seam fades in and out along its length and any single low quantile is
    dragged down by the rows where it fades.
    """
    gx = np.abs(cv2.Scharr(rect_gray, cv2.CV_32F, 1, 0))
    # Blur along both axes. Vertically, so a ridge interrupted by a pip still
    # reads as continuous; horizontally, because the two card edges meeting at a
    # seam put their gradient peaks on either side of it and leave the middle
    # flat — a small horizontal blur merges them into one ridge over the seam.
    gx = cv2.GaussianBlur(gx, (5, 9), 0)

    sample = gx[::3, ::3]
    thr = float(np.percentile(sample, 82))
    if thr <= 1e-6:
        # More than 82% of this region is flat — a plain white card face. Without
        # a floor every pixel would count as strong and the profile would carry
        # no information at all, so touching cards could never be split. Anchor
        # to the strongest gradient present instead, but keep the anchor low:
        # printed pips are darker than the thin shadow line between two cards,
        # so a high anchor would exclude the very thing being looked for.
        thr = 0.15 * float(np.percentile(sample, 99.0))
    if thr <= 1e-6:
        return np.zeros(rect_gray.shape[1], np.float32)

    profile = (gx >= thr).astype(np.float32).mean(axis=0)
    return cv2.GaussianBlur(profile.reshape(1, -1), (5, 1), 0).ravel()


def _card_count_hypotheses(short: float, long: float) -> list[tuple[int, bool]]:
    """Plausible (n, split_along_long) readings of a blob's dimensions.

    Two cards side by side measure 5.0 x 3.5 card-units — aspect 1.428 — against
    a single landscape card's 1.400. They are 2% apart, so both readings stay on
    the table here and the seam evidence, not the ratio, decides.
    """
    ratio = long / short if short > 0 else 0.0
    out: list[tuple[int, bool]] = []
    if ratio <= 0:
        return out
    for n in range(2, MAX_CARDS + 1):
        # n cards stacked along the long side, each card standing upright.
        if abs((ratio / n) - CARD_ASPECT) / CARD_ASPECT < 0.13:
            out.append((n, True))
        # n cards stacked along the long side, each lying on its long edge.
        if abs((ratio * n) - 1.0 / CARD_ASPECT) / (1.0 / CARD_ASPECT) < 0.13:
            out.append((n, True))
    # De-duplicate while keeping order.
    seen: set[tuple[int, bool]] = set()
    uniq = []
    for item in out:
        if item not in seen:
            seen.add(item)
            uniq.append(item)
    return uniq


def _find_seams(rect_gray: np.ndarray, n: int) -> tuple[list[int], float] | None:
    """Locate n-1 seams near their predicted positions; None if unconvincing."""
    w = rect_gray.shape[1]
    profile = _seam_profile(rect_gray)
    baseline = float(np.median(profile))
    spread = float(np.percentile(profile, 75) - np.percentile(profile, 25)) or 1e-3

    seams: list[int] = []
    strengths: list[float] = []
    window = max(6, int(w * 0.035))
    for k in range(1, n):
        target = int(round(w * k / n))
        lo, hi = max(1, target - window), min(w - 1, target + window)
        if hi <= lo:
            return None
        local = profile[lo:hi]
        idx = int(np.argmax(local))
        pos = lo + idx
        peak = float(local[idx])
        # A real seam is a full-height ridge standing well clear of the noise.
        if peak < 0.55 or (peak - baseline) < 2.0 * spread:
            return None
        seams.append(pos)
        strengths.append(peak)

    return seams, float(np.mean(strengths))


def _split_quad_at(quad: np.ndarray, m_inv: np.ndarray, seams: Sequence[int],
                   rect_w: int, rect_h: int) -> list[np.ndarray]:
    """Map seam columns in rectified space back to quads in image space."""
    bounds = [0, *seams, rect_w]
    out: list[np.ndarray] = []
    for i in range(len(bounds) - 1):
        x0, x1 = bounds[i], bounds[i + 1]
        if x1 - x0 < rect_w * 0.08:
            continue
        pts = np.array([[x0, 0], [x1 - 1, 0], [x1 - 1, rect_h - 1],
                        [x0, rect_h - 1]], np.float32).reshape(-1, 1, 2)
        mapped = cv2.perspectiveTransform(pts, m_inv).reshape(4, 2)
        out.append(order_points(mapped))
    return out


def _maybe_split(q: CardQuad, gray: np.ndarray,
                 debug: list[dict[str, Any]] | None = None) -> list[CardQuad]:
    """Return q as-is, or the cards it turns out to be made of."""
    short, long = q.dims()
    hypotheses = _card_count_hypotheses(short, long)
    if not hypotheses:
        return [q]

    # Rectify with the long side horizontal so seams are vertical.
    rect_h = 420
    rect_w = int(round(rect_h * long / max(short, 1e-3)))
    rect_w = max(64, min(rect_w, 2400))

    # order_points gives TL,TR,BR,BL of the quad as drawn; rotate the corner
    # order when the quad is taller than it is wide so the long axis lands on x.
    corners = q.corners
    tl, tr, br, bl = corners
    if np.linalg.norm(tr - tl) < np.linalg.norm(bl - tl):
        corners = np.array([tr, br, bl, tl], np.float32)

    rect_gray, m = _rectify(gray, corners, rect_w, rect_h)
    m_inv = np.linalg.inv(m)

    best: tuple[float, list[int], int] | None = None
    for n, _ in hypotheses:
        found = _find_seams(rect_gray, n)
        if found is None:
            continue
        seams, strength = found
        # Prefer the strongest evidence; break ties toward fewer cards.
        key = strength - 0.02 * n
        if best is None or key > best[0]:
            best = (key, seams, n)

    if debug is not None:
        debug.append({
            "hypotheses": [h[0] for h in hypotheses],
            "chosen": best[2] if best else 1,
            "profile": _seam_profile(rect_gray).tolist(),
            "rect_size": [rect_w, rect_h],
        })

    if best is None:
        return [q]

    _, seams, n = best
    pieces = _split_quad_at(corners, m_inv, seams, rect_w, rect_h)
    if len(pieces) < 2:
        return [q]

    out = []
    for i, piece in enumerate(pieces):
        sub = CardQuad(corners=piece, sources=set(q.sources) | {"seam_split"},
                       extent=q.extent, split_index=i)
        s, l = sub.dims()
        sub.aspect = s / l if l > 0 else 0.0
        out.append(sub)
    return out


# ---------------------------------------------------------------------------
# Stage 5 — reconcile candidates into one card set
# ---------------------------------------------------------------------------

# A single card fills its own bounding rectangle almost completely. A blob of
# several cards, or a threshold that leaked into the table, does not — which
# makes extent the signal that tells "a card" from "a region containing cards".
SINGLE_CARD_EXTENT = 0.85


def _merge_duplicates(cands: list[CardQuad],
                      shape: tuple[int, int]) -> list[CardQuad]:
    """Collapse candidates that describe the same card, keeping the best one.

    Two things are deliberately *not* merged. Overlapping-but-distinct quads are
    left alone because cards really do overlap, and NMS that dropped them would
    delete a card the player is holding. Nested quads are left alone too: a big
    region and a card inside it can exceed the IoU threshold, and merging them by
    score would let an over-segmented blob delete the very card it contains.
    Nesting is settled later, on evidence rather than score.
    """
    cands = sorted(cands, key=lambda c: c.score, reverse=True)
    kept: list[CardQuad] = []
    for c in cands:
        duplicate_of = None
        for k in kept:
            if _quad_iou(c, k, shape) <= 0.55:
                continue
            inner, outer = (c, k) if c.area <= k.area else (k, c)
            # Only a *meaningfully* bigger outer quad counts as nesting; two
            # hypotheses outlining the same card differ by a few percent and
            # must still collapse into one.
            if (outer.area > inner.area * 1.25
                    and _containment(inner, outer, shape) > 0.80):
                continue  # nesting, not duplication
            duplicate_of = k
            break
        if duplicate_of is None:
            kept.append(c)
        else:
            duplicate_of.sources |= c.sources
    return kept


def _drop_inner_frames(cands: list[CardQuad],
                       shape: tuple[int, int]) -> list[CardQuad]:
    """Remove quads that sit wholly inside another plausible card.

    This is the fix for the face-card failure: a K's printed frame is a strong,
    clean rectangle *inside* the card outline, so edge strength alone prefers it.
    Containment is the signal that settles it — a card is never inside a card.
    """
    def looks_like_one_card(q: CardQuad) -> bool:
        return q.extent >= SINGLE_CARD_EXTENT and _aspect_score(q.aspect) > 0.5

    kept: list[CardQuad] = []
    for c in cands:
        c_area = c.area
        drop = False
        for other in cands:
            if other is c or c_area <= 0:
                continue

            # Case 1 — c sits inside `other`. If `other` is itself a convincing
            # single card, c is that card's printed frame. Bounding the ratio
            # matters: a frame runs 50-85% of its card, so a genuine container is
            # only modestly bigger, and without the bound an oversized blob could
            # pose as the container and delete every real card inside it.
            if (1.12 < other.area / c_area < 3.0
                    and looks_like_one_card(other)
                    and _containment(c, other, shape) > 0.90):
                drop = True
                break

            # Case 2 — the mirror image: `other` is a convincing single card and
            # c merely contains it while not looking like a card itself. That is
            # an over-segmented region (a threshold that swallowed the table), so
            # the region goes and the card it holds stays.
            if (other.area < c_area / 1.12
                    and looks_like_one_card(other)
                    and not looks_like_one_card(c)
                    and _containment(other, c, shape) > 0.85):
                drop = True
                break

        if not drop:
            kept.append(c)
    return kept


def _unit_card_area(cands: list[CardQuad]) -> float:
    """Best guess at the area of one card in this photo, or 0 if unclear.

    Every card in a photo is the same physical size and lies on the same plane,
    so their areas cluster tightly. Estimating from the card-shaped, well-scoring
    candidates only keeps the estimate away from junk blobs.
    """
    good = [c.area for c in cands
            if c.extent >= SINGLE_CARD_EXTENT
            and _aspect_score(c.aspect) > 0.5 and c.area > 0]
    if not good:
        good = [c.area for c in cands
                if _aspect_score(c.aspect) > 0.35 and c.area > 0]
    if not good:
        return 0.0
    return float(np.median(good))


def _enforce_size_consistency(cands: list[CardQuad], unit: float
                              ) -> list[CardQuad]:
    """Drop candidates whose size disagrees with the rest of the photo.

    Rejects the residue both failure modes leave behind: inner frames come out
    too small, and blobs that resisted splitting come out too large.
    """
    if unit <= 0 or len(cands) < 2:
        return cands
    keep = [c for c in cands if 0.5 * unit <= c.area <= 1.9 * unit]
    return keep if keep else cands


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def detect_cards_classic(image: np.ndarray, *, max_cards: int = MAX_CARDS,
                         debug: dict[str, Any] | None = None) -> list[CardQuad]:
    """Detect cards with no learned weights. Corners are in full-res coords."""
    h, w = image.shape[:2]
    scale = min(1.0, WORK_MAX_SIDE / max(h, w))
    work = (cv2.resize(image, (int(w * scale), int(h * scale)),
                       interpolation=cv2.INTER_AREA) if scale < 1.0 else image)
    wh, ww = work.shape[:2]
    image_area = float(wh * ww)

    gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY)
    grad = cv2.magnitude(cv2.Scharr(gray, cv2.CV_32F, 1, 0),
                         cv2.Scharr(gray, cv2.CV_32F, 0, 1))
    grad_thr = float(np.percentile(grad, 88))

    masks = _hypothesis_masks(work)
    candidates: list[CardQuad] = []
    for name, mask in masks.items():
        candidates.extend(_candidates_from_mask(mask, name, image_area))

    if debug is not None:
        debug["masks"] = masks
        debug["raw_candidates"] = len(candidates)
        debug["work_shape"] = (wh, ww)

    for c in candidates:
        _score_quad(c, grad, grad_thr)

    candidates = _merge_duplicates(candidates, (wh, ww))

    # Split before sizing up the photo: a merged pair has to become two cards
    # before the "one card size per photo" estimate can mean anything.
    split_debug: list[dict[str, Any]] = []
    expanded: list[CardQuad] = []
    for c in candidates:
        expanded.extend(_maybe_split(c, gray, split_debug))
    for c in expanded:
        if c.split_index is not None:
            _score_quad(c, grad, grad_thr)
    candidates = _merge_duplicates(expanded, (wh, ww))

    unit = _unit_card_area(candidates)
    candidates = _enforce_size_consistency(candidates, unit)
    candidates = _drop_inner_frames(candidates, (wh, ww))
    candidates = [c for c in candidates if c.score >= 0.45]

    # Snap the survivors onto the real edges before they become crops.
    for c in candidates:
        c.corners = _refine_quad_edges(grad, c.corners)
        c._raster = None
        short, long = c.dims()
        c.aspect = short / long if long > 0 else 0.0

    candidates.sort(key=lambda c: c.score, reverse=True)
    candidates = candidates[:max_cards]
    # Left-to-right, matching the original script's ordering.
    candidates.sort(key=lambda c: float(c.center[0]))

    if scale < 1.0:
        inv = 1.0 / scale
        for c in candidates:
            c.corners = (c.corners * inv).astype(np.float32)

    if debug is not None:
        debug["split"] = split_debug
        debug["unit_area"] = unit
        debug["final"] = len(candidates)

    return candidates


def warp_card(image: np.ndarray, quad: np.ndarray | CardQuad,
              output_size: tuple[int, int] = (CARD_W, CARD_H)) -> np.ndarray:
    """Perspective-correct a card quad to an upright crop of `output_size`."""
    corners = quad.corners if isinstance(quad, CardQuad) else quad
    rect = expand_quad(order_points(corners))
    tl, tr, br, bl = rect

    warp_w = max(int(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl))), 1)
    warp_h = max(int(max(np.linalg.norm(br - tr), np.linalg.norm(bl - tl))), 1)

    dst = np.array([[0, 0], [warp_w - 1, 0], [warp_w - 1, warp_h - 1],
                    [0, warp_h - 1]], np.float32)
    m = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(image, m, (warp_w, warp_h))

    if warped.shape[1] > warped.shape[0]:
        warped = cv2.rotate(warped, cv2.ROTATE_90_CLOCKWISE)

    interp = (cv2.INTER_AREA if warped.shape[0] > output_size[1]
              else cv2.INTER_CUBIC)
    return cv2.resize(warped, output_size, interpolation=interp)


def classic_is_confident(quads: list[CardQuad]) -> bool:
    """Whether the classical result looks like a clean read of the scene.

    Confident means: it found something, every quad is close to a card's true
    proportions, they agree on a size, and they scored well. Cards laid out with
    gaps produce exactly that; cards that overlap do not, because the geometry
    the classical engine relies on isn't there.
    """
    if not quads:
        return False
    for q in quads:
        if not (0.62 <= q.aspect <= 0.82):
            return False
        if q.score < 0.55:
            return False
    if len(quads) > 1:
        areas = sorted(q.area for q in quads)
        if areas[0] <= 0 or areas[-1] / areas[0] > 1.5:
            return False
    return True


def detect_cards(image: np.ndarray, *, engine: str = "auto",
                 max_cards: int = MAX_CARDS,
                 debug: dict[str, Any] | None = None) -> list[CardQuad]:
    """Detect every card in `image`.

    ``engine``:
      ``classic``  geometry only, no weights.
      ``learned``  the trained segmentation model (raises if unavailable).
      ``auto``     classical first, and the learned model only to rescue the
                   scenes the classical engine cannot do.

    Why ``auto`` runs the classical engine first rather than preferring the
    model: measured on held-out synthetic scenes, the learned engine is far
    better where geometry fails — overlapping cards go from 16% to 48% recall,
    a fanned hand from 1% to 46% — but it is *worse* on cards laid out with
    gaps, which the classical engine already reads at ~90%. Always preferring
    the model would trade away the common case to win the rare one. So the
    classical answer is taken whenever it looks clean (see
    ``classic_is_confident``), and the model is consulted only when it doesn't.

    That ordering also keeps the usual request on the fast path: the classical
    engine alone is well inside the latency budget, and the model's cost is
    only paid for the frames that need it.
    """
    if engine == "classic":
        return detect_cards_classic(image, max_cards=max_cards, debug=debug)

    from . import card_seg_model  # local import: torch is optional for the CLI

    if engine == "learned":
        return card_seg_model.detect_cards_learned(
            image, max_cards=max_cards, debug=debug)

    if engine != "auto":
        raise ValueError(f"unknown engine: {engine!r}")

    classic = detect_cards_classic(image, max_cards=max_cards, debug=debug)

    if not card_seg_model.weights_available():
        if debug is not None:
            debug["engine"] = "classic"
            debug["fallback"] = "no weights"
        return classic

    if classic_is_confident(classic):
        if debug is not None:
            debug["engine"] = "classic"
            debug["fallback"] = "classic confident"
        return classic

    try:
        learned = card_seg_model.detect_cards_learned(
            image, max_cards=max_cards, debug=debug)
    except Exception as exc:  # noqa: BLE001 - never break on a bad model
        if debug is not None:
            debug["engine"] = "classic"
            debug["fallback"] = f"learned failed: {exc}"
        return classic

    if not learned:
        if debug is not None:
            debug["engine"] = "classic"
            debug["fallback"] = "learned found nothing"
        return classic

    if debug is not None:
        debug["engine"] = "learned"
        debug["fallback"] = "classic not confident"
    return learned


def split_cards(image: np.ndarray, *, engine: str = "auto",
                output_size: tuple[int, int] = (CARD_W, CARD_H),
                max_cards: int = MAX_CARDS,
                debug: dict[str, Any] | None = None
                ) -> tuple[list[np.ndarray], list[CardQuad]]:
    """Detect and crop in one call. Returns (crops, quads) in left-to-right order."""
    quads = detect_cards(image, engine=engine, max_cards=max_cards, debug=debug)
    crops = [warp_card(image, q, output_size) for q in quads]
    return crops, quads
