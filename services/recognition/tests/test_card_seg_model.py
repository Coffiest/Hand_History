"""Tests for the learned segmentation engine and how ``auto`` uses it.

The regression these exist for: completing a partial card to the known 2.5:3.5
rectangle *forces* the aspect ratio, so a quad extrapolated from a sliver or
from several merged cards looks perfectly card-shaped while being nonsense. On
a real five-card photo that produced a quad with nineteen times a card's area.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest

from app.recognition import card_seg_model as csm
from app.recognition import card_splitter_v2 as v2

REPO = Path(__file__).resolve().parents[3]
PHOTOS = [
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


def _require_weights() -> None:
    if not csm.weights_available():
        pytest.skip("card_seg_unet.pt not present in this checkout")


def test_weights_load_and_produce_card_shaped_quads() -> None:
    _require_weights()
    image = _load(PHOTOS[3][0])
    quads = csm.detect_cards_learned(image)
    assert quads
    for q in quads:
        short, long = q.dims()
        assert long > 0
        assert 0.55 <= short / long <= 0.92


def test_completion_never_invents_a_card_from_a_sliver() -> None:
    """A thin fragment must not become a full-size card.

    Without the growth bound this returns a rectangle many times the fragment's
    area — and one that passes every aspect-ratio check, because the completion
    sets the aspect ratio itself.
    """
    sliver = np.array([[10, 10], [14, 10], [14, 210], [10, 210]], np.int32)
    assert csm._complete_to_card(sliver.reshape(-1, 1, 2)) is None

    # A card missing a third of its width is a genuine completion and must work.
    partial = np.array([[0, 0], [95, 0], [95, 200], [0, 200]], np.int32)
    completed = csm._complete_to_card(partial.reshape(-1, 1, 2))
    assert completed is not None
    q = v2.CardQuad(completed)
    short, long = q.dims()
    assert v2.CARD_ASPECT * 0.9 <= short / long <= v2.CARD_ASPECT * 1.1


def test_learned_quads_agree_on_one_card_size() -> None:
    """The blow-up regression, checked on the photo that exposed it."""
    _require_weights()
    quads = csm.detect_cards_learned(_load(PHOTOS[0][0]))
    assert quads
    areas = sorted(q.area for q in quads)
    assert areas[-1] / areas[0] < 2.0, f"sizes disagree wildly: {areas}"


@pytest.mark.parametrize("path,expected", PHOTOS, ids=[p.stem for p, _ in PHOTOS])
def test_auto_reads_the_real_photos_exactly(path: Path, expected: int) -> None:
    """What the app actually calls, with whatever weights this checkout has."""
    assert len(v2.detect_cards(_load(path), engine="auto")) == expected


def test_auto_falls_back_when_the_weights_are_missing() -> None:
    """A checkout or image without the model must still detect."""
    original = csm.WEIGHTS_PATH
    try:
        csm.set_weights_path(original.parent / "does_not_exist.pt")
        debug: dict = {}
        quads = v2.detect_cards(_load(PHOTOS[1][0]), engine="auto", debug=debug)
        assert len(quads) == 2
        assert debug.get("fallback") == "no weights"
    finally:
        csm.set_weights_path(original)


def test_auto_survives_an_unreadable_model() -> None:
    """A corrupt file must degrade to the classical engine, not fail the request.

    ``auto`` only reaches the model when the classical read looks doubtful, so
    this checks the guarantee from both ends: loading raises where the failure
    happens, and ``auto`` still answers correctly regardless of which path it
    took for a given photo.
    """
    bad = Path("/tmp/handhistory_bad_weights.pt")
    bad.write_bytes(b"not a torchscript archive")
    original = csm.WEIGHTS_PATH
    try:
        csm.set_weights_path(bad)

        with pytest.raises(Exception):
            csm.detect_cards_learned(_load(PHOTOS[1][0]))

        for path, expected in PHOTOS:
            assert len(v2.detect_cards(_load(path), engine="auto")) == expected
    finally:
        csm.set_weights_path(original)
        bad.unlink(missing_ok=True)
