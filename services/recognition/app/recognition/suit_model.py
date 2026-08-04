"""Suit classification via the trained SuitCNN.

Ported verbatim from ``card_recognizer_integrated_colab_filtered.ipynb`` (cell 5):
the ``SuitCNN`` architecture and the ``SuitClassifier`` preprocessing/inference.
The model weights live in ``models/suit_cnn.pth``.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn
from PIL import Image

SUIT_JAPANESE = {
    "c": "クラブ",
    "d": "ダイヤ",
    "h": "ハート",
    "s": "スペード",
}


class SuitCNN(nn.Module):
    """4-class suit CNN, identical to SuitCNN_suit_only.ipynb."""

    def __init__(self, num_classes: int = 4) -> None:
        super().__init__()

        self.features = nn.Sequential(
            nn.Conv2d(3, 32, kernel_size=3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(64, 128, kernel_size=3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(128, 128, kernel_size=3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d((1, 1)),
        )

        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Dropout(0.3),
            nn.Linear(128, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.classifier(self.features(x))


@dataclass
class SuitResult:
    code: str
    name: str
    confidence: float
    probabilities: list[float]

    @property
    def margin(self) -> float:
        """How far the winning suit leads the runner-up.

        A truer read of certainty than the top probability on its own. Spades
        and clubs are both black and similarly shaped, so when the model is
        unsure its mass splits between those two: the top probability can still
        look respectable while the second is right behind it. Measured on the
        sample photos, a misread spade scored 0.44 for clubs with spades at
        0.35 — a confidence that passes any sensible threshold, and a margin
        that does not.
        """
        if len(self.probabilities) < 2:
            return float(self.confidence)
        top, second = sorted(self.probabilities, reverse=True)[:2]
        return float(top - second)


def _load_checkpoint(path: Path, device: torch.device) -> Any:
    try:
        return torch.load(path, map_location=device, weights_only=False)
    except TypeError:
        return torch.load(path, map_location=device)


class SuitClassifier:
    def __init__(self, model_path: Path, device: torch.device) -> None:
        if not model_path.is_file():
            raise FileNotFoundError(f"SuitCNN model not found: {model_path}")

        checkpoint = _load_checkpoint(model_path, device)

        if not isinstance(checkpoint, dict):
            raise ValueError("SuitCNN checkpoint is not a dict")

        state_dict = checkpoint.get("model_state_dict", checkpoint)
        class_names = checkpoint.get("class_names", ["c", "d", "h", "s"])
        self.class_names = [str(name).lower() for name in class_names]
        self.image_size = int(checkpoint.get("image_size", 128))
        self.device = device

        self.model = SuitCNN(num_classes=len(self.class_names)).to(device)
        self.model.load_state_dict(state_dict, strict=True)
        self.model.eval()

    def _preprocess(self, image: Image.Image) -> torch.Tensor:
        resized = image.convert("RGB").resize(
            (self.image_size, self.image_size),
            resample=Image.Resampling.BILINEAR,
        )
        array = np.asarray(resized, dtype=np.float32) / 255.0
        tensor = torch.from_numpy(array.transpose(2, 0, 1))
        # Same Normalize(mean=.5, std=.5) as the training notebook.
        tensor = (tensor - 0.5) / 0.5
        return tensor.unsqueeze(0).to(self.device)

    def predict(self, image: Image.Image, *, tta: bool = True) -> SuitResult:
        """Classify a card crop's suit.

        With ``tta``, the card is also read upside down and the two probability
        vectors are averaged. A playing card is symmetric under a half turn —
        the index and pip are printed in both corners — so both orientations are
        equally valid inputs, and averaging them cancels noise specific to one.
        Measured over the sample photos it lifts the mean margin from 0.687 to
        0.711, and the gain lands where it matters: the genuinely ambiguous
        close-ups (one ace went from 0.20 to 0.32) while cards the model was
        already sure about do not move.

        Adding centre-zoom views on top was tried and measured *worse* (0.685):
        a zoomed card is no longer the kind of image the model was trained on,
        and the confident cases degrade. Two views is the whole of it.
        """
        views = [image]
        if tta:
            views.append(image.transpose(Image.Transpose.ROTATE_180))

        with torch.inference_mode():
            batch = torch.cat([self._preprocess(v) for v in views], dim=0)
            probabilities = torch.softmax(self.model(batch), dim=1).mean(dim=0)

        predicted_index = int(torch.argmax(probabilities).item())
        suit_code = self.class_names[predicted_index]

        return SuitResult(
            code=suit_code,
            name=SUIT_JAPANESE.get(suit_code, suit_code),
            confidence=float(probabilities[predicted_index].item()),
            probabilities=[float(v) for v in probabilities.cpu().tolist()],
        )
