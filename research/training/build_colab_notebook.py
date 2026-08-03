"""Generate the self-contained Colab notebook from the real module sources.

The notebook has to run on Colab against a private repo, so it can't clone
anything. Rather than maintaining a second copy of the training code by hand —
which would drift from the code that actually ships — this script reads the
modules here and embeds them, so the notebook is regenerated instead of edited:

    python research/training/build_colab_notebook.py
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
OUT = REPO / "research" / "notebooks" / "card_seg_synth_train.ipynb"

# Written into /content on Colab, in dependency order.
MODULES = [
    REPO / "services/recognition/app/recognition/card_splitter_v2.py",
    REPO / "services/recognition/app/recognition/card_seg_model.py",
    HERE / "card_synth.py",
    HERE / "tiny_unet.py",
    HERE / "train_card_seg.py",
    HERE / "card_seg_eval.py",
]


def md(text: str) -> dict:
    return {"cell_type": "markdown", "metadata": {},
            "source": text.strip("\n").splitlines(keepends=True)}


def code(text: str) -> dict:
    return {"cell_type": "code", "execution_count": None, "metadata": {},
            "outputs": [], "source": text.strip("\n").splitlines(keepends=True)}


def module_cell() -> dict:
    payload = {p.name: p.read_text(encoding="utf-8") for p in MODULES}
    blob = json.dumps(payload, ensure_ascii=False)
    return code(
        "# このセルが学習に必要なプログラムを /content に書き出します。\n"
        "# （リポジトリの実物から自動生成しているので、中身は本番と同一です）\n"
        "import json, pathlib, sys\n\n"
        f"FILES = json.loads(r'''{blob}''')\n\n"
        "for name, text in FILES.items():\n"
        "    pathlib.Path('/content', name).write_text(text, encoding='utf-8')\n"
        "    print('wrote', name, f'({len(text.splitlines())} lines)')\n\n"
        "if '/content' not in sys.path:\n"
        "    sys.path.insert(0, '/content')\n"
    )


def build() -> None:
    cells = [
        md("""
# トランプ分割モデルの学習（Colab / CPU可）

このノートブックは、Google Drive にある**実写真363枚**（1枚に1カード）から
学習データを自動生成し、カードの**重なりを分離できる**セグメンテーションモデルを学習します。

**やること（上から順にセルを実行するだけ）**

1. Drive をマウント
2. 学習プログラムを書き出す
3. 写真からカードと背景を取り出す
4. 重なり込みの合成シーンを作る
5. 学習する（GPUが無くても動きます）
6. 精度を確認する
7. 重みファイルを Drive に保存する

最後に出力される `card_seg_unet.pt` を、リポジトリの
`services/recognition/models/` に置いてデプロイしてください。

**注意**: 学習に使うのは Drive の実写真だけです。アプリ表示用のデザインカード画像
（`apps/web/public/cards/`）は使いません。
"""),
        md("## 1. Drive をマウント"),
        code(
            "from google.colab import drive\n"
            "drive.mount('/content/drive')\n"
        ),
        md("## 2. 学習プログラムを書き出す"),
        module_cell(),
        md("""
## 3. 写真からカードと背景を取り出す

各写真から「平らに直したカード」と「カードを消したテーブル」を取り出します。
1枚だけ写っている写真は検出が確実なので、ここは自動で通ります。
うまく検出できなかった写真は自動的に除外されます。

