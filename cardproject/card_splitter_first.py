import cv2
import numpy as np
from pathlib import Path
import argparse


# =========================
# 設定
# =========================
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}

# 出力するカード画像サイズ
CARD_W = 256
CARD_H = 392
PADDING_RATIO = 0.06

# 検出するカード枚数
DEFAULT_NUM_CARDS = 5


# =========================
# imread / imwrite
# =========================
def imread_unicode(path):
    path = Path(path)
    data = np.fromfile(str(path), dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    return img


def imwrite_unicode(path, img):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    ext = path.suffix
    success, encoded = cv2.imencode(ext, img)

    if success:
        encoded.tofile(str(path))
    else:
        raise RuntimeError(f"画像保存に失敗しました: {path}")


# =========================
# 点の順序を左上・右上・右下・左下に並べる
# =========================
def order_points(pts):
    pts = np.array(pts, dtype=np.float32)

    rect = np.zeros((4, 2), dtype=np.float32)

    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).reshape(-1)

    rect[0] = pts[np.argmin(s)]       # 左上
    rect[2] = pts[np.argmax(s)]       # 右下
    rect[1] = pts[np.argmin(diff)]    # 右上
    rect[3] = pts[np.argmax(diff)]    # 左下

    return rect

# =========================
# カード周囲へ余白を追加
# =========================
def expand_box(box, ratio=PADDING_RATIO):
    """
    カード四隅を中心から外側へ拡大することで
    カード周囲に少し余白を付ける。
    """
    box = np.array(box, dtype=np.float32)

    # 四角形の中心
    center = np.mean(box, axis=0)

    # 中心から外側へ拡大
    expanded = center + (box - center) * (1.0 + ratio)

    return expanded

# =========================
# 回転したカードを正面向きに射影変換
# =========================
def warp_card(image, box, output_size=(CARD_W, CARD_H)):
    rect = expand_box(order_points(box))

    tl, tr, br, bl = rect

    width_top = np.linalg.norm(tr - tl)
    width_bottom = np.linalg.norm(br - bl)
    height_right = np.linalg.norm(br - tr)
    height_left = np.linalg.norm(bl - tl)

    warp_w = int(max(width_top, width_bottom))
    warp_h = int(max(height_right, height_left))

    warp_w = max(warp_w, 1)
    warp_h = max(warp_h, 1)

    dst = np.array([
        [0, 0],
        [warp_w - 1, 0],
        [warp_w - 1, warp_h - 1],
        [0, warp_h - 1]
    ], dtype=np.float32)

    M = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(image, M, (warp_w, warp_h))

    # 横長になった場合は縦長に回転
    if warped.shape[1] > warped.shape[0]:
        warped = cv2.rotate(warped, cv2.ROTATE_90_CLOCKWISE)

    warped = cv2.resize(warped, output_size)

    return warped


# =========================
# bboxの重なり率計算
# =========================
def xyxy_from_box(box):
    x, y, w, h = cv2.boundingRect(box.astype(np.int32))
    return np.array([x, y, x + w, y + h], dtype=np.float32)


def bbox_iou(box_a, box_b):
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

    return inter_area / union


# =========================
# 重複候補を除去
# =========================
def non_max_suppression(candidates, iou_threshold=0.3):
    selected = []

    for cand in candidates:
        keep = True

        for sel in selected:
            iou = bbox_iou(cand["box"], sel["box"])
            if iou > iou_threshold:
                keep = False
                break

        if keep:
            selected.append(cand)

    return selected


