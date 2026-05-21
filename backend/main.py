import warnings
warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
import joblib
import cv2
import numpy as np
import base64
import tempfile
import os
import time
import pathlib
import json
import asyncio

from feature_extractor import extract_all_features, preprocess_frames, detect_motion_bbox

app = FastAPI(title="KTH Action Recognition API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load model
MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model", "kth_svm_idt_model.pkl")

try:
    artifacts  = joblib.load(MODEL_PATH)
    model      = artifacts['best_model']
    scaler     = artifacts['scaler']
    pca        = artifacts['pca']
    le         = artifacts['label_encoder']
    CLASSES    = list(le.classes_)
    MODEL_INFO = artifacts.get('config', {})
    print(f"[OK] Model loaded. Classes: {CLASSES}")
    print(f"     Test accuracy: {MODEL_INFO.get('test_accuracy', 'N/A')}")
except Exception as e:
    print(f"[ERROR] Failed to load model from {MODEL_PATH}: {e}")
    artifacts = model = scaler = pca = le = None
    CLASSES    = ['boxing', 'handclapping', 'handwaving', 'jogging', 'running', 'walking']
    MODEL_INFO = {}


def _check_model():
    if model is None:
        raise HTTPException(503, "Model not loaded. Copy kth_svm_idt_model.pkl to backend/model/")


def run_inference(gray_frames):
    feat   = extract_all_features(gray_frames)
    X_sc   = scaler.transform(feat.reshape(1, -1))
    X_pca  = pca.transform(X_sc)
    pred   = model.predict(X_pca)[0]
    label  = le.inverse_transform([pred])[0]
    try:
        proba = model.predict_proba(X_pca)[0]
    except Exception:
        proba = np.zeros(len(CLASSES))
        proba[CLASSES.index(label)] = 1.0
    return label, proba, dict(zip(CLASSES, proba.tolist()))


# ─── Endpoint: Upload video file ──────────────────────────────────────────────
@app.post("/api/predict/video")
async def predict_video(file: UploadFile = File(...)):
    _check_model()
    ext = os.path.splitext(file.filename.lower())[1]
    if ext not in ('.avi', '.mp4', '.mov', '.mkv', '.webm'):
        raise HTTPException(400, "Unsupported format. Use .avi / .mp4 / .mov / .webm")

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        t0 = time.time()
        cap = cv2.VideoCapture(tmp_path)
        fps_video = cap.get(cv2.CAP_PROP_FPS) or 25.0
        frames_bgr = []
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            frames_bgr.append(frame)
        cap.release()

        if len(frames_bgr) < 5:
            raise HTTPException(400, "Video quá ngắn (cần ≥ 5 frame)")

        mid  = len(frames_bgr) // 2
        bbox = detect_motion_bbox(frames_bgr[max(0, mid - 1)], frames_bgr[mid])

        gray_frames = preprocess_frames(frames_bgr)
        label, proba_arr, proba_dict = run_inference(gray_frames)
        inference_ms = round((time.time() - t0) * 1000)

        return {
            "action":        label,
            "confidence":    float(max(proba_arr)),
            "probabilities": proba_dict,
            "bboxes":        bbox,
            "n_frames":      len(frames_bgr),
            "fps":           round(fps_video, 1),
            "inference_ms":  inference_ms,
        }
    finally:
        os.unlink(tmp_path)


# ─── Endpoint: Timeline (segment-by-segment prediction) ──────────────────────
@app.post("/api/predict/video/timeline")
async def predict_video_timeline(file: UploadFile = File(...)):
    _check_model()
    ext = os.path.splitext(file.filename.lower())[1]
    if ext not in ('.avi', '.mp4', '.mov', '.mkv', '.webm'):
        raise HTTPException(400, "Unsupported format. Use .avi / .mp4 / .mov / .webm")

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        t0 = time.time()
        cap = cv2.VideoCapture(tmp_path)
        fps_video = cap.get(cv2.CAP_PROP_FPS) or 25.0
        frames_bgr = []
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            frames_bgr.append(frame)
        cap.release()

        if len(frames_bgr) < 30:
            raise HTTPException(400, "Video quá ngắn (cần ≥ 30 frame)")

        SEGMENT = 60  # ~2.4s at 25fps; resampled to 30 frames inside preprocess
        segments_out = []

        for seg_start in range(0, len(frames_bgr), SEGMENT):
            seg_bgr = frames_bgr[seg_start:seg_start + SEGMENT]
            if len(seg_bgr) < 15:
                break
            gray = preprocess_frames(seg_bgr)
            label, proba_arr, proba_dict = run_inference(gray)
            segments_out.append({
                "start":         round(seg_start / fps_video, 2),
                "end":           round(min(seg_start + SEGMENT, len(frames_bgr)) / fps_video, 2),
                "action":        label,
                "confidence":    float(max(proba_arr)),
                "probabilities": proba_dict,
            })

        # Overall: majority vote, tie-break by confidence
        vote_counts = {}
        for s in segments_out:
            vote_counts[s["action"]] = vote_counts.get(s["action"], 0) + 1
        overall_action = max(vote_counts, key=vote_counts.get)
        best_seg = max(
            (s for s in segments_out if s["action"] == overall_action),
            key=lambda s: s["confidence"]
        )

        inference_ms = round((time.time() - t0) * 1000)
        return {
            "action":        overall_action,
            "confidence":    best_seg["confidence"],
            "probabilities": best_seg["probabilities"],
            "segments":      segments_out,
            "n_frames":      len(frames_bgr),
            "fps":           round(fps_video, 1),
            "duration":      round(len(frames_bgr) / fps_video, 2),
            "inference_ms":  inference_ms,
        }
    finally:
        os.unlink(tmp_path)


# ─── Endpoint: Video stream — SSE segment-by-segment ─────────────────────────
@app.post("/api/predict/video/stream")
async def predict_video_stream(file: UploadFile = File(...)):
    _check_model()
    ext = os.path.splitext(file.filename.lower())[1]
    if ext not in ('.avi', '.mp4', '.mov', '.mkv', '.webm'):
        raise HTTPException(400, "Unsupported format. Use .avi / .mp4 / .mov / .webm")

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    def _read_frames(path):
        cap = cv2.VideoCapture(path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        frames = []
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            frames.append(frame)
        cap.release()
        return frames, fps

    async def generate():
        try:
            # Heavy frame reading runs in a thread so headers are sent immediately
            frames_bgr, fps_video = await asyncio.to_thread(_read_frames, tmp_path)

            if len(frames_bgr) < 30:
                yield f"data: {json.dumps({'type':'error','message':'Video quá ngắn (cần ≥ 30 frame)'})}\n\n"
                return

            SEGMENT = 60  # ~2.4s at 25fps
            valid_starts = [i for i in range(0, len(frames_bgr), SEGMENT)
                            if len(frames_bgr[i:i + SEGMENT]) >= 15]
            duration  = round(len(frames_bgr) / fps_video, 2)
            n_frames  = len(frames_bgr)
            fps_round = round(fps_video, 1)

            yield f"data: {json.dumps({'type':'start','total':len(valid_starts),'duration':duration,'n_frames':n_frames,'fps':fps_round})}\n\n"

            for idx, seg_start in enumerate(valid_starts):
                seg_bgr = frames_bgr[seg_start:seg_start + SEGMENT]
                gray    = await asyncio.to_thread(preprocess_frames, seg_bgr)
                label, proba_arr, proba_dict = await asyncio.to_thread(run_inference, gray)
                seg = {
                    'type':          'segment',
                    'index':         idx,
                    'start':         round(seg_start / fps_video, 2),
                    'end':           round(min(seg_start + SEGMENT, n_frames) / fps_video, 2),
                    'action':        label,
                    'confidence':    float(max(proba_arr)),
                    'probabilities': proba_dict,
                }
                yield f"data: {json.dumps(seg)}\n\n"

            yield f"data: {json.dumps({'type':'done'})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type':'error','message':str(exc)})}\n\n"
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ─── Endpoint: Webcam / base64 frames ─────────────────────────────────────────
class FramePayload(BaseModel):
    frames: list[str]   # base64 JPEG strings
    width:  int = 640
    height: int = 480


@app.post("/api/predict/frames")
async def predict_frames(payload: FramePayload):
    _check_model()
    t0 = time.time()
    frames_bgr = []
    for b64 in payload.frames:
        try:
            data = base64.b64decode(b64.split(',')[-1])
            arr  = np.frombuffer(data, np.uint8)
            img  = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if img is not None:
                frames_bgr.append(img)
        except Exception:
            continue

    if len(frames_bgr) < 5:
        raise HTTPException(400, "Cần ít nhất 5 frame hợp lệ")

    bbox        = detect_motion_bbox(
        frames_bgr[-2] if len(frames_bgr) > 1 else None, frames_bgr[-1]
    )
    gray_frames = preprocess_frames(frames_bgr)
    label, proba_arr, proba_dict = run_inference(gray_frames)
    inference_ms = round((time.time() - t0) * 1000)

    return {
        "action":        label,
        "confidence":    float(max(proba_arr)),
        "probabilities": proba_dict,
        "bboxes":        bbox,
        "n_frames":      len(frames_bgr),
        "inference_ms":  inference_ms,
    }


# ─── Endpoint: Model info ──────────────────────────────────────────────────────
@app.get("/api/model-info")
def model_info():
    default_ablation = {
        'HOG only':            0.708,
        'OF only':             0.552,
        'MHI only':            0.677,
        'IDT only':            0.312,
        'HOG+OF':              0.719,
        'HOG+OF+MHI':          0.771,
        'ALL (HOG+OF+MHI+IDT)':0.802,
    }
    ablation_raw  = MODEL_INFO.get('ablation', default_ablation)
    feature_dims  = (artifacts or {}).get(
        'feature_dims', {'hog': 3528, 'of': 24, 'mhi': 1767, 'idt': 96}
    )
    return {
        "classes":       CLASSES,
        "model_loaded":  model is not None,
        "test_accuracy": round(MODEL_INFO.get('test_accuracy', 0.802) * 100, 2),
        "logo_cv_mean":  round(MODEL_INFO.get('logo_cv_mean',  0.776) * 100, 2),
        "best_params":   MODEL_INFO.get('best_params', {'kernel': 'linear', 'C': 0.1}),
        "feature_dims":  feature_dims,
        "ablation":      {k: round(v * 100, 1) for k, v in ablation_raw.items()},
        "pipeline":      "HOG (3528) + OF (24) + MHI (1767) + IDT (96) → StandardScaler → PCA(330) → SVM(linear, C=0.1)",
    }


# ─── Health check ─────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "model_loaded": model is not None, "classes": CLASSES}


# ─── Serve frontend (must come LAST) ──────────────────────────────────────────
from fastapi.responses import HTMLResponse

_frontend_dir = pathlib.Path(__file__).parent.parent / "frontend"

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    html = (_frontend_dir / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(content=html, headers={"Cache-Control": "no-store"})

if _frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(_frontend_dir), html=True), name="frontend")
