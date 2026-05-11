'use strict';

/* ════════════════════════════════════════════════════
   SHARED CONSTANTS (global — used by webcam.js & app.js)
════════════════════════════════════════════════════ */
const ACTION_COLORS = {
  boxing:       '#EF4444',
  handclapping: '#8B5CF6',
  handwaving:   '#3B82F6',
  jogging:      '#10B981',
  running:      '#F59E0B',
  walking:      '#EC4899',
};

/* ════════════════════════════════════════════════════
   ABLATION STUDY DATA (from training results)
════════════════════════════════════════════════════ */
const ABLATION = {
  labels: ['IDT only', 'OF only', 'MHI only', 'HOG only', 'HOG + OF', 'HOG + OF + MHI', 'ALL (+ IDT)'],
  values: [31.2, 55.2, 67.7, 70.8, 71.9, 77.1, 80.2],
};

/* ════════════════════════════════════════════════════
   CONFUSION MATRIX
   Derived from test set: precision/recall per class
   boxing:P=1.000 R=0.750 | handclapping:P=0.941 R=1.000
   handwaving:P=1.000 R=1.000 | jogging:P=0.533 R=0.500
   running:P=0.733 R=0.688 | walking:P=0.667 R=0.875
════════════════════════════════════════════════════ */
const CM_LABELS = ['boxing', 'handclap.', 'handwav.', 'jogging', 'running', 'walking'];
const CM_DATA   = [
  [12, 1,  0,  2,  0,  1],  // boxing      (row sum = 16)
  [ 0,16,  0,  0,  0,  0],  // handclapping
  [ 0, 0, 16,  0,  0,  0],  // handwaving
  [ 0, 0,  0,  8,  3,  5],  // jogging
  [ 0, 0,  0,  4, 11,  1],  // running
  [ 0, 0,  0,  1,  1, 14],  // walking
];

/* ════════════════════════════════════════════════════
   ABLATION CHART (horizontal bar)
════════════════════════════════════════════════════ */
function createAblationChart(canvasId) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  // Gradient from blue→orange as accuracy increases
  const palette = [
    '#B45309', '#D97706', '#F59E0B', '#2563EB',
    '#1D4ED8', '#059669', '#10B981',
  ];

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ABLATION.labels,
      datasets: [{
        label: 'Accuracy (%)',
        data: ABLATION.values,
        backgroundColor: palette,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: c => ` ${c.parsed.x.toFixed(1)}%` },
        },
        title: {
          display: true,
          text: 'Ablation Study — Đóng góp từng loại đặc trưng vào độ chính xác',
          font: { size: 13, weight: '600', family: 'Inter' },
          color: '#111827',
          padding: { bottom: 16 },
        },
      },
      scales: {
        x: {
          min: 0, max: 100,
          grid: { color: '#F3F4F6' },
          ticks: { callback: v => v + '%', color: '#6B7280' },
        },
        y: {
          grid: { display: false },
          ticks: { color: '#374151', font: { weight: '600' } },
        },
      },
    },
  });
}

