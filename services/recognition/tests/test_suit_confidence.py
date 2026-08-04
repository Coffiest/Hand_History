"""Tests for the suit read and the decision to record it without asking.

The bug these exist to prevent: a spade read as a club at 0.44 confidence used
to be recorded silently, because the auto-accept check only ever looked at the
rank model. For a hand history, a wrong record is worse than an extra tap.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest
from PIL import Image

from app.recognition import card_splitter_v2 as v2
from app.recognition import pipeline as P
from app.recognition.suit_model import SuitResult

REPO = Path(__file__).resolve().parents[3]
PATTERN3 = REPO / "cardproject/output_results/pattern3/pattern3.jpg"
FIVE_CARD = REPO / "cardproject/input_images/5card.jpg"


def _result(probabilities: list[float]) -> SuitResult:
    top = max(probabilities)
    idx = probabilities.index(top)
    return SuitResult(code="cdhs"[idx], name="", confidence=top,
                      probabilities=probabilities)


def test_margin_is_the_gap_to_the_runner_up() -> None:
    assert _result([0.01, 0.00, 0.04, 0.95]).margin == pytest.approx(0.91)
    # The real misread: a top probability that passes any sensible threshold,
    # with the true answer sitting right behind it.
    assert _result([0.442, 0.042, 0.170, 0.346]).margin == pytest.approx(0.096)


def test_suit_gate_separates_a_real_read_from_a_coin_toss() -> None:
    assert P.suit_is_confident(_result([0.01, 0.00, 0.04, 0.95]))
    assert not P.suit_is_confident(_result([0.442, 0.042, 0.170, 0.346]))
    # High-looking confidence still fails when the runner-up is close behind.
    assert not P.suit_is_confident(_result([0.52, 0.01, 0.02, 0.45]))
    # And a leader under the floor fails even with a clear gap.
    assert not P.suit_is_confident(_result([0.50, 0.16, 0.17, 0.17]))


def _crops(path: Path) -> list[np.ndarray]:
    image = cv2.imread(str(path))
    if image is None:
        pytest.skip(f"sample photo missing: {path}")
    return [v2.warp_card(image, q, (v2.CARD_W, v2.CARD_H))
            for q in v2.detect_cards_classic(image)]


def _pil(crop: np.ndarray) -> Image.Image:
    return Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))


def test_tta_is_deterministic_and_matches_a_half_turn() -> None:
    """A card and the same card upside down are one input, so one answer."""
    P._ensure_models()
    crop = _crops(FIVE_CARD)[0]
    first = P._suit_classifier.predict(_pil(crop))
    again = P._suit_classifier.predict(_pil(crop))
    assert first.probabilities == again.probabilities

    turned = P._suit_classifier.predict(_pil(cv2.rotate(crop, cv2.ROTATE_180)))
    assert turned.code == first.code
    assert turned.confidence == pytest.approx(first.confidence, abs=1e-5)


def test_the_known_misread_is_flagged_rather_than_recorded() -> None:
    """The regression that motivated all of this.

    The second card in this photo is a spade the model reads as a club. It must
    come back needing confirmation; the point is not that the read is right, but
    that a wrong read never lands in the history unchallenged.
    """
    P._ensure_models()
    crops = _crops(PATTERN3)
    assert len(crops) == 2
    misread = P._suit_classifier.predict(_pil(crops[1]))
    assert misread.code == "c", "expected the known spade/club confusion"
    assert not P.suit_is_confident(misread)


def test_confident_cards_are_not_dragged_into_review() -> None:
    """The gate has to stay quiet on good reads, or it trains people to ignore it."""
    P._ensure_models()
    for crop in _crops(FIVE_CARD):
        result = P._suit_classifier.predict(_pil(crop))
        assert result.code == "s"
        assert P.suit_is_confident(result)


def test_end_to_end_reports_the_margin_and_the_verdict() -> None:
    from app.recognition.pipeline import recognize_image

    if not FIVE_CARD.is_file():
        pytest.skip("sample photo missing")
    cards, _ = recognize_image(FIVE_CARD.read_bytes())
    assert [c["card_code"] for c in cards] == ["3s", "4s", "5s", "6s", "7s"]
    for card in cards:
        assert card["suit_margin"] > P.SUIT_MIN_MARGIN
        assert card["accepted"]
