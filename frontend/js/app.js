'use strict';

/* ════════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════════ */
let currentFile       = null;
let probChart         = null;
let donutChart        = null;
let webcamCtrl        = null;
let predHistory       = [];
let lastResult        = null;
let modelClasses      = ['boxing','handclapping','handwaving','jogging','running','walking'];

const CLASS_META = {
  boxing:       { emoji:'🥊', recall:75,  color:'#EF4444', desc:'Đấm bốc với nắm tay, chuyển động tay mạnh và nhanh' },
  handclapping: { emoji:'👏', recall:100, color:'#8B5CF6', desc:'Vỗ tay liên tiếp đều đặn, biên độ nhỏ' },
  handwaving:   { emoji:'👋', recall:100, color:'#3B82F6', desc:'Vẫy tay rộng qua lại, chuyển động cánh tay rõ ràng' },
  jogging:      { emoji:'🏃', recall:50,  color:'#10B981', desc:'Chạy chậm, nhịp đều, tốc độ trung bình' },
  running:      { emoji:'🏃', recall:69,  color:'#F59E0B', desc:'Chạy nhanh, bước dài, tốc độ cao' },
  walking:      { emoji:'🚶', recall:88,  color:'#EC4899', desc:'Đi bộ bình thường, bước chân nhịp nhàng' },
};

/* ════════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initVideoUpload();
  initWebcamControls();
});

/* ════════════════════════════════════════════════════
   TAB SWITCHING (shared handler for both tab groups)
════════════════════════════════════════════════════ */
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn));
  });
}

function switchTab(btn) {
  const group = btn.dataset.group;
  const tab   = btn.dataset.tab;

  // Toggle buttons
  document.querySelectorAll(`.tab-btn[data-group="${group}"]`).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Toggle panes
  document.querySelectorAll(`[id^="${group}-tab-"]`).forEach(p => p.classList.remove('active'));
  const pane = document.getElementById(`${group}-tab-${tab}`);
  if (pane) pane.classList.add('active');

}

/* ════════════════════════════════════════════════════
   VIDEO UPLOAD
════════════════════════════════════════════════════ */
function initVideoUpload() {
  const dropZone   = document.getElementById('dropZone');
  const fileInput  = document.getElementById('fileInput');
  const browseBtn  = document.getElementById('browseBtn');
  const analyzeBtn = document.getElementById('analyzeBtn');

  browseBtn.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
  document.getElementById('changeVideoBtn')?.addEventListener('click', resetVideoUpload);

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  analyzeBtn.addEventListener('click', runAnalysis);
  document.getElementById('exportBtn')?.addEventListener('click', openExportModal);
}

function handleFile(file) {
  const exts = ['.avi', '.mp4', '.mov', '.mkv', '.webm'];
  const ext  = '.' + file.name.split('.').pop().toLowerCase();
  if (!exts.includes(ext)) { alert('Định dạng không hỗ trợ. Vui lòng chọn .avi/.mp4/.mov/.webm'); return; }
  if (file.size > 250 * 1024 * 1024) { alert('File quá lớn (>250 MB). Vui lòng chọn file nhỏ hơn.'); return; }

  currentFile = file;
  document.getElementById('dropZone').classList.add('hidden');
  document.getElementById('videoPreview').classList.remove('hidden');

  const player = document.getElementById('videoPlayer');
  player.src = URL.createObjectURL(file);
  player.onloadedmetadata = () => {
    const dur  = player.duration || 0;
    const min  = Math.floor(dur / 60);
    const sec  = Math.floor(dur % 60).toString().padStart(2, '0');
    document.getElementById('videoMeta').innerHTML =
      `<span>📄 ${file.name}</span>` +
      `<span>⏱ ${min}:${sec}</span>` +
      `<span>📦 ${(file.size / 1048576).toFixed(1)} MB</span>`;
  };

  document.getElementById('analyzeBtn').disabled = false;
  resetVideoResults();
}

