"""A deliberately small U-Net that separates touching and overlapping cards.

Design constraints, and what they buy
-------------------------------------
* **Trains on a CPU.** Colab may not hand out a GPU, so the network is sized so
  a few thousand synthetic scenes converge in a sitting on two cores: ~0.39M
  parameters at the default width, 256x192 input.
* **Runs inside the 0.5s request budget** on the two shared cores the
  recognition service gets, alongside torch already being loaded for SuitCNN.
* **No new dependencies and no licence entanglement.** Plain ``torch.nn``, so
  none of the AGPL obligations that come with the off-the-shelf YOLO packages —
  which matters because this app is headed for commercial release.

The output is three classes per pixel — background, card interior, card border —
rather than a plain card/not-card mask. Two cards sharing an edge produce one
connected blob under a binary mask, which is the exact failure being fixed;
predicting the border explicitly carves a gap between them, so their interiors
come apart under ordinary connected components. The same trick recovers a card
that is partly hidden behind another, because the occluding card's border runs
straight through the seam.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

NUM_CLASSES = 3          # background, interior, border
INPUT_W = 256
INPUT_H = 192

# Fed to the network; also what inference must reproduce exactly.
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)


def _block(cin: int, cout: int) -> nn.Sequential:
    """Two 3x3 convolutions. BatchNorm keeps CPU training stable at low width."""
    return nn.Sequential(
        nn.Conv2d(cin, cout, 3, padding=1, bias=False),
        nn.BatchNorm2d(cout),
        nn.ReLU(inplace=True),
        nn.Conv2d(cout, cout, 3, padding=1, bias=False),
        nn.BatchNorm2d(cout),
        nn.ReLU(inplace=True),
    )


class TinyUNet(nn.Module):
    """Four-level U-Net, ~0.39M parameters at the default width."""

    def __init__(self, width: int = 16, num_classes: int = NUM_CLASSES):
        super().__init__()
        w1, w2, w3, w4 = width, width * 2, width * 4, width * 6

        self.enc1 = _block(3, w1)
        self.enc2 = _block(w1, w2)
        self.enc3 = _block(w2, w3)
        self.bottleneck = _block(w3, w4)

        self.up3 = nn.ConvTranspose2d(w4, w3, 2, stride=2)
        self.dec3 = _block(w3 * 2, w3)
        self.up2 = nn.ConvTranspose2d(w3, w2, 2, stride=2)
        self.dec2 = _block(w2 * 2, w2)
        self.up1 = nn.ConvTranspose2d(w2, w1, 2, stride=2)
        self.dec1 = _block(w1 * 2, w1)

        self.head = nn.Conv2d(w1, num_classes, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        e1 = self.enc1(x)
        e2 = self.enc2(F.max_pool2d(e1, 2))
        e3 = self.enc3(F.max_pool2d(e2, 2))
        b = self.bottleneck(F.max_pool2d(e3, 2))

        d3 = self.dec3(torch.cat([self.up3(b), e3], dim=1))
        d2 = self.dec2(torch.cat([self.up2(d3), e2], dim=1))
        d1 = self.dec1(torch.cat([self.up1(d2), e1], dim=1))
        return self.head(d1)


def normalise(batch_bgr_float: torch.Tensor) -> torch.Tensor:
    """Normalise an (N, 3, H, W) RGB tensor already scaled to [0, 1]."""
    mean = torch.tensor(MEAN, dtype=batch_bgr_float.dtype,
                        device=batch_bgr_float.device).view(1, 3, 1, 1)
    std = torch.tensor(STD, dtype=batch_bgr_float.dtype,
                       device=batch_bgr_float.device).view(1, 3, 1, 1)
    return (batch_bgr_float - mean) / std


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)