`PHOTO_DIR` が違う場合はここを書き換えてください。
"""),
        code(
            "PHOTO_DIR = '/content/drive/MyDrive/data_set_pre/jpg'\n"
            "\n"
            "import pathlib, cv2, numpy as np\n"
            "import card_synth as cs\n"
            "\n"
            "EXTS = {'.jpg', '.jpeg', '.png', '.bmp'}\n"
            "paths = sorted(p for p in pathlib.Path(PHOTO_DIR).rglob('*')\n"
            "               if p.suffix.lower() in EXTS)\n"
            "print(f'写真: {len(paths)} 枚')\n"
            "assert paths, f'画像が見つかりません: {PHOTO_DIR}'\n"
            "\n"
            "cards, plates = cs.load_sources(paths)\n"
            "print(f'\\n取り出せたカード: {len(cards)} 枚 / 背景: {len(plates)} 枚')\n"
            "assert cards and plates, 'カードを取り出せませんでした。PHOTO_DIR を確認してください。'\n"
            "\n"
            "# 素材を学習用と評価用に分けます。同じカード・同じ背景で学習して評価すると\n"
            "# 「見たことのある絵柄」を当てているだけになり、精度が実力より高く出ます。\n"
            "rs = np.random.RandomState(0)\n"
            "idx = rs.permutation(len(cards))\n"
            "n_hold = max(1, int(len(cards) * 0.15))\n"
            "cards_test = [cards[i] for i in idx[:n_hold]]\n"
            "cards_train = [cards[i] for i in idx[n_hold:]]\n"
            "pidx = rs.permutation(len(plates))\n"
            "p_hold = max(1, int(len(plates) * 0.15))\n"
            "plates_test = [plates[i] for i in pidx[:p_hold]]\n"
            "plates_train = [plates[i] for i in pidx[p_hold:]]\n"
            "print(f'学習用: カード{len(cards_train)} 背景{len(plates_train)} / "
            "評価用(未使用): カード{len(cards_test)} 背景{len(plates_test)}')\n"
        ),
        code(
            "# 取り出した結果を目視確認\n"
            "import matplotlib.pyplot as plt\n"
            "\n"
            "fig, axes = plt.subplots(2, 6, figsize=(15, 6))\n"
            "for i, ax in enumerate(axes[0]):\n"
            "    ax.imshow(cv2.cvtColor(cards[i % len(cards)], cv2.COLOR_BGR2RGB))\n"
            "    ax.set_title('card'); ax.axis('off')\n"
            "for i, ax in enumerate(axes[1]):\n"
            "    ax.imshow(cv2.cvtColor(plates[i % len(plates)].image, cv2.COLOR_BGR2RGB))\n"
            "    ax.set_title('background'); ax.axis('off')\n"
            "plt.tight_layout(); plt.show()\n"
        ),
        md("""
## 4. 合成シーンを作る

カードを2〜5枚、ランダムに回転・遠近・**重なり**・光沢・影を付けて背景に配置します。
自分で配置しているので、正解は画素単位で完全に正確です。
"""),
        code(
            "from tiny_unet import INPUT_W, INPUT_H\n"
            "\n"
            "N_TRAIN = 3000   # CPUで重い場合は 1500 程度に下げてください\n"
            "N_VAL = 300\n"
            "\n"
            "import time\n"
            "def make(n, seed):\n"
            "    rng = np.random.default_rng(seed)\n"
            "    ims, labs = [], []\n"
            "    t0 = time.time()\n"
            "    while len(ims) < n:\n"
            "        s = cs.compose_scene(cards_train, plates_train, rng, size=(INPUT_W, INPUT_H))\n"
            "        if not s.cards:\n"
            "            continue\n"
            "        ims.append(s.image); labs.append(s.label_map(border_px=2))\n"
            "        if len(ims) % 500 == 0:\n"
            "            print(f'  {len(ims)}/{n}  ({time.time()-t0:.0f}s)')\n"
            "    return ims, labs\n"
            "\n"
            "train_imgs, train_labs = make(N_TRAIN, 1)\n"
            "val_imgs, val_labs = make(N_VAL, 2)\n"
            "print(f'学習 {len(train_imgs)} / 検証 {len(val_imgs)}')\n"
        ),
        code(
            "# 合成シーンと正解ラベルを確認（黒=背景 / 灰=カード内部 / 白=境界）\n"
            "fig, axes = plt.subplots(2, 4, figsize=(15, 6))\n"
            "for i in range(4):\n"
            "    axes[0][i].imshow(cv2.cvtColor(train_imgs[i], cv2.COLOR_BGR2RGB))\n"
            "    axes[0][i].axis('off')\n"
            "    axes[1][i].imshow(train_labs[i], vmin=0, vmax=2, cmap='gray')\n"
            "    axes[1][i].axis('off')\n"
            "plt.tight_layout(); plt.show()\n"
        ),
        md("""
## 5. 学習