# =========================
# カード領域検出
# =========================
def detect_card_regions(image, num_cards=2):
    img_h, img_w = image.shape[:2]
    image_area = img_h * img_w

    # =========================
    # 1. グレースケール化
    # =========================
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # =========================
    # 2. コントラスト補正
    #    デザインや照明差に強くする
    # =========================
    clahe = cv2.createCLAHE(
        clipLimit=2.0,
        tileGridSize=(8, 8)
    )
    gray = clahe.apply(gray)

    # =========================
    # 3. ノイズ除去
    # =========================
    blur = cv2.GaussianBlur(gray, (5, 5), 0)

    # =========================
    # 4. Cannyでエッジ検出
    # =========================
    median_val = np.median(blur)
    lower = int(max(0, 0.66 * median_val))
    upper = int(min(255, 1.33 * median_val))

    edges = cv2.Canny(blur, lower, upper)

    # =========================
    # 5. エッジをつなげる
    #    カード外枠が途切れていても検出しやすくする
    # =========================
    kernel = np.ones((7, 7), np.uint8)

    edges_closed = cv2.morphologyEx(
        edges,
        cv2.MORPH_CLOSE,
        kernel,
        iterations=2
    )

    edges_closed = cv2.dilate(
        edges_closed,
        kernel,
        iterations=1
    )

    # =========================
    # 6. 輪郭検出
    # =========================
    contours, _ = cv2.findContours(
        edges_closed,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE
    )

    candidates = []

    for cnt in contours:
        area = cv2.contourArea(cnt)

        # 小さすぎる領域は除外
        if area < image_area * 0.02:
            continue

        # 大きすぎる領域は除外
        if area > image_area * 0.90:
            continue

        # 輪郭を近似
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.03 * peri, True)

        # 回転矩形を取得
        rect = cv2.minAreaRect(cnt)
        (cx, cy), (rw, rh), angle = rect

        if rw <= 0 or rh <= 0:
            continue

        rect_area = rw * rh

        if rect_area <= 0:
            continue

        # =========================
        # トランプらしい縦横比
        # 一般的なカードは 1.4 前後
        # ただし撮影角度を考えて広めに取る
        # =========================
        aspect_ratio = max(rw, rh) / min(rw, rh)

        if not (1.15 <= aspect_ratio <= 1.85):
            continue

        # =========================
        # 矩形の中を輪郭がどれだけ占めるか
        # 長方形らしさの判定
        # =========================
        extent = area / rect_area

        if extent < 0.45:
            continue

        # =========================
        # 輪郭が四角形に近いか
        # 4点ぴったりでなくてもカード候補にする
        # =========================
        num_vertices = len(approx)

        if num_vertices > 10:
            continue

        box = cv2.boxPoints(rect)
        box = np.array(box, dtype=np.float32)

        candidates.append({
            "box": box,
            "area": area,
            "aspect_ratio": aspect_ratio,
            "extent": extent,
            "vertices": num_vertices
        })

    # =========================
    # 面積が大きい順に並べる
    # =========================
    candidates = sorted(
        candidates,
        key=lambda x: x["area"],
        reverse=True
    )

    # =========================
    # 重複候補を除去
    # =========================
    candidates = non_max_suppression(
        candidates,
        iou_threshold=0.3
    )

    # 上位num_cards枚を採用
    selected = candidates[:num_cards]

    # 左上から順に並べる
    selected = sorted(
        selected,
        key=lambda c: (
            cv2.boundingRect(c["box"].astype(np.int32))[1],
            cv2.boundingRect(c["box"].astype(np.int32))[0]
        )
    )

    return selected, edges_closed


# =========================
# 1枚の画像を処理
# =========================
def process_image(image_path, output_dir, num_cards=2):
    image_path = Path(image_path)
    output_dir = Path(output_dir)

    image = imread_unicode(image_path)

    if image is None:
        print(f"画像を読み込めませんでした: {image_path}")
        return

    selected, mask = detect_card_regions(image, num_cards=num_cards)

    annotated = image.copy()

    #画像ごとに保存フォルダを作成
    image_dir = output_dir / image_path.stem

    cards_dir = image_dir / "cards"
    annotated_dir = image_dir / "annotated"
    masks_dir = image_dir / "masks"

    cards_dir.mkdir(parents=True, exist_ok=True)
    annotated_dir.mkdir(parents=True, exist_ok=True)
    masks_dir.mkdir(parents=True, exist_ok=True)

    # 元画像も保尊
    original_path = image_dir / image_path.name
    imwrite_unicode(original_path, image)

    print(f"\n画像: {image_path.name}")
    print(f"検出カード数: {len(selected)}")

    for idx, card in enumerate(selected):
        box = card["box"]
        box_int = box.astype(np.int32)

        # bbox描画
        cv2.drawContours(annotated, [box_int], 0, (0, 255, 0), 3)

        x, y, w, h = cv2.boundingRect(box_int)

        cv2.putText(
            annotated,
            f"card_{idx + 1}",
            (x, max(y - 10, 20)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (0, 0, 255),
            2
        )

        # 射影変換してカード部分を切り出し
        card_crop = warp_card(image, box)

        crop_path = cards_dir / f"card_{idx+1}.jpg"
        imwrite_unicode(crop_path, card_crop)

        print(
            f"card_{idx + 1}: "
            f"bbox=({x}, {y}, {w}, {h}), "
            f"aspect={card['aspect_ratio']:.2f}, "
        )

    # 検出結果画像を保存
    annotated_path = annotated_dir / "detected.jpg"
    imwrite_unicode(annotated_path, annotated)

    # マスク画像も保存
    mask_path = masks_dir / "mask.jpg"
    imwrite_unicode(mask_path, mask)

    if len(selected) < num_cards:
        print("注意: 指定枚数より少ないカードしか検出できませんでした。")
        print("背景色、照明、カード同士の重なり、しきい値を確認してください。")


# =========================
# メイン処理
# =========================
def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--input",
        type=str,
        required=True,
        help="入力画像ファイル、または画像フォルダ"
    )

    parser.add_argument(
        "--output",
        type=str,
        default="output_results",
        help="出力フォルダ"
    )

    parser.add_argument(
        "--num_cards",
        type=int,
        default=DEFAULT_NUM_CARDS,
        help="検出するカード枚数"
    )

    args = parser.parse_args()

    input_path = Path(args.input)
    output_dir = Path(args.output)

    if input_path.is_file():
        process_image(
            image_path=input_path,
            output_dir=output_dir,
            num_cards=args.num_cards
        )

    elif input_path.is_dir():
        image_paths = sorted([
            p for p in input_path.iterdir()
            if p.suffix.lower() in IMAGE_EXTENSIONS
        ])

        if len(image_paths) == 0:
            print("画像ファイルが見つかりませんでした。")
            return

        for image_path in image_paths:
            process_image(
                image_path=image_path,
                output_dir=output_dir,
                num_cards=args.num_cards
            )

    else:
        print(f"入力パスが存在しません: {input_path}")


if __name__ == "__main__":
    main()