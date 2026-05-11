import cv2
import numpy as np
from skimage.feature import hog
from skimage.transform import resize

# ============================================================
# CẤU HÌNH — PHẢI KHỚP VỚI LÚC TRAIN
# ============================================================
FRAME_SIZE       = (64, 64)
FRAMES_PER_CLIP  = 30
HOG_ORIENTATIONS    = 9
HOG_PIXELS_PER_CELL = (8, 8)
HOG_CELLS_PER_BLOCK = (2, 2)
OF_PYR_SCALE  = 0.5
OF_LEVELS     = 3
OF_WIN_SIZE   = 15
OF_ITERATIONS = 3
OF_POLY_N     = 5
OF_POLY_SIGMA = 1.2
MHI_DURATION  = 0.5
MHI_THRESHOLD = 25
IDT_STEP      = 5
IDT_TRACK_LEN = 15
IDT_MIN_FLOW  = 0.4
IDT_HOF_BINS  = 8
IDT_HOG_BINS  = 8
IDT_MBH_BINS  = 8
IDT_MAX_TRAJ  = 2000

# ============================================================
# HOG FEATURE
# ============================================================
def extract_hog_features(frames):
    all_hog = []
    for frame in frames:
        frame_rs = resize(frame, FRAME_SIZE, anti_aliasing=True)
        feat = hog(
            frame_rs,
            orientations=HOG_ORIENTATIONS,
            pixels_per_cell=HOG_PIXELS_PER_CELL,
            cells_per_block=HOG_CELLS_PER_BLOCK,
            block_norm='L2-Hys',
            feature_vector=True,
        )
        all_hog.append(feat)
    all_hog = np.array(all_hog)
    return np.concatenate([all_hog.mean(0), all_hog.std(0)])

# ============================================================
# OPTICAL FLOW (Farneback)
# ============================================================
def extract_optical_flow_features(frames):
    flows = []
    for i in range(1, len(frames)):
        prev = frames[i-1].astype(np.uint8)
        curr = frames[i].astype(np.uint8)
        prev_rs = cv2.resize(prev, (FRAME_SIZE[1], FRAME_SIZE[0]))
        curr_rs = cv2.resize(curr, (FRAME_SIZE[1], FRAME_SIZE[0]))
        flow = cv2.calcOpticalFlowFarneback(
            prev_rs, curr_rs, None,
            OF_PYR_SCALE, OF_LEVELS, OF_WIN_SIZE,
            OF_ITERATIONS, OF_POLY_N, OF_POLY_SIGMA, 0
        )
        mag, ang = cv2.cartToPolar(flow[..., 0], flow[..., 1])
        flows.append([
            mag.mean(), mag.std(),
            np.percentile(mag, 25), np.percentile(mag, 75),
            ang.mean(), ang.std(),
        ])
    flows = np.array(flows) if flows else np.zeros((1, 6))
    return np.concatenate([flows.mean(0), flows.std(0), flows.max(0), flows.min(0)])

# ============================================================
# MHI — Motion History Image
# ============================================================
def extract_mhi_features(frames):
    H, W = FRAME_SIZE
    mhi  = np.zeros((H, W), dtype=np.float32)
    for i in range(1, len(frames)):
        prev = cv2.resize(frames[i-1].astype(np.uint8), (W, H))
        curr = cv2.resize(frames[i].astype(np.uint8), (W, H))
        diff = cv2.absdiff(curr, prev)
        _, silhouette = cv2.threshold(diff, MHI_THRESHOLD, 1, cv2.THRESH_BINARY)
        timestamp = i / max(len(frames)-1, 1)
        mhi[silhouette == 1] = timestamp
        mhi[silhouette == 0] = np.maximum(0, mhi[silhouette == 0] - MHI_DURATION / (len(frames)-1))
    mhi_norm = cv2.normalize(mhi, None, 0, 1, cv2.NORM_MINMAX)
    hog_feat = hog(
        mhi_norm,
        orientations=HOG_ORIENTATIONS,
        pixels_per_cell=HOG_PIXELS_PER_CELL,
        cells_per_block=HOG_CELLS_PER_BLOCK,
        block_norm='L2-Hys',
        feature_vector=True,
    )
    eps  = 1e-10
    hist, _ = np.histogram(mhi_norm, bins=32, range=(0,1), density=True)
    entropy  = -np.sum(hist * np.log2(hist + eps)) / 32
    stats    = np.array([mhi_norm.mean(), mhi_norm.std(), entropy])
    return np.concatenate([hog_feat, stats])