async function runAnalysis() {
  if (!currentFile) return;
  setVideoLoading(true);
  document.getElementById('analyzeBtn').disabled = true;

  const form     = new FormData();
  form.append('file', currentFile);

  const segments = [];
  let totalDuration = 0;
  let totalCount    = 0;
  const t0 = Date.now();

  try {
    const res = await fetch('/api/predict/video/stream', { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const parts = buf.split('\n\n');
      buf = parts.pop();

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data: ')) continue;
        let evt;
        try { evt = JSON.parse(line.slice(6)); } catch { continue; }

        if (evt.type === 'start') {
          totalDuration = evt.duration;
          totalCount    = evt.total;
          setVideoLoading(false);
          prepareResultsPanel(totalDuration, totalCount);
        } else if (evt.type === 'segment') {
          segments.push(evt);
          onSegmentArrived(evt, segments, totalDuration, totalCount);
        } else if (evt.type === 'done') {
          if (evt.duration) totalDuration = evt.duration;
          finalizeResults(segments, totalDuration, Date.now() - t0);
        } else if (evt.type === 'error') {
          throw new Error(evt.message || 'Lỗi không xác định từ server');
        }
      }
    }
  } catch (err) {
    alert(`Lỗi phân tích: ${err.message}`);
    console.error(err);
    setVideoLoading(false);
  } finally {
    document.getElementById('analyzeBtn').disabled = false;
  }
}

function setVideoLoading(on) {
  const overlay  = document.getElementById('videoLoading');
  const content  = document.getElementById('videoResultsContent');
  const ph       = document.getElementById('videoPlaceholder');
  if (on) {
    overlay.classList.remove('hidden');
    content.classList.add('hidden');
    ph.classList.add('hidden');
  } else {
    overlay.classList.add('hidden');
  }
}

function prepareResultsPanel(duration, total) {
  document.getElementById('videoPlaceholder').classList.add('hidden');
  document.getElementById('videoResultsContent').classList.remove('hidden');

  document.getElementById('resultEmoji').textContent = '⏳';
  document.getElementById('resultLabel').textContent  = '—';
  document.getElementById('resultConf').textContent   = `Phân tích 0 / ${total} đoạn…`;
  updateGauge(0, 'gaugeArc', 'gaugeNum');

  if (probChart) { probChart.destroy(); probChart = null; }

  const section = document.getElementById('timelineSection');
  section.classList.remove('hidden');
  document.getElementById('timelineBar').innerHTML =
    `<div class="tl-pending" style="width:100%"></div>`;
  document.getElementById('timelineTicks').innerHTML =
    `<span>0s</span><span>${duration.toFixed(1)}s</span>`;
}

function onSegmentArrived(seg, allSegs, duration, total) {
  renderTimeline(allSegs, duration);

  const meta = CLASS_META[seg.action] || { emoji: '🎬' };
  document.getElementById('resultEmoji').textContent = meta.emoji;
  document.getElementById('resultLabel').textContent  = seg.action.toUpperCase();
  document.getElementById('resultConf').textContent   =
    `Đoạn ${seg.index + 1} / ${total} — ${(seg.confidence * 100).toFixed(1)}%`;
  updateGauge(seg.confidence, 'gaugeArc', 'gaugeNum');

  const detail = document.getElementById('loadingDetail');
  if (detail) detail.textContent = `Đoạn ${seg.index + 1} / ${total}`;
}

function finalizeResults(segments, duration, elapsedMs) {
  if (!segments.length) return;

  // Majority vote, tie-break by confidence
  const counts = {};
  segments.forEach(s => { counts[s.action] = (counts[s.action] || 0) + 1; });
  const overall = Object.keys(counts).reduce((a, b) => counts[a] >= counts[b] ? a : b);
  const best    = segments.filter(s => s.action === overall)
                          .reduce((a, b) => a.confidence >= b.confidence ? a : b);

  lastResult = {
    action:        overall,
    confidence:    best.confidence,
    probabilities: best.probabilities,
    filename:      currentFile?.name || '—',
    n_frames:      null,
    inference_ms:  elapsedMs,
  };

  const meta = CLASS_META[overall] || { emoji: '🎬' };
  document.getElementById('resultEmoji').textContent = meta.emoji;
  document.getElementById('resultLabel').textContent  = overall.toUpperCase();
  document.getElementById('resultConf').textContent   =
    `Confidence: ${(best.confidence * 100).toFixed(1)}%`;
  updateGauge(best.confidence, 'gaugeArc', 'gaugeNum');

  if (!probChart) probChart = createProbabilityChart('probChart', modelClasses);
  updateProbabilityChart(probChart, best.probabilities);

  document.getElementById('speedBadge').classList.remove('hidden');
  document.getElementById('inferenceTime').textContent = `${elapsedMs} ms`;
  document.getElementById('frameInfo').textContent =
    `${segments.length} đoạn · ${duration.toFixed(1)}s`;

  renderTimeline(segments, duration);
}

function resetVideoResults() {
  document.getElementById('videoResultsContent').classList.add('hidden');
  document.getElementById('videoPlaceholder').classList.remove('hidden');
  document.getElementById('speedBadge').classList.add('hidden');
  document.getElementById('timelineSection')?.classList.add('hidden');
}

