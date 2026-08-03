"""Score the trained model against the classical engine, split by layout.

One overall number would hide the thing that matters. The classical detector is
already strong on well-separated cards and helpless once they overlap, so the
report breaks results out by layout — a model that improves the average while
regressing the separated case is not an improvement.
"""

from __future__ import annotations

from typing import Sequence

import cv2
import numpy as np

import card_synth as cs

MODES = ["row_gap", "row_touch", "row_overlap", "fan"]
MODE_LABEL_JA = {
    "row_gap": "離れて並ぶ",
    "row_touch": "接触",
    "row_overlap": "重なり",
    "fan": "扇状（持ち手）",
}
IOU_MATCH = 0.7


def _quad_iou(a: np.ndarray, b: np.ndarray, shape: tuple[int, int]) -> float:
    h, w = shape
    ma = np.zeros((h, w), np.uint8)
    mb = np.zeros((h, w), np.uint8)
    cv2.fillConvexPoly(ma, a.astype(np.int32), 1)
    cv2.fillConvexPoly(mb, b.astype(np.int32), 1)
    union = int(np.count_nonzero(ma | mb))
    return int(np.count_nonzero(ma & mb)) / union if union else 0.0


def build_benchmark(cards: Sequence[np.ndarray], plates: Sequence[cs.Plate],
                    per_mode: int = 30, seed: int = 20260803,
                    size: tuple[int, int] = (720, 540)) -> dict:
    """Fixed scenes, so two engines are scored on exactly the same images."""
    rng = np.random.default_rng(seed)
    bench: dict[str, list] = {}
    for mode in MODES:
        items = []
        while len(items) < per_mode:
            scene = cs.compose_scene(cards, plates, rng, size=size, mode=mode)
            if not scene.cards:
                continue
            items.append((scene.image, [c.quad for c in scene.cards]))
        bench[mode] = items
    return bench


def score(bench: dict, detect) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for mode, items in bench.items():
        count_exact = matched = truth_total = pred_total = 0
        for image, truth in items:
            pred = detect(image)
            truth_total += len(truth)
            pred_total += len(pred)
            if len(pred) == len(truth):
                count_exact += 1
            used: set[int] = set()
            for t in truth:
                best, best_j = 0.0, -1
                for j, p in enumerate(pred):
                    if j in used:
                        continue
                    v = _quad_iou(t, p.corners, image.shape[:2])
                    if v > best:
                        best, best_j = v, j
                if best_j >= 0 and best >= IOU_MATCH:
                    used.add(best_j)
                    matched += 1
        out[mode] = {
            "count_exact": count_exact / max(len(items), 1),
            "recall": matched / max(truth_total, 1),
            "precision": matched / max(pred_total, 1),
        }
    return out


def _engines():
    """Import both engines, whether standing alone or inside the repo package.

    On Colab the notebook drops every module into one directory, so a plain
    import finds them. In the repo they live inside the recognition service's
    package, which a plain import cannot reach — and this module is useful from
    there too, for checking a downloaded model before it ships.
    """
    try:
        import card_seg_model  # type: ignore
        import card_splitter_v2 as v2  # type: ignore
        return card_seg_model, v2
    except ImportError:
        pass

    import sys
    from pathlib import Path

    service = Path(__file__).resolve().parents[2] / "services" / "recognition"
    if str(service) not in sys.path:
        sys.path.insert(0, str(service))
    from app.recognition import card_seg_model  # type: ignore
    from app.recognition import card_splitter_v2 as v2  # type: ignore
    return card_seg_model, v2


def report(cards: Sequence[np.ndarray], plates: Sequence[cs.Plate],
           weights_path: str, per_mode: int = 30) -> dict:
    """Print a side-by-side comparison and return the raw numbers."""
    card_seg_model, v2 = _engines()

    print(f"ベンチマークを作成中（各レイアウト {per_mode} シーン）...")
    bench = build_benchmark(cards, plates, per_mode=per_mode)

    card_seg_model.set_weights_path(weights_path)
    results = {
        "classic": score(bench, lambda im: v2.detect_cards_classic(im)),
        "learned": score(bench, lambda im: card_seg_model.detect_cards_learned(im)),
    }

    header = (f"{'レイアウト':<16}{'枚数一致':>18}{'検出率':>18}{'適合率':>18}")
    print("\n" + header)
    print(f"{'':<16}{'古典 → 学習':>20}{'古典 → 学習':>20}{'古典 → 学習':>20}")
    print("-" * 74)
    for mode in MODES:
        c = results["classic"][mode]
        l = results["learned"][mode]
        print(f"{MODE_LABEL_JA[mode]:<16}"
              f"{c['count_exact']:>7.0%} → {l['count_exact']:<7.0%}"
              f"{c['recall']:>9.0%} → {l['recall']:<7.0%}"
              f"{c['precision']:>9.0%} → {l['precision']:<7.0%}")

    def mean(engine: str, key: str) -> float:
        return float(np.mean([results[engine][m][key] for m in MODES]))

    print("-" * 74)
    print(f"{'平均':<16}"
          f"{mean('classic', 'count_exact'):>7.0%} → {mean('learned', 'count_exact'):<7.0%}"
          f"{mean('classic', 'recall'):>9.0%} → {mean('learned', 'recall'):<7.0%}"
          f"{mean('classic', 'precision'):>9.0%} → {mean('learned', 'precision'):<7.0%}")
    print("\n検出率 = 正解カードのうち IoU 0.7 以上で見つけられた割合")
    return results