GPUがあれば自動で使います。無い場合もCPUで動くようにモデルを小さく設計してあります
（約39万パラメータ）。時間がかかる場合は上の `N_TRAIN` と下の `EPOCHS` を下げてください。
"""),
        code(
            "import torch, torch.nn.functional as F, random\n"
            "from torch.utils.data import DataLoader\n"
            "from tiny_unet import TinyUNet, count_parameters, normalise\n"
            "import train_card_seg as T\n"
            "\n"
            "EPOCHS = 28\n"
            "BATCH = 8\n"
            "LR = 3e-3\n"
            "\n"
            "torch.manual_seed(0); random.seed(0); np.random.seed(0)\n"
            "device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')\n"
            "print('device:', device)\n"
            "\n"
            "tl = DataLoader(T.SceneDataset(train_imgs, train_labs, True),\n"
            "                batch_size=BATCH, shuffle=True, drop_last=True, num_workers=2)\n"
            "vl = DataLoader(T.SceneDataset(val_imgs, val_labs, False),\n"
            "                batch_size=BATCH, num_workers=2)\n"
            "\n"
            "model = TinyUNet(width=16).to(device)\n"
            "print(f'パラメータ数: {count_parameters(model):,}')\n"
            "\n"
            "cw = torch.tensor([0.6, 1.0, 3.0], device=device)\n"
            "opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=1e-4)\n"
            "sched = torch.optim.lr_scheduler.OneCycleLR(\n"
            "    opt, max_lr=LR, total_steps=EPOCHS * len(tl), pct_start=0.25)\n"
            "\n"
            "best = -1.0\n"
            "for ep in range(1, EPOCHS + 1):\n"
            "    model.train(); t0 = time.time(); run = 0.0\n"
            "    for x, y in tl:\n"
            "        x, y = x.to(device), y.to(device)\n"
            "        logits = model(normalise(x))\n"
            "        loss = F.cross_entropy(logits, y, weight=cw) + T.dice_loss(logits, y)\n"
            "        opt.zero_grad(set_to_none=True); loss.backward(); opt.step(); sched.step()\n"
            "        run += float(loss)\n"
            "    st = T.evaluate(model, vl, device, cw)\n"
            "    print(f\"ep{ep:3d}/{EPOCHS} train={run/len(tl):.4f} val={st['loss']:.4f} \"\n"
            "          f\"IoU 内部={st['iou_interior']:.3f} 境界={st['iou_border']:.3f} \"\n"
            "          f'({time.time()-t0:.0f}s)')\n"
            "    if st['miou_cards'] > best:\n"
            "        best = st['miou_cards']\n"
            "        T.save(model, '/content/card_seg_unet.pt', 16)\n"
            "        print(f'  → 保存しました (mIoU {best:.3f})')\n"
            "print(f'\\n完了。ベスト mIoU = {best:.3f}')\n"
        ),
        md("""
## 6. 精度を確認する

**枚数がぴったり合った割合**と**1枚ごとの検出率**を、重なりの有無で分けて出します。
古典的手法（学習なし）と並べて比べられます。
"""),
        code(
            "import card_splitter_v2 as v2\n"
            "import card_seg_eval\n"
            "\n"
            "# 学習に使っていないカード・背景だけでベンチマークを作って採点します。\n"
            "card_seg_eval.report(cards_test, plates_test, '/content/card_seg_unet.pt')\n"
        ),
        md("""
## 7. 重みを Drive に保存

保存したら Drive からダウンロードして、リポジトリの
`services/recognition/models/card_seg_unet.pt` に置いてください。
その後 `fly deploy -a handhistory-recognition` でアプリに反映されます。
"""),
        code(
            "import shutil, os\n"
            "dest_dir = '/content/drive/MyDrive/hand_history_models'\n"
            "os.makedirs(dest_dir, exist_ok=True)\n"
            "dest = os.path.join(dest_dir, 'card_seg_unet.pt')\n"
            "shutil.copy('/content/card_seg_unet.pt', dest)\n"
            "print('保存しました:', dest)\n"
            "print('サイズ:', round(os.path.getsize(dest) / 1e6, 2), 'MB')\n"
            "\n"
            "from google.colab import files\n"
            "files.download('/content/card_seg_unet.pt')\n"
        ),
    ]

    nb = {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python",
                           "name": "python3"},
            "language_info": {"name": "python"},
            "colab": {"provenance": []},
        },
        "nbformat": 4,
        "nbformat_minor": 0,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    build()
