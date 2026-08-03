"""Train the card segmenter on synthetic scenes. Written to finish on a CPU.

Run it from the Colab notebook (which mounts Drive and points ``--photos`` at
``data_set_pre/jpg``), or locally against any folder of single-card photos.

Scenes are generated once up front rather than on the fly: on two cores the
compositor is slower than the network, so caching a fixed set and re-augmenting
it cheaply each epoch keeps the cores on the part that actually learns.
"""

from __future__ import annotations

import argparse
import random
import time
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset

import card_synth as cs
from tiny_unet import INPUT_H, INPUT_W, NUM_CLASSES, TinyUNet, count_parameters, normalise

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp"}


class SceneDataset(Dataset):
    """Pre-generated scenes, re-augmented photometrically on every epoch."""

    def __init__(self, images: list[np.ndarray], labels: list[np.ndarray],
                 train: bool):
        self.images = images
        self.labels = labels
        self.train = train

    def __len__(self) -> int:
        return len(self.images)

    def __getitem__(self, idx: int):
        img = self.images[idx]
        lab = self.labels[idx]

        if self.train:
            if random.random() < 0.5:
                img, lab = cv2.flip(img, 1), cv2.flip(lab, 1)
            if random.random() < 0.2:
                img, lab = cv2.flip(img, 0), cv2.flip(lab, 0)
            if random.random() < 0.7:
                gain = random.uniform(0.75, 1.3)
                bias = random.uniform(-22, 22)
                img = np.clip(img.astype(np.float32) * gain + bias,
                              0, 255).astype(np.uint8)

        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        x = torch.from_numpy(rgb).permute(2, 0, 1)
        y = torch.from_numpy(lab.astype(np.int64))
        return x, y


def build_dataset(photo_dir: Path, n_scenes: int, seed: int,
                  max_photos: int | None) -> tuple[list, list]:
    paths = sorted(p for p in photo_dir.rglob("*")
                   if p.suffix.lower() in IMAGE_EXTS)
    if not paths:
        raise SystemExit(f"no images under {photo_dir}")
    print(f"found {len(paths)} photos under {photo_dir}")

    print("extracting cards and background plates...")
    cards, plates = cs.load_sources(paths, limit=max_photos)
    if not cards or not plates:
        raise SystemExit("could not extract any card/plate pairs")
    print(f"  -> {len(cards)} cards, {len(plates)} plates")

    print(f"composing {n_scenes} scenes...")
    images, labels = [], []
    rng = np.random.default_rng(seed)
    t0 = time.time()
    while len(images) < n_scenes:
        scene = cs.compose_scene(cards, plates, rng, size=(INPUT_W, INPUT_H))
        if not scene.cards:
            continue
        images.append(scene.image)
        labels.append(scene.label_map(border_px=2))
        if len(images) % 250 == 0:
            print(f"  {len(images)}/{n_scenes}  ({time.time() - t0:.0f}s)")
    return images, labels


def dice_loss(logits: torch.Tensor, target: torch.Tensor,
              eps: float = 1.0) -> torch.Tensor:
    """Soft Dice over the two card classes.

    Cross-entropy alone under-weights the border class — it is a couple of
    percent of the pixels, yet it is the entire mechanism for pulling touching
    cards apart. Dice scores each class by overlap rather than by pixel count, so
    the thin border carries the same weight as the interior.
    """
    probs = F.softmax(logits, dim=1)
    onehot = F.one_hot(target, NUM_CLASSES).permute(0, 3, 1, 2).float()
    dims = (0, 2, 3)
    inter = (probs * onehot).sum(dims)
    denom = probs.sum(dims) + onehot.sum(dims)
    dice = (2 * inter + eps) / (denom + eps)
    return 1.0 - dice[1:].mean()


