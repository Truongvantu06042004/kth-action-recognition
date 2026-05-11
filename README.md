# 🏃 KTH Action Recognition Web App

Web app nhận dạng hành động người (Human Action Recognition) dựa trên dataset KTH.  
**Backend:** FastAPI · **Frontend:** Vanilla JS/CSS3 · **Model:** SVM Linear

| Metric | Value |
|--------|-------|
| Test Accuracy | 80.2% |
| LOGO-CV Mean | 77.6% |
| Features | HOG (3528d) + OF (24d) + MHI (1767d) + IDT (96d) = **5415d** → PCA 330d |
| Classes | boxing · handclapping · handwaving · jogging · running · walking |
| Model | SVM Linear, C=0.1 · scikit-learn 1.6.1 |

---

## Yêu cầu hệ thống

- **Python 3.9 trở lên** (đã test với 3.10, 3.11, 3.12)
- Webcam (nếu muốn dùng chức năng live prediction)
- Không cần GPU

---

## Cách chạy (sau khi clone)

```bash
# 1. Clone repo
git clone <url-repo-của-bạn>
cd kth_action_web

# 2. Cài dependencies
cd backend
pip install -r requirements.txt

# 3. Chạy server
python -m uvicorn main:app --host 0.0.0.0 --port 8000

# 4. Mở trình duyệt
# → http://localhost:8000
```

> **Lưu ý scikit-learn:** Model được train với `scikit-learn 1.6.1`.  
> Các phiên bản mới hơn (1.7.x) vẫn chạy được, chỉ hiện cảnh báo version mismatch.  
> Nếu muốn đúng version: `pip install "scikit-learn==1.6.1" --prefer-binary`

---

## Cấu trúc thư mục

```
kth_action_web/
├── backend/
│   ├── main.py                     # FastAPI — 4 endpoints
│   ├── feature_extractor.py        # HOG + OF + MHI + IDT (khớp với lúc train)
│   ├── model/
│   │   └── kth_svm_idt_model.pkl   # Model đã train (8 MB — đã có sẵn)
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js      # Tab switching, upload, export
│       ├── webcam.js   # WebcamController + bounding box overlay
│       └── charts.js   # Chart.js: ablation, prob bar, donut, confusion matrix
└── README.md
```

---

## API Endpoints

| Method | URL | Mô tả |
|--------|-----|-------|
| `POST` | `/api/predict/video` | Upload file video → nhận dạng |
| `POST` | `/api/predict/frames` | Gửi base64 frames (webcam) → nhận dạng |
| `GET`  | `/api/model-info` | Thông tin model, ablation study |
| `GET`  | `/api/health` | Health check |

---

## Tính năng UI

- **Upload Video** — Drag & drop, preview, probability bar chart, gauge confidence
- **Webcam Live** — Auto-predict mỗi 2.5 giây, bounding box overlay trên canvas
- **Ablation Study** — Horizontal bar chart đóng góp từng feature type
- **Confusion Matrix** — Heatmap 6×6 custom canvas (test set: 96 clips)
- **Pipeline Diagram** — SVG flowchart toàn bộ pipeline
- **About Classes** — 6 cards với recall/description từng hành động
- **Export Report** — Xuất PNG báo cáo kết quả

---

## Inference Pipeline

```
Video frames (30 frames, 64×64)
    ↓
HOG (3528d) + Optical Flow (24d) + MHI (1767d) + IDT (96d)
    ↓ concat
5415d → StandardScaler → PCA (330d, 95% variance)
    ↓
SVM Linear (C=0.1, class_weight='balanced')
    ↓
Label: boxing / handclapping / handwaving / jogging / running / walking
```

---

## Lưu ý quan trọng

- **Inference time:** ~1–5 giây trên CPU (IDT trajectory tracking tốn thời gian)
- **Webcam:** capture 30 frame liên tiếp (~2.5 giây) trước mỗi lần predict
- **Video format:** .avi, .mp4, .mov, .webm, .mkv
- **Webcam HTTPS:** localhost không cần HTTPS, nhưng nếu deploy lên server thật thì cần

---

## Dataset & Citation

**KTH Human Motion Database** — 599 clips, 25 subjects, 6 action classes  
*Schuldt, C., Laptev, I., Caputo, B. — "Recognizing human actions: a local SVM approach." ICPR 2004*

---

**Đại học Bách Khoa Đà Nẵng — Đồ án cuối kỳ — 2024/2025**
