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

    def predict(self, image: Image.Image) -> SuitResult:
        image_tensor = self._preprocess(image)

        with torch.inference_mode():
            logits = self.model(image_tensor)
            probabilities = torch.softmax(logits, dim=1)[0]

        predicted_index = int(torch.argmax(probabilities).item())
        suit_code = self.class_names[predicted_index]

        return SuitResult(
            code=suit_code,
            name=SUIT_JAPANESE.get(suit_code, suit_code),
            confidence=float(probabilities[predicted_index].item()),
            probabilities=[float(v) for v in probabilities.cpu().tolist()],
        )