@torch.no_grad()
def evaluate(model: nn.Module, loader: DataLoader, device: torch.device,
             class_weights: torch.Tensor) -> dict[str, float]:
    model.eval()
    inter = torch.zeros(NUM_CLASSES)
    union = torch.zeros(NUM_CLASSES)
    total_loss = 0.0
    batches = 0
    for x, y in loader:
        x, y = x.to(device), y.to(device)
        logits = model(normalise(x))
        loss = (F.cross_entropy(logits, y, weight=class_weights)
                + dice_loss(logits, y))
        total_loss += float(loss)
        batches += 1
        pred = logits.argmax(1)
        for c in range(NUM_CLASSES):
            p, t = pred == c, y == c
            inter[c] += float((p & t).sum())
            union[c] += float((p | t).sum())
    iou = (inter / union.clamp(min=1)).tolist()
    return {
        "loss": total_loss / max(batches, 1),
        "iou_background": iou[0],
        "iou_interior": iou[1],
        "iou_border": iou[2],
        "miou_cards": (iou[1] + iou[2]) / 2,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--photos", required=True,
                    help="folder of single-card photos (searched recursively)")
    ap.add_argument("--out", default="card_seg_unet.pt")
    ap.add_argument("--scenes", type=int, default=3000)
    ap.add_argument("--val-scenes", type=int, default=300)
    ap.add_argument("--epochs", type=int, default=28)
    ap.add_argument("--batch-size", type=int, default=8)
    ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--width", type=int, default=16)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--max-photos", type=int, default=None)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    np.random.seed(args.seed)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cpu":
        torch.set_num_threads(max(1, torch.get_num_threads()))
    print(f"device: {device}")

    tr_imgs, tr_labs = build_dataset(Path(args.photos), args.scenes,
                                     args.seed, args.max_photos)
    va_imgs, va_labs = build_dataset(Path(args.photos), args.val_scenes,
                                     args.seed + 9999, args.max_photos)

    train_loader = DataLoader(SceneDataset(tr_imgs, tr_labs, True),
                              batch_size=args.batch_size, shuffle=True,
                              num_workers=args.workers, drop_last=True)
    val_loader = DataLoader(SceneDataset(va_imgs, va_labs, False),
                            batch_size=args.batch_size, shuffle=False,
                            num_workers=args.workers)

    model = TinyUNet(width=args.width).to(device)
    print(f"parameters: {count_parameters(model):,}")

    # The border class is a sliver of the frame; without an explicit weight the
    # optimiser happily ignores it and the model loses its ability to separate.
    class_weights = torch.tensor([0.6, 1.0, 3.0], device=device)

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt, max_lr=args.lr, total_steps=args.epochs * len(train_loader),
        pct_start=0.25)

    best = -1.0
    for epoch in range(1, args.epochs + 1):
        model.train()
        t0 = time.time()
        running = 0.0
        for x, y in train_loader:
            x, y = x.to(device), y.to(device)
            logits = model(normalise(x))
            loss = (F.cross_entropy(logits, y, weight=class_weights)
                    + dice_loss(logits, y))
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            sched.step()
            running += float(loss.detach())

        stats = evaluate(model, val_loader, device, class_weights)
        print(f"epoch {epoch:3d}/{args.epochs}  "
              f"train_loss={running / max(len(train_loader), 1):.4f}  "
              f"val_loss={stats['loss']:.4f}  "
              f"IoU interior={stats['iou_interior']:.3f} "
              f"border={stats['iou_border']:.3f}  "
              f"({time.time() - t0:.0f}s)")

        if stats["miou_cards"] > best:
            best = stats["miou_cards"]
            save(model, args.out, args.width)
            print(f"  saved {args.out} (mIoU {best:.3f})")

    print(f"done. best card mIoU = {best:.3f}")


def save(model: nn.Module, path: str, width: int) -> None:
    """Export TorchScript so the service loads it without this training code."""
    model.eval()
    cpu_model = TinyUNet(width=width)
    cpu_model.load_state_dict({k: v.detach().cpu()
                               for k, v in model.state_dict().items()})
    cpu_model.eval()
    example = torch.zeros(1, 3, INPUT_H, INPUT_W)
    scripted = torch.jit.trace(cpu_model, example)
    scripted = torch.jit.freeze(scripted)
    torch.jit.save(scripted, path)


if __name__ == "__main__":
    main()
