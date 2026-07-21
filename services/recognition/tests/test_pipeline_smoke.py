"""End-to-end smoke test.

We cannot validate recognition ACCURACY here (no real card photos), only that
the whole pipeline — split → suit → rank, including the spawn-based process pool
and both endpoints — runs end-to-end without errors and returns well-formed data.
"""

import cv2
import numpy as np


def _make_card(digit: str) -> np.ndarray:
    img = np.full((900, 600, 3), 255, np.uint8)
    cv2.rectangle(img, (20, 20), (580, 880), (30, 30, 30), 3)
    cv2.putText(img, digit, (60, 200), cv2.FONT_HERSHEY_SIMPLEX, 5, (30, 30, 30), 12)
    cv2.putText(img, digit, (420, 780), cv2.FONT_HERSHEY_SIMPLEX, 5, (30, 30, 30), 12)
    return img


def _two_card_scene() -> bytes:
    scene = np.full((1000, 1400, 3), (40, 110, 60), np.uint8)
    scene[80:980, 120:720] = _make_card("7")
    scene[80:980, 780:1380] = _make_card("K")
    ok, buf = cv2.imencode(".jpg", scene)
    assert ok
    return buf.tobytes()


def test_split_and_detect():
    from app.recognition.card_splitter import split_cards
    from app.recognition.pipeline import detect_boxes

    scene = _two_card_scene()
    bgr = cv2.imdecode(np.frombuffer(scene, np.uint8), cv2.IMREAD_COLOR)

    crops = split_cards(bgr)
    assert len(crops) == 2, f"expected 2 cards, got {len(crops)}"

    boxes = detect_boxes(scene)
    assert len(boxes) == 2
    for b in boxes:
        assert len(b["quad"]) == 4
        for x, y in b["quad"]:
            assert 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0


def test_recognize_endpoint_parallel():
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as client:
        health = client.get("/v1/health")
        assert health.status_code == 200

        resp = client.post(
            "/v1/recognize",
            files={"image": ("scene.jpg", _two_card_scene(), "image/jpeg")},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["count"] == 2
        for card in data["cards"]:
            assert card["suit"] in ("c", "d", "h", "s")
            assert card["rank"] is None or 1 <= card["rank"] <= 13
            assert "card_code" in card


if __name__ == "__main__":
    test_split_and_detect()
    print("test_split_and_detect: PASS")
    test_recognize_endpoint_parallel()
    print("test_recognize_endpoint_parallel: PASS")