function renderTimeline(segments, duration) {
  const section = document.getElementById('timelineSection');
  const bar     = document.getElementById('timelineBar');
  const ticks   = document.getElementById('timelineTicks');
  if (!section || !segments || !segments.length) return;

  const analyzedEnd = segments[segments.length - 1].end;
  const pendingPct  = ((duration - analyzedEnd) / duration * 100).toFixed(2);

  bar.innerHTML = segments.map(seg => {
    const pct   = ((seg.end - seg.start) / duration * 100).toFixed(2);
    const color = ACTION_COLORS[seg.action] || '#6B7280';
    const conf  = (seg.confidence * 100).toFixed(0);
    return `<div class="tl-segment" style="width:${pct}%;background:${color}"
                 title="${seg.action} ${conf}% · ${seg.start}s–${seg.end}s">
      <span class="tl-label">${seg.action}</span>
      <span class="tl-conf">${conf}%</span>
    </div>`;
  }).join('') + (pendingPct > 0.5
    ? `<div class="tl-pending" style="width:${pendingPct}%"></div>`
    : '');

  const tickTimes = [0, ...segments.map(s => s.end)];
  if (pendingPct > 0.5) tickTimes.push(duration);
  ticks.innerHTML = tickTimes.map(t => `<span>${(+t).toFixed(1)}s</span>`).join('');
}

function resetVideoUpload() {
  currentFile = null;
  lastResult  = null;

  const player = document.getElementById('videoPlayer');
  URL.revokeObjectURL(player.src);
  player.src = '';

  document.getElementById('videoPreview').classList.add('hidden');
  document.getElementById('dropZone').classList.remove('hidden');
  document.getElementById('analyzeBtn').disabled = true;
  document.getElementById('fileInput').value = '';

  if (probChart) { probChart.destroy(); probChart = null; }
  resetVideoResults();
}

/* ════════════════════════════════════════════════════
   WEBCAM
════════════════════════════════════════════════════ */
function initWebcamControls() {
  document.getElementById('startCamBtn').addEventListener('click', startCamera);
  document.getElementById('stopCamBtn').addEventListener('click', stopCamera);

  document.addEventListener('prediction', e => onLivePrediction(e.detail));
  document.addEventListener('webcam:predicting', e => {
    const el = document.getElementById('camAnalyzing');
    e.detail ? el.classList.remove('hidden') : el.classList.add('hidden');
  });
  document.addEventListener('webcam:snapshot', e => {
    const wrap = document.getElementById('snapshotWrap');
    const img  = document.getElementById('snapshotImg');
    if (!wrap || !img) return;
    wrap.classList.remove('hidden');
    img.src = e.detail.snapshot;
    document.getElementById('snapshotTs').textContent    = e.detail.ts;
    document.getElementById('snapshotLabel').textContent = '⏳ Đang phân tích…';
  });
}

async function startCamera() {
  const videoEl  = document.getElementById('webcamVideo');
  const canvasEl = document.getElementById('webcamCanvas');
  try {
    webcamCtrl = new WebcamController(videoEl, canvasEl);
    await webcamCtrl.start();

    document.getElementById('camPh').classList.add('hidden');
    document.getElementById('camLiveTag').classList.remove('hidden');
    document.getElementById('startCamBtn').classList.add('hidden');
    document.getElementById('stopCamBtn').classList.remove('hidden');

    if (!donutChart) donutChart = createDonutChart('donutChart', modelClasses);
  } catch (err) {
    alert(`Không thể truy cập camera:\n${err.message}`);
    console.error(err);
  }
}

function stopCamera() {
  webcamCtrl?.stop();
  webcamCtrl = null;
  document.getElementById('camPh').classList.remove('hidden');
  document.getElementById('camLiveTag').classList.add('hidden');
  document.getElementById('camAnalyzing').classList.add('hidden');
  document.getElementById('startCamBtn').classList.remove('hidden');
  document.getElementById('stopCamBtn').classList.add('hidden');
}

function onLivePrediction(data) {
  document.getElementById('livePlaceholder').classList.add('hidden');
  document.getElementById('liveData').classList.remove('hidden');

  const meta = CLASS_META[data.action] || { emoji: '🎬' };
  document.getElementById('liveEmoji').textContent = meta.emoji;
  document.getElementById('liveLabel').textContent = data.action.toUpperCase();
  document.getElementById('liveConf').textContent  =
    `${(data.confidence * 100).toFixed(1)}%  ·  ${data.inference_ms}ms`;

  // Update snapshot overlay label
  const labelEl = document.getElementById('snapshotLabel');
  if (labelEl) labelEl.textContent = `${meta.emoji} ${data.action.toUpperCase()}  ${(data.confidence * 100).toFixed(0)}%`;

  updateDonutChart(donutChart, data.probabilities);
  pushHistory(data);
}