/* ════════════════════════════════════════════════════
   PROBABILITY BAR CHART (horizontal)
════════════════════════════════════════════════════ */
function createProbabilityChart(canvasId, classes) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const lbls = classes || Object.keys(ACTION_COLORS);

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: lbls,
      datasets: [{
        label: 'Probability',
        data: Array(lbls.length).fill(0),
        backgroundColor: lbls.map(c => ACTION_COLORS[c] || '#6B7280'),
        borderRadius: 5,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      animation: { duration: 380 },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${(c.parsed.x * 100).toFixed(1)}%` } },
      },
      scales: {
        x: {
          min: 0, max: 1,
          grid: { color: '#F9FAFB' },
          ticks: { callback: v => (v * 100).toFixed(0) + '%', color: '#9CA3AF', font: { size: 11 } },
        },
        y: {
          grid: { display: false },
          ticks: { color: '#374151', font: { size: 12 } },
        },
      },
    },
  });
}

function updateProbabilityChart(chart, probabilities) {
  if (!chart) return;
  chart.data.datasets[0].data = chart.data.labels.map(l => probabilities[l] || 0);
  chart.update('active');
}

/* ════════════════════════════════════════════════════
   DONUT CHART (webcam live probabilities)
════════════════════════════════════════════════════ */
function createDonutChart(canvasId, classes) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const lbls = classes || Object.keys(ACTION_COLORS);

  return new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: lbls,
      datasets: [{
        data: lbls.map(() => 1 / lbls.length),
        backgroundColor: lbls.map(c => ACTION_COLORS[c] || '#E5E7EB'),
        borderWidth: 2,
        borderColor: '#fff',
        hoverOffset: 5,
      }],
    },
    options: {
      responsive: false,
      animation: { duration: 350 },
      cutout: '60%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            font: { size: 11, family: 'Inter' },
            padding: 8, color: '#374151',
            generateLabels(chart) {
              return chart.data.labels.map((lbl, i) => ({
                text: `${lbl}  ${(chart.data.datasets[0].data[i] * 100).toFixed(0)}%`,
                fillStyle: chart.data.datasets[0].backgroundColor[i],
                index: i,
              }));
            },
          },
        },
        tooltip: { callbacks: { label: c => ` ${(c.parsed * 100).toFixed(1)}%` } },
      },
    },
  });
}

function updateDonutChart(chart, probabilities) {
  if (!chart) return;
  chart.data.datasets[0].data = chart.data.labels.map(l => probabilities[l] || 0);
  chart.update('active');
}

/* ════════════════════════════════════════════════════
   CONFUSION MATRIX (custom canvas renderer)
════════════════════════════════════════════════════ */
function drawConfusionMatrix(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const N    = CM_LABELS.length;
  const CELL = 72;
  const ML   = 92;   // margin left
  const MT   = 96;   // margin top
  const MR   = 24;
  const MB   = 40;

  canvas.width  = ML + N * CELL + MR;
  canvas.height = MT + N * CELL + MB;
  canvas.style.maxWidth = '100%';
  canvas.style.height   = 'auto';

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const rowSums = CM_DATA.map(r => r.reduce((a, b) => a + b, 0));

  // Draw cells
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const val  = CM_DATA[i][j];
      const norm = rowSums[i] > 0 ? val / rowSums[i] : 0;
      const cx   = ML + j * CELL;
      const cy   = MT + i * CELL;

      // Background color
      if (i === j) {
        ctx.fillStyle = `rgba(16,185,129,${0.12 + norm * 0.82})`;
      } else if (val > 0) {
        ctx.fillStyle = `rgba(239,68,68,${0.06 + norm * 0.78})`;
      } else {
        ctx.fillStyle = '#F9FAFB';
      }
      ctx.fillRect(cx, cy, CELL, CELL);

      // Cell border
      ctx.strokeStyle = '#E5E7EB';
      ctx.lineWidth   = 1;
      ctx.strokeRect(cx, cy, CELL, CELL);

      if (val === 0) continue;

      // Count
      const bright = norm > 0.42;
      ctx.fillStyle    = bright ? '#ffffff' : '#111827';
      ctx.font         = `bold 17px Inter, sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(val, cx + CELL / 2, cy + CELL / 2 - 9);

      // Percentage
      ctx.font      = `11px Inter, sans-serif`;
      ctx.fillStyle = bright ? 'rgba(255,255,255,.75)' : '#6B7280';
      ctx.fillText(`${(norm * 100).toFixed(0)}%`, cx + CELL / 2, cy + CELL / 2 + 12);
    }
  }

  // Row labels (Actual)
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  ctx.font         = '12px Inter, sans-serif';
  ctx.fillStyle    = '#374151';
  for (let i = 0; i < N; i++) {
    ctx.fillText(CM_LABELS[i], ML - 8, MT + i * CELL + CELL / 2);
  }

  // Column labels (Predicted) — rotated 45°
  for (let j = 0; j < N; j++) {
    ctx.save();
    ctx.translate(ML + j * CELL + CELL / 2, MT - 10);
    ctx.rotate(-Math.PI / 4);
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.font         = '12px Inter, sans-serif';
    ctx.fillStyle    = '#374151';
    ctx.fillText(CM_LABELS[j], 0, 0);
    ctx.restore();
  }

  // Axis titles
  ctx.save();
  ctx.font      = '600 12px Inter, sans-serif';
  ctx.fillStyle = '#6B7280';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // X: Predicted
  ctx.fillText('Predicted →', ML + N * CELL / 2, canvas.height - 10);
  // Y: Actual
  ctx.translate(14, MT + N * CELL / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('← Actual', 0, 0);
  ctx.restore();

  // Legend bar
  const barX = ML, barY = canvas.height - 28, barW = N * CELL;
  const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  grad.addColorStop(0,   'rgba(16,185,129,.12)');
  grad.addColorStop(1,   'rgba(16,185,129,.95)');
  ctx.fillStyle = grad;
  ctx.fillRect(barX, barY, barW / 2, 8);
  const grad2 = ctx.createLinearGradient(barX + barW / 2, 0, barX + barW, 0);
  grad2.addColorStop(0, 'rgba(239,68,68,.12)');
  grad2.addColorStop(1, 'rgba(239,68,68,.9)');
  ctx.fillStyle = grad2;
  ctx.fillRect(barX + barW / 2, barY, barW / 2, 8);
}

/* ════════════════════════════════════════════════════
   GAUGE ARC UPDATE
════════════════════════════════════════════════════ */
function updateGauge(confidence, arcId, labelId) {
  const arc   = document.getElementById(arcId);
  const label = document.getElementById(labelId);
  if (!arc || !label) return;

  const MAX_DASH = 138.23;  // π × 44 (r=44)
  arc.setAttribute('stroke-dasharray', `${confidence * MAX_DASH} ${MAX_DASH}`);

  const color = confidence >= 0.75 ? '#10B981'
              : confidence >= 0.5  ? '#F59E0B'
              :                      '#EF4444';
  arc.setAttribute('stroke', color);
  label.textContent = `${(confidence * 100).toFixed(0)}%`;
  label.style.color  = color;
}
