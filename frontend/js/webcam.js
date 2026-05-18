'use strict';

/* ════════════════════════════════════════════════════
   WebcamController
   ACTION_COLORS is declared in charts.js (loaded before this).
════════════════════════════════════════════════════ */
class WebcamController {
  constructor(videoEl, canvasEl) {
    this.video   = videoEl;
    this.canvas  = canvasEl;
    this.ctx     = canvasEl.getContext('2d');
    this.stream  = null;
    this.isCapturing      = false;
    this.intervalId       = null;
    this._rafId           = null;
    this._lastPredictTime = null;
    this.CAPTURE_FRAMES   = 30;
    this.PREDICT_INTERVAL = 10000; // ms between predictions
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.canvas.width  = this.video.videoWidth  || 640;
    this.canvas.height = this.video.videoHeight || 480;
    this._renderLoop();
    this._startCapture();
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    clearInterval(this.intervalId);
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this.stream           = null;
    this.isCapturing      = false;
    this._lastPredictTime = null;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _renderLoop() {
    const draw = () => {
      if (!this.stream) return;
      if (this.video.readyState >= 2) {
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      }
      this._drawCountdown();
      this._rafId = requestAnimationFrame(draw);
    };
    this._rafId = requestAnimationFrame(draw);
  }

  /* Green arc countdown in top-right corner */
  _drawCountdown() {
    if (!this._lastPredictTime) return;
    const elapsed   = Date.now() - this._lastPredictTime;
    const remaining = Math.max(0, this.PREDICT_INTERVAL - elapsed);
    const fraction  = remaining / this.PREDICT_INTERVAL;

    const R  = 22;
    const cx = this.canvas.width - R - 12;
    const cy = R + 12;

    this.ctx.save();

    // Dark background circle
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, R, 0, Math.PI * 2);
    this.ctx.fillStyle = 'rgba(0,0,0,0.50)';
    this.ctx.fill();

    // Green arc (shrinks toward 0)
    if (fraction > 0.01) {
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, R - 3, -Math.PI / 2, -Math.PI / 2 + fraction * Math.PI * 2);
      this.ctx.strokeStyle = '#10B981';
      this.ctx.lineWidth   = 4;
      this.ctx.lineCap     = 'round';
      this.ctx.stroke();
    }

    // Seconds label
    const secs = Math.ceil(remaining / 1000);
    this.ctx.fillStyle    = '#ffffff';
    this.ctx.font         = 'bold 13px Inter, sans-serif';
    this.ctx.textAlign    = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(secs > 0 ? String(secs) : '📷', cx, cy);

    this.ctx.restore();
  }

  _startCapture() {
    this._lastPredictTime = Date.now();
    this.intervalId = setInterval(() => this._captureAndPredict(), this.PREDICT_INTERVAL);
  }

  /** Public: one-shot capture bypassing the auto-interval */
  async captureNow() {
    if (!this.stream) return;
    clearInterval(this.intervalId);
    this.intervalId  = null;
    this.isCapturing = false;
    await this._captureAndPredict();
    if (this.stream) this._startCapture();
  }

  async _captureAndPredict() {
    if (this.isCapturing || !this.stream) return;
    this.isCapturing      = true;
    this._lastPredictTime = Date.now(); // reset countdown

    // Snapshot + timestamp at start of analysis
    const ts       = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const snapshot = this.video.readyState >= 2 ? this.canvas.toDataURL('image/jpeg', 0.75) : null;

    document.dispatchEvent(new CustomEvent('webcam:predicting', { detail: true }));
    if (snapshot) {
      document.dispatchEvent(new CustomEvent('webcam:snapshot', { detail: { snapshot, ts } }));
    }

    // Capture 30 frames
    const tmpC   = document.createElement('canvas');
    tmpC.width   = this.video.videoWidth  || 640;
    tmpC.height  = this.video.videoHeight || 480;
    const tmpCtx = tmpC.getContext('2d');
    const frames = [];

    for (let i = 0; i < this.CAPTURE_FRAMES; i++) {
      if (this.video.readyState >= 2) {
        tmpCtx.drawImage(this.video, 0, 0);
        frames.push(tmpC.toDataURL('image/jpeg', 0.6));
      }
      await new Promise(r => setTimeout(r, 40));
    }

    try {
      const res = await fetch('/api/predict/frames', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ frames, width: tmpC.width, height: tmpC.height }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this._drawOverlay(data);
      document.dispatchEvent(new CustomEvent('prediction', { detail: { ...data, snapshot, ts } }));
    } catch (err) {
      console.error('[WebcamController] predict error:', err.message);
    }

    document.dispatchEvent(new CustomEvent('webcam:predicting', { detail: false }));
    this.isCapturing = false;
  }

  _drawOverlay(data) {
    if (this.video.readyState >= 2) {
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    }

    const color = (typeof ACTION_COLORS !== 'undefined' ? ACTION_COLORS[data.action] : null) || '#2563EB';
    const W     = this.canvas.width;
    const H     = this.canvas.height;

    (data.bboxes || []).forEach(box => {
      const x = box.x * W;
      const y = box.y * H;
      const w = box.w * W;
      const h = box.h * H;

      // Bounding box
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth   = 3;
      this.ctx.strokeRect(x, y, w, h);

      // Corner L-shapes
      const cLen = 20;
      this.ctx.fillStyle = color;
      this.ctx.fillRect(x,         y,         cLen, 3);
      this.ctx.fillRect(x,         y,         3, cLen);
      this.ctx.fillRect(x+w-cLen,  y,         cLen, 3);
      this.ctx.fillRect(x+w-3,     y,         3, cLen);
      this.ctx.fillRect(x,         y+h-3,     cLen, 3);
      this.ctx.fillRect(x,         y+h-cLen,  3, cLen);
      this.ctx.fillRect(x+w-cLen,  y+h-3,     cLen, 3);
      this.ctx.fillRect(x+w-3,     y+h-cLen,  3, cLen);

      // Label badge
      const labelText = `${data.action.toUpperCase()}  ${(data.confidence * 100).toFixed(0)}%`;
      this.ctx.font = 'bold 13px Inter, sans-serif';
      const tw = this.ctx.measureText(labelText).width + 18;
      const bh = 26;
      this.ctx.fillStyle = color;
      if (this.ctx.roundRect) {
        this.ctx.beginPath();
        this.ctx.roundRect(x, y - bh - 2, tw, bh, 5);
        this.ctx.fill();
      } else {
        this.ctx.fillRect(x, y - bh - 2, tw, bh);
      }
      this.ctx.fillStyle    = '#ffffff';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(labelText, x + 9, y - bh / 2 - 2);
    });
  }
}
