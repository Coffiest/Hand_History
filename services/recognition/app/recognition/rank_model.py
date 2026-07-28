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
    # Populated only when predict(..., debug=True): the intermediate images and
    # numbers the v3 notebook writes to _rank_debug/, so a bad read can be
    # diagnosed from the app instead of guessing.
    debug: dict[str, Any] | None = None


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

    def predict(self, image_path: Path, debug: bool = False) -> RankResult:
        sample = rp.prepare_unknown_sample(str(image_path))
        raw = rp.predict_sample(sample, self.model_bundle)
        result = self._normalise(raw)
        if debug:
            result.debug = _collect_debug(raw, self.model_bundle)
        return result

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


def _png_data_uri(path_or_array: Any) -> str | None:
    """Encode an image (file path or array) as a data: URI for the client."""
    import base64

    import cv2
    import numpy as np

    try:
        if isinstance(path_or_array, (str, Path)):
            image = cv2.imread(str(path_or_array), cv2.IMREAD_UNCHANGED)
        else:
            image = np.asarray(path_or_array)
        if image is None or image.size == 0:
            return None
        ok, buf = cv2.imencode(".png", image)
        if not ok:
            return None
        return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode("ascii")
    except Exception:
        return None


def _collect_debug(raw: dict, bundle: dict) -> dict[str, Any]:
    """Gather the v3 notebook's rank debug artefacts for the chosen candidate.

    Mirrors what card_recognizer_integrated_v3.ipynb saves under _rank_debug/:
    the rectified card, the black-and-white top/bottom digit images actually fed
    to the classifier, the extraction score, rotation and scan window, plus the
    top 3 classes. Everything is returned inline — nothing is written to disk.
    """
    import numpy as np

    candidate = raw.get("candidate", {}) or {}
    probability = raw.get("probability")

    top3: list[dict[str, Any]] = []
    if probability is not None:
        probs = np.asarray(probability, dtype=float).reshape(-1)
        for class_index in np.argsort(probs)[::-1][:3]:
            top3.append(
                {
                    "rank": int(class_index) + 1,
                    "probability": round(float(probs[class_index]), 4),
                }
            )

    window = candidate.get("window") or {}
    return {
        "rectified_image": _png_data_uri(candidate.get("rectified_image"))
        if candidate.get("rectified_image") is not None
        else None,
        "top_image": _png_data_uri(candidate.get("top_path")),
        "bottom_image": _png_data_uri(candidate.get("bottom_path")),
        "top_prediction": (int(raw["top_prediction"]) + 1) if raw.get("top_prediction") is not None else None,
        "bottom_prediction": (int(raw["bottom_prediction"]) + 1) if raw.get("bottom_prediction") is not None else None,
        "extraction_score": round(float(candidate.get("score", 0.0)), 4),
        "similarity": round(float(candidate.get("similarity", 0.0)), 4),
        "rotation": int(candidate.get("rotation", 0)),
        "input_mode": candidate.get("input_mode"),
        "quad_method": candidate.get("quad_method"),
        "window": {k: round(float(v), 3) for k, v in window.items()} if window else None,
        "candidate_count": len(raw.get("all_evaluated_candidates") or []),
        "top3": top3,
    }
