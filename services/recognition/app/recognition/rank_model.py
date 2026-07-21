"""RankClassifier — thin wrapper around the ported multi-scan pipeline.

Loads the trained joblib bundle and normalises the raw ``predict_sample`` output
into a stable ``RankResult`` (mirrors the RankMultiScanAdapter in the integration
notebook, cell 5).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from . import _rank_pipeline as rp

# rank 0-based prediction (0..12) → poker rank 1..13 (1=A, 11=J, 12=Q, 13=K)
RANK_DISPLAY = {1: "A", 11: "J", 12: "Q", 13: "K"}


@dataclass
class RankResult:
    rank: int | None          # 1..13, or None if undetermined
    confidence: float | None
    margin: float | None
    accepted: bool


def rank_to_display(rank: int | None) -> str:
    if rank is None:
        return "?"
    return RANK_DISPLAY.get(rank, str(rank))


class RankClassifier:
    def __init__(self, model_path: Path) -> None:
        if not model_path.is_file():
            raise FileNotFoundError(f"Rank model not found: {model_path}")

        self.model_bundle = joblib_load(model_path)

        version = self.model_bundle.get("model_version", "unknown")
        if version not in ("unknown", "multi_scan_hog_svm_v2"):
            print(f"[WARNING] rank model version is '{version}', expected 'multi_scan_hog_svm_v2'")

        # Let the pipeline pick up any scan window / offset overrides saved in the bundle.
        if "scan_window_sizes" in self.model_bundle:
            rp.SCAN_WINDOW_SIZES = self.model_bundle["scan_window_sizes"]
        if "scan_offsets" in self.model_bundle:
            rp.SCAN_OFFSETS = self.model_bundle["scan_offsets"]

    def predict(self, image_path: Path) -> RankResult:
        sample = rp.prepare_unknown_sample(str(image_path))
        raw = rp.predict_sample(sample, self.model_bundle)
        return self._normalise(raw)

    def _normalise(self, raw: Any) -> RankResult:
        if not isinstance(raw, dict):
            raise ValueError(f"predict_sample returned non-dict: {type(raw).__name__}")

        # predict_sample returns 0-based "prediction"; convert to 1..13.
        rank: int | None = None
        if raw.get("prediction") is not None:
            prediction = int(raw["prediction"])
            rank = prediction + 1 if 0 <= prediction <= 12 else prediction

        confidence = raw.get("confidence")
        confidence = float(confidence) if confidence is not None else None

        margin = raw.get("margin")
        margin = float(margin) if margin is not None else None

        accepted = bool(raw.get("accepted", False)) and rank is not None

        if rank is not None and not (1 <= rank <= 13):
            raise ValueError(f"rank out of range 1..13: {rank}")

        return RankResult(rank=rank, confidence=confidence, margin=margin, accepted=accepted)


def joblib_load(path: Path) -> dict:
    import joblib
    return joblib.load(path)
