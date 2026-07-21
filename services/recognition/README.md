# Card Recognition Service

FastAPI microservice that recognises playing cards from a photo.

- `POST /v1/recognize` — multipart form field `image`; returns each detected
  card's rank (1-13, 1=A) + suit (c/d/h/s) with confidences.
- `GET /v1/health` — liveness check.

## Models
- `models/suit_cnn.pth` — 4-class suit CNN (PyTorch).
- `models/rank_multiscan_hog_svm_v2.joblib` — rank classifier bundle
  (HOG + SVM + template matching), 13 classes.

Recognition code under `app/recognition/` is ported verbatim (algorithm
unchanged) from the research notebooks in `research/notebooks/`.

## Run locally
```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8080
```

The rank pipeline is combinatorially heavy (multiple quad candidates × 4
rotations × 7 window sizes × 4 offsets × threshold variants), so a single card
can take several seconds. Multi-card photos are recognised in parallel via a
process pool (one worker per core, each loads the models once).
