"""Tests for the rewritten card detector.

The real photos in ``cardproject/`` are the regression set: each one is a case
the previous splitter got wrong, so a failure here means a specific known bug
has come back.
"""

from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np
import pytest

from app.recognition import card_splitter_v2 as v2

REPO = Path(__file__).resolve().parents[3]
PHOTOS = [
    # (path, expected number of cards)
    (REPO / "cardproject/input_images/5card.jpg", 5),
    (REPO / "cardproject/output_results/S__64389129/S__64389129.jpg", 2),
    (REPO / "cardproject/output_results/S__64389127_0/S__64389127_0.jpg", 2),
    (REPO / "cardproject/output_results/pattern3/pattern3.jpg", 2),
]


def _load(path: Path) -> np.ndarray:
    img = cv2.imread(str(path))
    if img is None:
        pytest.skip(f"sample photo missing: {path}")
    return img


@pytest.mark.parametrize("path,expected", PHOTOS,
                         ids=[p.stem for p, _ in PHOTOS])
def test_detects_expected_card_count(path: Path, expected: int) -> None:
    quads = v2.detect_cards_classic(_load(path))
    assert len(quads) == expected


@pytest.mark.parametrize("path,expected", PHOTOS,
                         ids=[p.stem for p, _ in PHOTOS])
def test_detections_are_card_shaped_and_disjoint(path: Path, expected: int) -> None:
    """Guards the two failure modes the rewrite exists to fix.

    A quad far off 2.5:3.5 means a merged blob or a stray region got through; a
    pair of quads that heavily overlap means an inner frame was kept alongside
    the card that contains it.
    """
    image = _load(path)
    quads = v2.detect_cards_classic(image)
    assert quads

    for q in quads:
        short, long = q.dims()
        assert long > 0
        assert 0.55 <= short / long <= 0.92, f"not card-shaped: {short / long:.3f}"

    shape = image.shape[:2]
    for i, a in enumerate(quads):
        for b in quads[i + 1:]:
            assert v2._quad_iou(a, b, shape) < 0.2


def test_all_cards_in_a_photo_are_about_the_same_size() -> None:
    """Every card in one frame is the same object at roughly one distance."""
    quads = v2.detect_cards_classic(_load(PHOTOS[0][0]))
    areas = sorted(q.area for q in quads)
    assert areas[-1] / areas[0] < 1.35


def test_order_points_survives_large_rotation() -> None:
    """The old sum/difference corner rule mislabels past 45 degrees."""
    base = np.array([[-50, -70], [50, -70], [50, 70], [-50, 70]], np.float32)
    for deg in (0, 20, 44, 46, 80, 100, 170):
        rad = math.radians(deg)
        rot = np.array([[math.cos(rad), -math.sin(rad)],
                        [math.sin(rad), math.cos(rad)]], np.float32)
        pts = base @ rot.T + np.array([200, 200], np.float32)
        ordered = v2.order_points(pts[::-1])          # feed them out of order
        # Ordering must stay a simple, positively-wound quadrilateral.
        assert cv2.contourArea(ordered) > 0
        assert abs(cv2.contourArea(ordered) - cv2.contourArea(pts)) < 1.0
        # Opposite sides of a rectangle stay equal whatever the rotation.
        q = v2.CardQuad(ordered)
        short, long = q.dims()
        assert abs(short - 100) < 1.0 and abs(long - 140) < 1.0


def test_card_count_hypotheses_offers_two_for_a_touching_pair() -> None:
    """Two cards side by side and one landscape card differ by 2% in aspect.

    Both readings must stay available so the seam evidence, not the ratio,
    decides — this is the trap that let merged pairs through as single cards.
    """
    short, long = 3.5, 5.0                      # two 2.5x3.5 cards, touching
    hyps = [n for n, _ in v2._card_count_hypotheses(short, long)]
    assert 2 in hyps

    # Three in a row must read as three.
    hyps3 = [n for n, _ in v2._card_count_hypotheses(3.5, 7.5)]
    assert 3 in hyps3


def test_seam_profile_peaks_between_two_touching_cards() -> None:
    """A seam runs the full height; printed pips do not."""
    h, w = 300, 420
    img = np.full((h, w), 245, np.uint8)
    img[:, w // 2 - 2:w // 2 + 2] = 40          # the seam
    cv2.circle(img, (w // 4, h // 2), 22, 30, -1)   # a pip, mid-card
    profile = v2._seam_profile(img)
    assert profile[w // 2] > 0.9
    assert profile[w // 4] < profile[w // 2] * 0.8


def test_warp_card_returns_the_requested_size_upright() -> None:
    image = np.zeros((400, 400, 3), np.uint8)
    quad = np.array([[50, 60], [250, 40], [270, 300], [70, 320]], np.float32)
    out = v2.warp_card(image, quad, (v2.CARD_W, v2.CARD_H))
    assert out.shape == (v2.CARD_H, v2.CARD_W, 3)


# The engine-selection and fallback paths are covered in test_card_seg_model.py,
# which exercises them with and without the trained weights present.


def test_end_to_end_reads_the_five_card_photo() -> None:
    """The whole chain, on the photo the old splitter mis-cut.

    Asserting the actual ranks and suits, not just the count: a crop that is
    offset or rotated still counts as "5 cards" while feeding the classifiers
    garbage, and that is exactly how the previous splitter's failures showed up.
    """
    from app.recognition.pipeline import recognize_image

    path = REPO / "cardproject/input_images/5card.jpg"
    if not path.is_file():
        pytest.skip("sample photo missing")

    cards, _ = recognize_image(path.read_bytes())
    assert [c["card_code"] for c in cards] == ["3s", "4s", "5s", "6s", "7s"]
    assert all(c["accepted"] for c in cards)


def test_classic_confidence_gate_accepts_a_clean_read() -> None:
    """The gate that decides whether the learned model is worth consulting."""
    quads = v2.detect_cards_classic(_load(PHOTOS[0][0]))
    assert v2.classic_is_confident(quads)


def test_classic_confidence_gate_rejects_a_bad_read() -> None:
    """Nothing found, wrong proportions, or sizes that disagree — all suspect."""
    assert not v2.classic_is_confident([])

    square = v2.CardQuad(
        corners=np.array([[0, 0], [100, 0], [100, 100], [0, 100]], np.float32),
        aspect=1.0, score=0.9)
    assert not v2.classic_is_confident([square])

    def card(size: float) -> v2.CardQuad:
        q = v2.CardQuad(corners=np.array(
            [[0, 0], [size, 0], [size, size / v2.CARD_ASPECT],
             [0, size / v2.CARD_ASPECT]], np.float32), score=0.8)
        short, long = q.dims()
        q.aspect = short / long
        return q

    assert v2.classic_is_confident([card(100), card(110)])
    # One card twice the area of another cannot be the same photo.
    assert not v2.classic_is_confident([card(100), card(200)])
