"""FastAPI recognition microservice.

Single responsibility: accept a photo of one or more playing cards, split it into
individual cards, and return each card's recognised rank + suit with confidences.
The heavy per-card inference is fanned out across a process pool (see pipeline).
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .recognition.pipeline import detect_boxes, get_executor, recognize_image

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB


class CardOut(BaseModel):
    index: int
    rank: int | None
    suit: str
    rank_label: str
    card_code: str
    rank_confidence: float | None
    suit_confidence: float
    accepted: bool
    # Present only when the request asked for debug: the intermediate images
    # (card crop, rectified card, the black-and-white digit patches the
    # classifier actually saw) and the scores behind the read.
    debug: dict[str, Any] | None = None


class RecognizeResponse(BaseModel):
    count: int
    cards: list[CardOut]
    # Present only when debug was requested: what the splitter did with the
    # frame (source, detection overlay, edge mask) — the same pictures
    # card_splitter_first.py writes to disk when run as a script.
    splitter: dict[str, Any] | None = None


class DetectedBox(BaseModel):
    index: int
    # 4 corner points, each [x, y] normalised to 0..1 of the source image.
    quad: list[list[float]]


class DetectResponse(BaseModel):
    count: int
    boxes: list[DetectedBox]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm the process pool at startup so the first request doesn't pay fork cost.
    get_executor()
    yield


app = FastAPI(title="Hand History — Card Recognition", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


@lru_cache(maxsize=1)
def _rank_model_info() -> dict[str, Any]:
    """Metadata about the rank model baked into this image.

    Reported by /v1/health so a deploy can be verified from the outside: a
    plain {"status": "ok"} looks identical whether or not a new model actually
    shipped. Reading the bundle is cheap and cached, and a failure here must
    never take the health check down.
    """
    try:
        import joblib

        bundle = joblib.load(Path(__file__).resolve().parent.parent / "models" / "rank_multiscan_hog_svm_v2.joblib")
        return {
            "images": bundle.get("number_of_usable_images"),
            "accuracy": round(float(bundle.get("overall_accuracy", 0.0)), 2),
            "accepted_accuracy": round(float(bundle.get("accepted_accuracy", 0.0)), 2),
            "version": bundle.get("model_version"),
        }
    except Exception:
        return {"error": "unavailable"}


@app.get("/v1/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "rank_model": _rank_model_info()}


@app.post("/v1/recognize", response_model=RecognizeResponse)
async def recognize(
    image: UploadFile = File(...),
    expected_count: int | None = Form(default=None),
    debug: bool = Form(default=False),
) -> RecognizeResponse:
    """Recognise every card in one photo.

    ``expected_count`` keeps only that many candidates (the research script's
    behaviour); without it, anything card-shaped in frame can be picked up.
    ``debug`` additionally returns the intermediate images and scores behind
    each read — nothing is persisted, it is all inline in the response.
    """
    if image.content_type is not None and not image.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Uploaded file is not an image")

    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image too large")

    if expected_count is not None and not (1 <= expected_count <= 10):
        raise HTTPException(status_code=422, detail="expected_count must be between 1 and 10")

    try:
        cards, splitter_debug = recognize_image(data, expected_count=expected_count, debug=debug)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return RecognizeResponse(
        count=len(cards),
        cards=[CardOut(**c) for c in cards],
        splitter=splitter_debug,
    )


@app.post("/v1/detect", response_model=DetectResponse)
async def detect(image: UploadFile = File(...)) -> DetectResponse:
    """Fast detection-only endpoint for the live camera overlay.

    Returns just the card bounding quads (no rank/suit inference), cheap enough
    to poll a few times per second while framing a shot.
    """
    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image too large")

    try:
        boxes = detect_boxes(data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return DetectResponse(count=len(boxes), boxes=[DetectedBox(**b) for b in boxes])