# ============================================================
# IDT — Improved Dense Trajectories (Python port)
# ============================================================
def extract_idt_features(frames):
    H, W  = FRAME_SIZE
    step  = IDT_STEP
    TL    = IDT_TRACK_LEN
    N_HOF = IDT_HOF_BINS
    N_HOG = IDT_HOG_BINS
    N_MBH = IDT_MBH_BINS
    gray_frames = [cv2.resize(f.astype(np.uint8), (W, H)) for f in frames]
    T = len(gray_frames)
    flows = []
    for i in range(T-1):
        flow = cv2.calcOpticalFlowFarneback(
            gray_frames[i], gray_frames[i+1], None, 0.5, 3, 15, 3, 5, 1.2, 0)
        flows.append(flow)
    if len(flows) == 0:
        d = N_HOF + N_HOG + N_MBH
        return np.zeros(d * 4)
    ys, xs = np.mgrid[step//2:H:step, step//2:W:step]
    pts_init = np.stack([xs.ravel(), ys.ravel()], axis=1).astype(np.float32)
    if len(pts_init) > IDT_MAX_TRAJ:
        idx = np.random.choice(len(pts_init), IDT_MAX_TRAJ, replace=False)
        pts_init = pts_init[idx]
    window = min(TL, T-1)
    starts = range(0, max(T - window, 1), max(window // 2, 1))
    all_hof_descs, all_hog_descs, all_mbh_descs = [], [], []
    for t_start in starts:
        pts = pts_init.copy()
        traj_flows_x, traj_flows_y, traj_grays = [], [], []
        for t in range(t_start, min(t_start + window, T-1)):
            flow = flows[t]
            px = np.clip(pts[:, 0].astype(int), 0, W-1)
            py = np.clip(pts[:, 1].astype(int), 0, H-1)
            fx = flow[py, px, 0]
            fy = flow[py, px, 1]
            gray_vals = gray_frames[t][py, px].astype(np.float32)
            traj_flows_x.append(fx)
            traj_flows_y.append(fy)
            traj_grays.append(gray_vals)
            pts[:, 0] = np.clip(pts[:, 0] + fx, 0, W-1)
            pts[:, 1] = np.clip(pts[:, 1] + fy, 0, H-1)
        if not traj_flows_x:
            continue
        traj_fx = np.array(traj_flows_x).T
        traj_fy = np.array(traj_flows_y).T
        displacement = np.sqrt(np.diff(traj_fx, axis=1)**2 + np.diff(traj_fy, axis=1)**2 + 1e-10)
        total_disp = displacement.mean(axis=1)
        valid_mask = total_disp >= IDT_MIN_FLOW
        if valid_mask.sum() == 0:
            continue
        fx_valid = traj_fx[valid_mask]
        fy_valid = traj_fy[valid_mask]
        mag = np.sqrt(fx_valid**2 + fy_valid**2 + 1e-10)
        ang = np.arctan2(fy_valid, fx_valid) + np.pi
        hist_hof, _ = np.histogram(ang.ravel(), bins=N_HOF, range=(0, 2*np.pi),
                                   weights=mag.ravel(), density=True)
        all_hof_descs.append(hist_hof / (np.linalg.norm(hist_hof) + 1e-10))
        gray_valid = np.array(traj_grays).T[valid_mask]
        grad = np.diff(gray_valid, axis=1)
        grad_mag = np.abs(grad)
        grad_ang = np.where(grad >= 0, 0, np.pi / 2)
        hist_hog, _ = np.histogram(grad_ang.ravel(), bins=N_HOG, range=(0, np.pi),
                                   weights=grad_mag.ravel(), density=True)
        all_hog_descs.append(hist_hog / (np.linalg.norm(hist_hog) + 1e-10))
        dx_fx = np.diff(fx_valid, axis=1)
        dy_fy = np.diff(fy_valid, axis=1)
        mbh_mag = np.sqrt(dx_fx**2 + dy_fy**2 + 1e-10)
        mbh_ang = np.arctan2(dy_fy, dx_fx) + np.pi
        hist_mbh, _ = np.histogram(mbh_ang.ravel(), bins=N_MBH, range=(0, 2*np.pi),
                                   weights=mbh_mag.ravel(), density=True)
        all_mbh_descs.append(hist_mbh / (np.linalg.norm(hist_mbh) + 1e-10))
    def pool(descs, bins):
        if not descs:
            return np.zeros(bins * 4)
        arr = np.array(descs)
        return np.concatenate([arr.mean(0), arr.std(0), arr.max(0), arr.min(0)])
    return np.concatenate([pool(all_hof_descs, N_HOF),
                           pool(all_hog_descs, N_HOG),
                           pool(all_mbh_descs, N_MBH)])

# ============================================================
# MOTION DETECTION — tìm bounding box vùng chuyển động
# ============================================================
def detect_motion_bbox(prev_frame, curr_frame, min_area=500):
    if prev_frame is None or curr_frame is None:
        return []
    h, w = curr_frame.shape[:2]
    prev_gray = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY) if len(prev_frame.shape)==3 else prev_frame
    curr_gray = cv2.cvtColor(curr_frame, cv2.COLOR_BGR2GRAY) if len(curr_frame.shape)==3 else curr_frame
    diff = cv2.absdiff(prev_gray, curr_gray)
    _, thresh = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=2)
    thresh = cv2.dilate(thresh, kernel, iterations=2)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for cnt in contours:
        if cv2.contourArea(cnt) < min_area:
            continue
        x, y, bw, bh = cv2.boundingRect(cnt)
        boxes.append({
            'x': x / w, 'y': y / h,
            'w': bw / w, 'h': bh / h,
            'x_px': x, 'y_px': y, 'w_px': bw, 'h_px': bh
        })
    if len(boxes) > 3:
        all_x  = [b['x_px'] for b in boxes]
        all_y  = [b['y_px'] for b in boxes]
        all_x2 = [b['x_px'] + b['w_px'] for b in boxes]
        all_y2 = [b['y_px'] + b['h_px'] for b in boxes]
        mx, my = min(all_x), min(all_y)
        mx2, my2 = max(all_x2), max(all_y2)
        boxes = [{'x': mx/w, 'y': my/h, 'w': (mx2-mx)/w, 'h': (my2-my)/h,
                  'x_px': mx, 'y_px': my, 'w_px': mx2-mx, 'h_px': my2-my}]
    return boxes

# ============================================================
# HÀM CHÍNH — EXTRACT ALL FEATURES
# ============================================================
def extract_all_features(frames):
    """frames: list of grayscale numpy arrays (H, W) — uint8. Returns shape (5415,)"""
    f_hog = extract_hog_features(frames)
    f_of  = extract_optical_flow_features(frames)
    f_mhi = extract_mhi_features(frames)
    f_idt = extract_idt_features(frames)
    return np.concatenate([f_hog, f_of, f_mhi, f_idt]).astype(np.float32)

def preprocess_frames(frames_bgr, n_frames=30):
    """frames_bgr: list numpy BGR arrays → sample 30 frames, convert to grayscale"""
    if not frames_bgr:
        return []
    indices = np.linspace(0, len(frames_bgr)-1, n_frames, dtype=int)
    selected = [frames_bgr[i] for i in indices]
    gray = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in selected]
    return gray
