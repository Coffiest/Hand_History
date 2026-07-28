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
    accepted: bool            # both models confident enough to auto-accept


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
    accepted = rank_result.accepted and rank_result.rank is not None
    rank_code = str(rank_result.rank) if rank_result.rank is not None else "?"

    payload = asdict(CardResult(
        index=index,
        rank=rank_result.rank,
        suit=suit_result.code,
        rank_label=rank_label,
        card_code=f"{rank_code}{suit_result.code}",
        rank_confidence=rank_result.confidence,
        suit_confidence=suit_result.confidence,
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


def _splitter_debug(bgr: np.ndarray, selected: list[dict], mask: np.ndarray) -> dict[str, Any]:
    """The pictures card_splitter_first.py's process_image writes to disk.

    Same three artefacts — the source frame, the detection overlay and the edge
    mask the contours came from — returned inline instead of saved, so the split
    step can be inspected from the app.
    """
    annotated = bgr.copy()
    for i, card in enumerate(selected):
        box = card["box"].astype(np.int32)
        cv2.drawContours(annotated, [box], 0, (0, 255, 0), 3)
        x, y, _, _ = cv2.boundingRect(box)
        cv2.putText(annotated, f"card_{i + 1}", (x, max(y - 10, 20)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)

    return {
        "original": _png_uri(bgr),
        "annotated": _png_uri(annotated),
        "mask": _png_uri(mask),
        "detected_count": len(selected),
        "candidates": [
            {
                "index": i,
                "area": round(float(c["area"]), 1),
                "aspect_ratio": round(float(c["aspect_ratio"]), 3),
                "extent": round(float(c["extent"]), 3),
                "vertices": int(c["vertices"]),
            }
            for i, c in enumerate(selected)
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
    from .card_splitter import detect_card_regions, warp_card

    array = np.frombuffer(image_bytes, dtype=np.uint8)
    bgr = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("Could not decode the uploaded image")

    selected, mask = detect_card_regions(bgr, num_cards=expected_count)
    scene_debug = _splitter_debug(bgr, selected, mask) if debug else None

    crops = [warp_card(bgr, card["box"]) for card in selected]
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
