"""Multi-card detection and perspective correction.

Ported verbatim (algorithm unchanged) from the uploaded ``card_splitter_first.py``
research script. The only change is that ``process_image`` now works on an
in-memory BGR image array and returns the cropped card images as arrays, instead
of reading from / writing to disk. The detection logic (``detect_card_regions``,
``warp_card``) is identical to the original.
"""

from __future__ import annotations

import cv2
import numpy as np

# Output size of each straightened card crop.
CARD_W = 256
CARD_H = 392
PADDING_RATIO = 0.06


def order_points(pts: np.ndarray) -> np.ndarray:
    """Order 4 points as top-left, top-right, bottom-right, bottom-left."""
    pts = np.array(pts, dtype=np.float32)

    rect = np.zeros((4, 2), dtype=np.float32)

    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).reshape(-1)

    rect[0] = pts[np.argmin(s)]       # top-left
    rect[2] = pts[np.argmax(s)]       # bottom-right
    rect[1] = pts[np.argmin(diff)]    # top-right
    rect[3] = pts[np.argmax(diff)]    # bottom-left

    return rect


def expand_box(box: np.ndarray, ratio: float = PADDING_RATIO) -> np.ndarray:
    """Grow the quad outward from its centre to add a small margin."""
    box = np.array(box, dtype=np.float32)
    center = np.mean(box, axis=0)
    expanded = center + (box - center) * (1.0 + ratio)
    return expanded


def warp_card(image: np.ndarray, box: np.ndarray,
              output_size: tuple[int, int] = (CARD_W, CARD_H)) -> np.ndarray:
    """Perspective-correct a (possibly rotated) card quad to a portrait crop."""
    rect = expand_box(order_points(box))

    tl, tr, br, bl = rect

    width_top = np.linalg.norm(tr - tl)
    width_bottom = np.linalg.norm(br - bl)
    height_right = np.linalg.norm(br - tr)
    height_left = np.linalg.norm(bl - tl)

    warp_w = max(int(max(width_top, width_bottom)), 1)
    warp_h = max(int(max(height_right, height_left)), 1)

    dst = np.array([
        [0, 0],
        [warp_w - 1, 0],
        [warp_w - 1, warp_h - 1],
        [0, warp_h - 1],
    ], dtype=np.float32)

    matrix = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(image, matrix, (warp_w, warp_h))

    # If landscape, rotate to portrait.
    if warped.shape[1] > warped.shape[0]:
        warped = cv2.rotate(warped, cv2.ROTATE_90_CLOCKWISE)

    warped = cv2.resize(warped, output_size)
    return warped


def xyxy_from_box(box: np.ndarray) -> np.ndarray:
    x, y, w, h = cv2.boundingRect(box.astype(np.int32))
    return np.array([x, y, x + w, y + h], dtype=np.float32)


def bbox_iou(box_a: np.ndarray, box_b: np.ndarray) -> float:
    a = xyxy_from_box(box_a)
    b = xyxy_from_box(box_b)

    x1 = max(a[0], b[0])
    y1 = max(a[1], b[1])
    x2 = min(a[2], b[2])
    y2 = min(a[3], b[3])

    inter_w = max(0, x2 - x1)
    inter_h = max(0, y2 - y1)
    inter_area = inter_w * inter_h

    area_a = max(0, a[2] - a[0]) * max(0, a[3] - a[1])
    area_b = max(0, b[2] - b[0]) * max(0, b[3] - b[1])

    union = area_a + area_b - inter_area
    if union <= 0:
        return 0.0
    return float(inter_area / union)


def non_max_suppression(candidates: list[dict], iou_threshold: float = 0.3) -> list[dict]:
    selected: list[dict] = []
    for cand in candidates:
        keep = True
        for sel in selected:
            if bbox_iou(cand["box"], sel["box"]) > iou_threshold:
                keep = False
                break
        if keep:
            selected.append(cand)
    return selected


def detect_card_regions(image: np.ndarray) -> tuple[list[dict], np.ndarray]:
    """Detect card-shaped quads in a BGR image, auto-selecting the card count.

    Ported from the updated ``card_splitter_first.py``: instead of a fixed
    ``num_cards``, every candidate whose area is at least 30% of the largest
    candidate's area is kept (so 2 hole cards or a 3-5 card board are detected
    without the caller stating how many). Candidates are sorted left → right.

    NOTE: the uploaded script contained a bug where this 30% filter was computed
    into ``selected`` and then immediately overwritten by
    ``selected = sorted(candidates, ...)`` — dropping the filter and returning
    every candidate. This port applies the filter as the comment intends
    (最大カード面積の30%以上なら採用する). Returns the selected candidates and the
    binary edge mask used for detection (for debugging).
    """
    img_h, img_w = image.shape[:2]
    image_area = img_h * img_w

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    blur = cv2.GaussianBlur(gray, (5, 5), 0)

    median_val = np.median(blur)
    lower = int(max(0, 0.66 * median_val))
    upper = int(min(255, 1.33 * median_val))
    edges = cv2.Canny(blur, lower, upper)

    kernel = np.ones((7, 7), np.uint8)
    edges_closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
    edges_closed = cv2.dilate(edges_closed, kernel, iterations=1)

    contours, _ = cv2.findContours(edges_closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    candidates: list[dict] = []

    for cnt in contours:
        area = cv2.contourArea(cnt)

        if area < image_area * 0.02:
            continue
        if area > image_area * 0.90:
            continue

        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.03 * peri, True)

        rect = cv2.minAreaRect(cnt)
        (cx, cy), (rw, rh), angle = rect

        if rw <= 0 or rh <= 0:
            continue

        rect_area = rw * rh
        if rect_area <= 0:
            continue

        aspect_ratio = max(rw, rh) / min(rw, rh)
        if not (1.15 <= aspect_ratio <= 1.85):
            continue

        extent = area / rect_area
        if extent < 0.45:
            continue

        num_vertices = len(approx)
        if num_vertices > 10:
            continue

        box = np.array(cv2.boxPoints(rect), dtype=np.float32)

        candidates.append({
            "box": box,
            "area": area,
            "aspect_ratio": aspect_ratio,
            "extent": extent,
            "vertices": num_vertices,
        })

    candidates = sorted(candidates, key=lambda x: x["area"], reverse=True)
    candidates = non_max_suppression(candidates, iou_threshold=0.3)

    # Keep every candidate whose area is >= 30% of the largest card's area.
    if candidates:
        largest_area = candidates[0]["area"]
        selected = [c for c in candidates if c["area"] >= largest_area * 0.3]
    else:
        selected = []

    # Sort left → right (reading order for a row of cards on the table).
    selected = sorted(
        selected,
        key=lambda c: cv2.boundingRect(c["box"].astype(np.int32))[0],
    )

    return selected, edges_closed


def split_cards(image: np.ndarray) -> list[np.ndarray]:
    """Detect and straighten cards, returning a list of BGR crop arrays.

    Ordered left → right. The card count is auto-detected (every card whose area
    is >= 30% of the largest detected card).
    """
    selected, _ = detect_card_regions(image)
    return [warp_card(image, card["box"]) for card in selected]
