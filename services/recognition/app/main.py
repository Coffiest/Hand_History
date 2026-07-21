"""FastAPI recognition microservice.

Single responsibility: accept a photo of one or more playing cards, split it into
individual cards, and return each card's recognised rank + suit with confidences.
The heavy per-card inference is fanned out across a process pool (see pipeline).
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
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


class RecognizeResponse(BaseModel):
    count: int
    cards: list[CardOut]


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


@app.get("/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/recognize", response_model=RecognizeResponse)
async def recognize(image: UploadFile = File(...)) -> RecognizeResponse:
    if image.content_type is not None and not image.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Uploaded file is not an image")

    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image too large")

    try:
        cards = recognize_image(data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return RecognizeResponse(count=len(cards), cards=[CardOut(**c) for c in cards])


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
