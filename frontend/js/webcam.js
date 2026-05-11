'use strict';

/* ════════════════════════════════════════════════════
   WebcamController
   Handles camera stream, frame capture, and bbox overlay.
   ACTION_COLORS is declared in charts.js (loaded before this).
════════════════════════════════════════════════════ */
class WebcamController {
  constructor(videoEl, canvasEl) {
    this.video   = videoEl;
    this.canvas  = canvasEl;
    this.ctx     = canvasEl.getContext('2d');
    this.stream  = null;
    this.isCapturing     = false;
    this.intervalId      = null;
    this._rafId          = null;
    this.CAPTURE_FRAMES  = 30;
    this.PREDICT_INTERVAL = 2500; // ms
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
    this.stream      = null;
    this.isCapturing = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _renderLoop() {
    const draw = () => {
      if (!this.stream) return;
      if (this.video.readyState >= 2) {
        this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      }
      this._rafId = requestAnimationFrame(draw);
    };
    this._rafId = requestAnimationFrame(draw);
  }

  _startCapture() {
    this.intervalId = setInterval(() => this._captureAndPredict(), this.PREDICT_INTERVAL);
  }

  /** Public: trigger one-shot capture + predict (bypasses auto-interval) */
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
    this.isCapturing = true;
    document.dispatchEvent(new CustomEvent('webcam:predicting', { detail: true }));

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
      await new Promise(r => setTimeout(r, 40)); // ~25 fps capture
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
      document.dispatchEvent(new CustomEvent('prediction', { detail: data }));
    } catch (err) {
      console.error('[WebcamController] predict error:', err.message);
    }

    document.dispatchEvent(new CustomEvent('webcam:predicting', { detail: false }));
    this.isCapturing = false;
  }

  _drawOverlay(data) {
    // Redraw current video frame
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

      // Corner L-shape decorators
      const cLen = 20;
      this.ctx.fillStyle = color;
      // Top-left
      this.ctx.fillRect(x,     y,     cLen, 3);
      this.ctx.fillRect(x,     y,     3, cLen);
      // Top-right
      this.ctx.fillRect(x+w-cLen, y, cLen, 3);
      this.ctx.fillRect(x+w-3,    y, 3, cLen);
      // Bottom-left
      this.ctx.fillRect(x,     y+h-3, cLen, 3);
      this.ctx.fillRect(x,     y+h-cLen, 3, cLen);
      // Bottom-right
      this.ctx.fillRect(x+w-cLen, y+h-3, cLen, 3);
      this.ctx.fillRect(x+w-3,    y+h-cLen, 3, cLen);

      // Label badge
      const labelText = `${data.action.toUpperCase()}  ${(data.confidence * 100).toFixed(0)}%`;
      this.ctx.font = 'bold 13px Inter, sans-serif';
      const tw = this.ctx.measureText(labelText).width + 18;
      const bh = 26;
      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.roundRect ? this.ctx.roundRect(x, y - bh - 2, tw, bh, 5)
                         : this.ctx.fillRect(x, y - bh - 2, tw, bh);
      this.ctx.fill();
      this.ctx.fillStyle = '#ffffff';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(labelText, x + 9, y - bh / 2 - 2);
    });
  }
}