function pushHistory(data) {
  const meta = CLASS_META[data.action] || { emoji: '🎬', color: '#6B7280' };
  predHistory.unshift({
    action:     data.action,
    confidence: data.confidence,
    emoji:      meta.emoji,
    color:      meta.color,
    time:       new Date().toLocaleTimeString('vi-VN'),
  });
  if (predHistory.length > 10) predHistory.pop();

  const container = document.getElementById('historyChips');
  container.innerHTML = predHistory.map(p =>
    `<span class="hist-chip" style="background:${p.color}" title="${p.time}">
       ${p.emoji} ${p.action} <em>${(p.confidence * 100).toFixed(0)}%</em>
     </span>`
  ).join('');
}

/* ════════════════════════════════════════════════════
   EXPORT REPORT (PNG via canvas)
════════════════════════════════════════════════════ */
function openExportModal() {
  if (!lastResult) return;
  const modal  = document.getElementById('exportModal');
  const canvas = document.getElementById('exportCanvas');
  modal.classList.remove('hidden');

  const W = 560, H = 430;
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = '#2563EB';
  ctx.fillRect(0, 0, W, 58);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 17px Inter, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('🏃 KTH Action Recognition — Báo cáo kết quả', 18, 29);

  // Action
  const meta = CLASS_META[lastResult.action] || { emoji: '🎬' };
  ctx.fillStyle    = '#111827';
  ctx.font         = 'bold 34px Inter, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${meta.emoji}  ${lastResult.action.toUpperCase()}`, 18, 108);

  const cc = lastResult.confidence >= 0.75 ? '#059669'
           : lastResult.confidence >= 0.5  ? '#B45309' : '#DC2626';
  ctx.fillStyle = cc;
  ctx.font      = 'bold 20px Inter, sans-serif';
  ctx.fillText(`Confidence: ${(lastResult.confidence * 100).toFixed(1)}%`, 18, 142);

  // Divider
  ctx.strokeStyle = '#E5E7EB';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(18, 158); ctx.lineTo(W - 18, 158); ctx.stroke();

  // Probabilities
  ctx.fillStyle = '#6B7280';
  ctx.font      = '600 11px Inter, sans-serif';
  ctx.fillText('XÁC SUẤT TỪNG LỚP', 18, 178);

  const classes = modelClasses.length ? modelClasses : Object.keys(lastResult.probabilities);
  const BAR_X   = 130, BAR_MAX_W = W - 170;

  classes.forEach((cls, i) => {
    const prob  = lastResult.probabilities[cls] || 0;
    const y     = 190 + i * 34;
    const bw    = BAR_MAX_W * prob;
    const color = ACTION_COLORS[cls] || '#6B7280';

    // Track
    ctx.fillStyle = '#F3F4F6';
    ctx.fillRect(BAR_X, y, BAR_MAX_W, 20);
    // Fill
    if (bw > 0) {
      ctx.fillStyle = color;
      ctx.fillRect(BAR_X, y, bw, 20);
    }
    // Label
    ctx.fillStyle    = '#374151';
    ctx.font         = '13px Inter, sans-serif';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(cls, 18, y + 10);
    // Percent
    ctx.textAlign = 'right';
    ctx.fillText(`${(prob * 100).toFixed(1)}%`, W - 18, y + 10);
  });

  // Footer
  ctx.fillStyle = '#9CA3AF';
  ctx.font      = '10px Inter, sans-serif';
  ctx.textAlign = 'left';
  const ts = new Date().toLocaleString('vi-VN');
  const framesInfo = lastResult.n_frames != null ? `${lastResult.n_frames} frames` : `${lastResult.inference_ms}ms`;
  ctx.fillText(`File: ${lastResult.filename || '—'}  ·  ${framesInfo}  ·  ${ts}`, 18, H - 14);
  ctx.textAlign = 'right';
  ctx.fillText('Đại học Bách Khoa Đà Nẵng — 2024/2025', W - 18, H - 14);

  // Wire buttons
  document.getElementById('downloadBtn').onclick = () => {
    const a  = document.createElement('a');
    a.href   = canvas.toDataURL('image/png');
    a.download = `kth_report_${lastResult.action}_${Date.now()}.png`;
    a.click();
  };
  const closeModal = () => document.getElementById('exportModal').classList.add('hidden');
  document.getElementById('modalClose').onclick      = closeModal;
  document.getElementById('modalCancelBtn').onclick  = closeModal;
}
