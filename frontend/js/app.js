'use strict';

/* ════════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════════ */
let currentFile       = null;
let probChart         = null;
let donutChart        = null;
let ablationChart     = null;
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
  loadModelInfo();
  renderPipeline();
  renderClassCards();
  // Init ablation chart (default active tab)
  ablationChart = createAblationChart('ablationChart');
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

  // Lazy-init charts when their pane becomes visible
  if (group === 'insights') {
    if (tab === 'matrix')   drawConfusionMatrix('confusionCanvas');
    if (tab === 'ablation' && !ablationChart) ablationChart = createAblationChart('ablationChart');
  }
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

  const form = new FormData();
  form.append('file', currentFile);

  try {
    const res = await fetch('/api/predict/video', { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    lastResult = { ...data, filename: currentFile.name };
    renderVideoResults(data);
  } catch (err) {
    alert(`Lỗi phân tích: ${err.message}`);
    console.error(err);
  } finally {
    setVideoLoading(false);
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

function renderVideoResults(data) {
  document.getElementById('videoPlaceholder').classList.add('hidden');
  const content = document.getElementById('videoResultsContent');
  content.classList.remove('hidden');

  const meta = CLASS_META[data.action] || { emoji: '🎬' };
  document.getElementById('resultEmoji').textContent = meta.emoji;
  document.getElementById('resultLabel').textContent = data.action.toUpperCase();
  document.getElementById('resultConf').textContent  =
    `Confidence: ${(data.confidence * 100).toFixed(1)}%`;

  updateGauge(data.confidence, 'gaugeArc', 'gaugeNum');

  if (!probChart) probChart = createProbabilityChart('probChart', modelClasses);
  updateProbabilityChart(probChart, data.probabilities);

  const badge = document.getElementById('speedBadge');
  badge.classList.remove('hidden');
  document.getElementById('inferenceTime').textContent = `${data.inference_ms} ms`;
  document.getElementById('frameInfo').textContent =
    `${data.n_frames} frames${data.fps ? ' · ' + data.fps + ' fps' : ''}`;
}

function resetVideoResults() {
  document.getElementById('videoResultsContent').classList.add('hidden');
  document.getElementById('videoPlaceholder').classList.remove('hidden');
  document.getElementById('speedBadge').classList.add('hidden');
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
  document.getElementById('captureNowBtn').addEventListener('click', () => webcamCtrl?.captureNow());

  document.addEventListener('prediction', e => onLivePrediction(e.detail));
  document.addEventListener('webcam:predicting', e => {
    const el = document.getElementById('camAnalyzing');
    e.detail ? el.classList.remove('hidden') : el.classList.add('hidden');
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
    document.getElementById('captureNowBtn').disabled = false;

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
  document.getElementById('captureNowBtn').disabled = true;
}

function onLivePrediction(data) {
  document.getElementById('livePlaceholder').classList.add('hidden');
  document.getElementById('liveData').classList.remove('hidden');

  const meta = CLASS_META[data.action] || { emoji: '🎬' };
  document.getElementById('liveEmoji').textContent = meta.emoji;
  document.getElementById('liveLabel').textContent = data.action.toUpperCase();
  document.getElementById('liveConf').textContent  =
    `${(data.confidence * 100).toFixed(1)}%  ·  ${data.inference_ms}ms`;

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
   MODEL INFO (update hero stats from API)
════════════════════════════════════════════════════ */
async function loadModelInfo() {
  try {
    const res  = await fetch('/api/model-info');
    if (!res.ok) return;
    const data = await res.json();
    modelClasses = data.classes || modelClasses;

    const el1 = document.getElementById('statAccuracy');
    const el2 = document.getElementById('statLogoCv');
    if (el1) el1.innerHTML = `${data.test_accuracy}<span class="stat-pct">%</span>`;
    if (el2) el2.innerHTML = `${data.logo_cv_mean}<span class="stat-pct">%</span>`;
  } catch (e) {
    console.warn('Model info unavailable:', e.message);
  }
}

/* ════════════════════════════════════════════════════
   PIPELINE SVG DIAGRAM
════════════════════════════════════════════════════ */
function renderPipeline() {
  const wrap = document.getElementById('pipelineDiagram');
  if (!wrap) return;

  wrap.innerHTML = `
<svg viewBox="0 0 920 290" xmlns="http://www.w3.org/2000/svg"
     style="width:100%;max-width:920px;display:block;margin:0 auto;font-family:Inter,sans-serif">
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <polygon points="0 0,8 3,0 6" fill="#9CA3AF"/>
    </marker>
  </defs>

  <!-- Video -->
  <rect x="12" y="115" width="82" height="46" rx="8" fill="#EFF6FF" stroke="#2563EB" stroke-width="1.5"/>
  <text x="53" y="134" text-anchor="middle" font-size="12" font-weight="700" fill="#1D4ED8">Video</text>
  <text x="53" y="150" text-anchor="middle" font-size="10" fill="#6B7280">input</text>

  <!-- Feature blocks -->
  <rect x="134" y="24"  width="116" height="44" rx="8" fill="#EFF6FF" stroke="#2563EB" stroke-width="1.5"/>
  <text x="192" y="43"  text-anchor="middle" font-size="12" font-weight="700" fill="#1D4ED8">HOG</text>
  <text x="192" y="58"  text-anchor="middle" font-size="10" fill="#6B7280">3528d — shape</text>

  <rect x="134" y="90"  width="116" height="44" rx="8" fill="#ECFDF5" stroke="#10B981" stroke-width="1.5"/>
  <text x="192" y="109" text-anchor="middle" font-size="12" font-weight="700" fill="#059669">Optical Flow</text>
  <text x="192" y="124" text-anchor="middle" font-size="10" fill="#6B7280">24d — motion</text>

  <rect x="134" y="156" width="116" height="44" rx="8" fill="#FFFBEB" stroke="#F59E0B" stroke-width="1.5"/>
  <text x="192" y="175" text-anchor="middle" font-size="12" font-weight="700" fill="#B45309">MHI</text>
  <text x="192" y="190" text-anchor="middle" font-size="10" fill="#6B7280">1767d — history</text>

  <rect x="134" y="222" width="116" height="44" rx="8" fill="#F5F3FF" stroke="#8B5CF6" stroke-width="1.5"/>
  <text x="192" y="241" text-anchor="middle" font-size="12" font-weight="700" fill="#6D28D9">IDT</text>
  <text x="192" y="256" text-anchor="middle" font-size="10" fill="#6B7280">96d — trajectories</text>

  <!-- Arrows: video → features -->
  <line x1="94"  y1="138" x2="132" y2="46"  stroke="#CBD5E1" stroke-width="1.5" marker-end="url(#arr)"/>
  <line x1="94"  y1="138" x2="132" y2="112" stroke="#CBD5E1" stroke-width="1.5" marker-end="url(#arr)"/>
  <line x1="94"  y1="138" x2="132" y2="178" stroke="#CBD5E1" stroke-width="1.5" marker-end="url(#arr)"/>
  <line x1="94"  y1="138" x2="132" y2="244" stroke="#CBD5E1" stroke-width="1.5" marker-end="url(#arr)"/>

  <!-- Concat -->
  <rect x="298" y="108" width="108" height="64" rx="8" fill="#F9FAFB" stroke="#E5E7EB" stroke-width="1.5"/>
  <text x="352" y="133" text-anchor="middle" font-size="12" font-weight="700" fill="#374151">Concat</text>
  <text x="352" y="152" text-anchor="middle" font-size="11" fill="#6B7280">5415 dims</text>

  <!-- Arrows: features → concat -->
  <line x1="250" y1="46"  x2="296" y2="122" stroke="#CBD5E1" stroke-width="1.5" marker-end="url(#arr)"/>
  <line x1="250" y1="112" x2="296" y2="132" stroke="#CBD5E1" stroke-width="1.5" marker-end="url(#arr)"/>
  <line x1="250" y1="178" x2="296" y2="148" stroke="#CBD5E1" stroke-width="1.5" marker-end="url(#arr)"/>
  <line x1="250" y1="244" x2="296" y2="158" stroke="#CBD5E1" stroke-width="1.5" marker-end="url(#arr)"/>

  <!-- Scaler -->
  <rect x="454" y="108" width="108" height="64" rx="8" fill="#F9FAFB" stroke="#E5E7EB" stroke-width="1.5"/>
  <text x="508" y="133" text-anchor="middle" font-size="12" font-weight="700" fill="#374151">StandardScaler</text>
  <text x="508" y="152" text-anchor="middle" font-size="10" fill="#6B7280">zero mean, unit var</text>
  <line x1="406" y1="140" x2="452" y2="140" stroke="#CBD5E1" stroke-width="1.5" marker-end="url(#arr)"/>

  <!-- PCA -->
  <rect x="610" y="108" width="108" height="64" rx="8" fill="#FDF4FF" stroke="#A855F7" stroke-width="1.5"/>
  <text x="664" y="130" text-anchor="middle" font-size="12" font-weight="700" fill="#7E22CE">PCA</text>
  <text x="664" y="148" text-anchor="middle" font-size="10" fill="#9333EA">330d (95% var.)</text>
  <text x="664" y="163" text-anchor="middle" font-size="9"  fill="#A78BFA">5415→330</text>
  <line x1="562" y1="140" x2="608" y2="140" stroke="#CBD5E1" stroke-width="1.5" marker-end="url(#arr)"/>

  <!-- SVM -->
  <rect x="766" y="108" width="108" height="64" rx="8" fill="#FFF1F2" stroke="#EF4444" stroke-width="1.5"/>
  <text x="820" y="128" text-anchor="middle" font-size="12" font-weight="700" fill="#B91C1C">SVM</text>
  <text x="820" y="145" text-anchor="middle" font-size="10" fill="#DC2626">Linear · C=0.1</text>
  <text x="820" y="161" text-anchor="middle" font-size="9"  fill="#6B7280">Acc 80.2%</text>
  <line x1="718" y1="140" x2="764" y2="140" stroke="#CBD5E1" stroke-width="1.5" marker-end="url(#arr)"/>

  <!-- Output labels -->
  <line x1="874" y1="140" x2="896" y2="140" stroke="#CBD5E1" stroke-width="1.5" marker-end="url(#arr)"/>
  <text x="898" y="118" font-size="10" font-weight="600" fill="#059669">boxing</text>
  <text x="898" y="132" font-size="10" fill="#6B7280">handclap.</text>
  <text x="898" y="146" font-size="10" fill="#6B7280">handwav.</text>
  <text x="898" y="160" font-size="10" fill="#6B7280">jogging</text>
  <text x="898" y="174" font-size="10" fill="#6B7280">running</text>
  <text x="898" y="188" font-size="10" fill="#6B7280">walking</text>
</svg>`;
}

/* ════════════════════════════════════════════════════
   ABOUT CLASSES GRID
════════════════════════════════════════════════════ */
function renderClassCards() {
  const grid = document.getElementById('classesGrid');
  if (!grid) return;

  grid.innerHTML = Object.entries(CLASS_META).map(([name, m]) => {
    const rc = m.recall >= 90 ? '#059669'
             : m.recall >= 70 ? '#D97706'
             :                   '#DC2626';
    return `<div class="class-card">
      <div class="class-emoji">${m.emoji}</div>
      <div class="class-name">${name}</div>
      <span class="recall-badge" style="background:${rc}18;color:${rc}">Recall ${m.recall}%</span>
      <p class="class-desc">${m.desc}</p>
    </div>`;
  }).join('');
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
  ctx.fillText(`File: ${lastResult.filename || '—'}  ·  ${lastResult.n_frames} frames  ·  ${lastResult.inference_ms}ms  ·  ${ts}`, 18, H - 14);
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
