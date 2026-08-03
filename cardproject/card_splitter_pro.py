"""Card annotation tool — the replacement for card_splitter_first.py.

Usage is unchanged from the original::

    python card_splitter_pro.py --input images/ --output output_results

and so is the output layout, so anything downstream of the old script keeps
working:

    output_results/<image stem>/
        <image stem>.jpg          the original, copied
        cards/card_1.jpg ...      one straightened card each, 256x392 JPEG
        annotated/detected.jpg    the source with the detected quads drawn on
        masks/mask.jpg            the foreground mask

Added on top (all opt-in):

    --debug     write every intermediate image the decision was made from
    --json      write the corner coordinates, scores and engine to results.json
    --engine    auto (default) | classic | learned

What changed underneath is the detection itself; see
``services/recognition/app/recognition/card_splitter_v2.py`` for why the old
edge-tracing and white-thresholding approaches could not be fixed by tuning.
The same detector runs inside the recognition service, so what you annotate here
and what the app sees are the same thing.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

# The detector lives with the service so the app and this tool can never drift.
_SERVICE = Path(__file__).resolve().parents[1] / "services" / "recognition"
if str(_SERVICE) not in sys.path:
    sys.path.insert(0, str(_SERVICE))

from app.recognition import card_splitter_v2 as splitter  # noqa: E402

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}

# Output crop size. Kept at the original script's 256x392 so existing datasets
# and downstream tooling stay byte-compatible. (The recognition service crops the
# same cards at 600x900, which is what its rank model was normalised for.)
CARD_W = 256
CARD_H = 392

JPEG_QUALITY = 95


def imread_unicode(path: Path) -> np.ndarray | None:
    """Read an image through numpy so non-ASCII paths work on every platform."""
    data = np.fromfile(str(path), dtype=np.uint8)
    if data.size == 0:
        return None
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def imwrite_unicode(path: Path, img: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    params = ([int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY]
              if path.suffix.lower() in {".jpg", ".jpeg"} else [])
    success, encoded = cv2.imencode(path.suffix, img, params)
    if not success:
        raise RuntimeError(f"画像保存に失敗しました: {path}")
    encoded.tofile(str(path))


def draw_annotation(image: np.ndarray,
                    quads: list[splitter.CardQuad]) -> np.ndarray:
    annotated = image.copy()
    thickness = max(2, int(round(max(image.shape[:2]) / 400)))
    for idx, card in enumerate(quads):
        box = card.corners.astype(np.int32)
        colour = (0, 165, 255) if card.occluded else (0, 255, 0)
        cv2.drawContours(annotated, [box], 0, colour, thickness)
        x, y, _, _ = cv2.boundingRect(box)
        label = f"card_{idx + 1}" + (" (occluded)" if card.occluded else "")
        cv2.putText(annotated, label, (x, max(y - 10, 24)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
    return annotated


def _combined_mask(debug: dict) -> np.ndarray | None:
    """One foreground mask for masks/mask.jpg, as the original wrote."""
    masks = debug.get("masks")
    if masks:
        stack = list(masks.values())
        combined = np.zeros_like(stack[0])
        for m in stack:
            combined = cv2.bitwise_or(combined, m)
        return combined
    label = debug.get("label_map")
    if label is not None:
        return ((label > 0).astype(np.uint8) * 255)
    return None


def write_debug(debug: dict, quads: list[splitter.CardQuad],
                image: np.ndarray, debug_dir: Path) -> None:
    """Write every intermediate the decision was made from."""
    debug_dir.mkdir(parents=True, exist_ok=True)

    for name, mask in (debug.get("masks") or {}).items():
        imwrite_unicode(debug_dir / f"hypothesis_{name}.jpg", mask)

    label = debug.get("label_map")
    if label is not None:
        # 0 background / 1 interior / 2 border -> black / grey / white
        imwrite_unicode(debug_dir / "unet_labels.jpg",
                        (label.astype(np.uint16) * 120).clip(0, 255).astype(np.uint8))

    # Per-card crops with their quad drawn, so a bad crop is traceable to a
    # bad quad rather than to the warp.
    for idx, card in enumerate(quads):
        crop = splitter.warp_card(image, card, (CARD_W, CARD_H))
        imwrite_unicode(debug_dir / f"card_{idx + 1}_crop.jpg", crop)

    for i, entry in enumerate(debug.get("split") or []):
        profile = entry.get("profile")
        if not profile:
            continue
        # Plot the seam profile that decided how many cards a blob held.
        w = len(profile)
        plot = np.full((160, w, 3), 255, np.uint8)
        pts = [(x, int(159 - min(max(v, 0.0), 1.0) * 155))
               for x, v in enumerate(profile)]
        cv2.polylines(plot, [np.array(pts, np.int32)], False, (0, 0, 0), 1)
        chosen = entry.get("chosen", 1)
        for k in range(1, int(chosen)):
            x = int(w * k / chosen)
            cv2.line(plot, (x, 0), (x, 159), (0, 0, 255), 1)
        cv2.putText(plot, f"cards={chosen} of {entry.get('hypotheses')}",
                    (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 0, 0), 1)
        imwrite_unicode(debug_dir / f"seam_profile_{i + 1}.jpg", plot)


def process_image(image_path: Path, output_dir: Path, *, engine: str,
                  debug: bool, want_json: bool) -> dict | None:
    image = imread_unicode(image_path)
    if image is None:
        print(f"画像を読み込めませんでした: {image_path}")
        return None

    debug_info: dict = {}
    try:
        quads = splitter.detect_cards(image, engine=engine, debug=debug_info)
    except FileNotFoundError as exc:
        # Only `--engine learned` can reach this; `auto` falls back silently.
        raise SystemExit(f"\n{exc}\n") from None

    image_dir = output_dir / image_path.stem
    cards_dir = image_dir / "cards"
    annotated_dir = image_dir / "annotated"
    masks_dir = image_dir / "masks"
    for d in (cards_dir, annotated_dir, masks_dir):
        d.mkdir(parents=True, exist_ok=True)

    imwrite_unicode(image_dir / image_path.name, image)

    print(f"\n画像: {image_path.name}")
    print(f"検出カード数: {len(quads)}")

    records = []
    for idx, card in enumerate(quads):
        crop = splitter.warp_card(image, card, (CARD_W, CARD_H))
        imwrite_unicode(cards_dir / f"card_{idx + 1}.jpg", crop)

        x, y, w, h = cv2.boundingRect(card.corners.astype(np.int32))
        short, long = card.dims()
        print(f"card_{idx + 1}: bbox=({x}, {y}, {w}, {h}), "
              f"aspect={short / long if long else 0:.2f}, "
              f"score={card.score:.2f}"
              + (", occluded" if card.occluded else ""))
        records.append({
            "index": idx + 1,
            "corners": card.corners.tolist(),
            "bbox": [int(x), int(y), int(w), int(h)],
            "aspect": float(short / long) if long else 0.0,
            "score": float(card.score),
            "extent": float(card.extent),
            "edge_support": float(card.edge_support),
            "occluded": bool(card.occluded),
            "sources": sorted(card.sources),
        })

    imwrite_unicode(annotated_dir / "detected.jpg", draw_annotation(image, quads))

    mask = _combined_mask(debug_info)
    if mask is not None:
        if mask.shape[:2] != image.shape[:2]:
            mask = cv2.resize(mask, (image.shape[1], image.shape[0]),
                              interpolation=cv2.INTER_NEAREST)
        imwrite_unicode(masks_dir / "mask.jpg", mask)

    if debug:
        write_debug(debug_info, quads, image, image_dir / "debug")

    result = {
        "image": image_path.name,
        "count": len(quads),
        "engine": debug_info.get("engine", engine),
        "fallback": debug_info.get("fallback"),
        "cards": records,
    }
    if want_json:
        (image_dir / "results.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="トランプ画像からカードを検出し、1枚ずつ切り出します。")
    parser.add_argument("--input", type=str, required=True,
                        help="入力画像ファイル、または画像フォルダ")
    parser.add_argument("--output", type=str, default="output_results",
                        help="出力フォルダ")
    parser.add_argument("--engine", choices=["auto", "classic", "learned"],
                        default="auto",
                        help="検出エンジン。auto は学習モデルがあれば使い、"
                             "無い/失敗した場合は古典的手法に自動で戻ります。")
    parser.add_argument("--debug", action="store_true",
                        help="判断根拠となる中間画像をすべて出力します")
    parser.add_argument("--json", action="store_true", dest="want_json",
                        help="座標とスコアを results.json に出力します")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_dir = Path(args.output)

    if input_path.is_file():
        targets = [input_path]
    elif input_path.is_dir():
        targets = sorted(p for p in input_path.iterdir()
                         if p.suffix.lower() in IMAGE_EXTENSIONS)
        if not targets:
            print("画像ファイルが見つかりませんでした。")
            return
    else:
        print(f"入力パスが存在しません: {input_path}")
        return

    results = []
    for path in targets:
        result = process_image(path, output_dir, engine=args.engine,
                               debug=args.debug, want_json=args.want_json)
        if result:
            results.append(result)

    total = sum(r["count"] for r in results)
    print(f"\n完了しました。{len(results)}枚の画像から{total}枚のカードを切り出しました。")
    if args.want_json and results:
        (output_dir / "summary.json").write_text(
            json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
