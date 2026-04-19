// ── DOM refs ──────────────────────────────────────────────────
const canvas         = document.getElementById('grid-canvas');
const ctx            = canvas.getContext('2d');
const placeholder    = document.getElementById('placeholder');
const diameterInput  = document.getElementById('bead-diameter');
const gapInput       = document.getElementById('bead-gap');
const spacingValEl   = document.getElementById('spacing-val');
const bedWInput      = document.getElementById('bed-w');
const bedHInput      = document.getElementById('bed-h');
const dwellInput        = document.getElementById('dwell-time');
const originXInput      = document.getElementById('origin-x');
const originYInput      = document.getElementById('origin-y');
const blackBeadSideInput = document.getElementById('black-bead-side');
const whiteBeadSideInput = document.getElementById('white-bead-side');
const moveSpeedInput     = document.getElementById('move-speed');

// Servo S-values (calibrated)
const S_LEFT  = 110;
const S_REST  = 60;
const S_RIGHT = 22;
const gridInfoEl     = document.getElementById('grid-info');
const warningEl      = document.getElementById('warning');
const fileInput      = document.getElementById('file-input');

// ── Constants ─────────────────────────────────────────────────
const RULER_PX = 44;   // ruler strip thickness in pixels

// ── State ─────────────────────────────────────────────────────
let beadSpacingMm  = 7;   // center-to-center pitch = diameter + gap
let beadDiameterMm = 6;   // physical bead diameter (drives circle size)
let beadGapMm      = 1;   // edge-to-edge clearance between beads
let bedW = 400, bedH = 400;
let cols = 0, rows = 0, cellPx = 0;
let radiusPx = 0;
let grid = [];
let blackCount = 0;
let gridReady = false;
let isDrawing = false;
let activeTool = 'pen';
let lastPainted = null;
let showPath = false;

let colorBlack = '#1a1a1a';
let colorWhite = '#f0f0f0';
let colorSpace  = '#999999';

// ── Live spacing preview ──────────────────────────────────────
function updateSpacingDisplay() {
  const diam    = parseFloat(diameterInput.value) || 0;
  const gap     = parseFloat(gapInput.value)      || 0;
  const spacing = diam + gap;
  spacingValEl.textContent = spacing % 1 === 0 ? spacing.toFixed(1) : spacing.toFixed(2);
}

diameterInput.addEventListener('input', updateSpacingDisplay);
gapInput.addEventListener('input',      updateSpacingDisplay);

// ── Enable / disable design tools ────────────────────────────
function setToolsEnabled(on) {
  document.querySelectorAll('.tool-btn, #btn-import, #btn-clear, #btn-svg').forEach(el => {
    el.disabled = !on;
  });
  document.getElementById('btn-gcode').disabled = !on;
}

// ── Stats display ─────────────────────────────────────────────
function updateStats() {
  const total = cols * rows;
  const white = total - blackCount;
  gridInfoEl.innerHTML =
    `Grid: <strong style="color:#e0e0e0">${cols} &times; ${rows}</strong><br>` +
    `Total&nbsp;&nbsp;: ${total.toLocaleString()}<br>` +
    `&#9679; Black: <strong style="color:#e0e0e0">${blackCount.toLocaleString()}</strong><br>` +
    `&#9675; White: ${white.toLocaleString()}`;
  warningEl.style.display = total > 40000 ? 'block' : 'none';
}

// ── Apply Grid ────────────────────────────────────────────────
document.getElementById('btn-apply').addEventListener('click', () => {
  const newBedW    = parseFloat(bedWInput.value)     || 400;
  const newBedH    = parseFloat(bedHInput.value)     || 400;
  const newDiam    = parseFloat(diameterInput.value) || 6;
  const newGap     = parseFloat(gapInput.value)      || 1;
  const newSpacing = newDiam + newGap;

  if (newBedW <= 0 || newBedH <= 0 || newDiam <= 0 || newGap <= 0) {
    alert('All values must be positive numbers.');
    return;
  }
  const newCols = Math.floor(newBedW / newSpacing);
  const newRows = Math.floor(newBedH / newSpacing);
  if (newCols < 1 || newRows < 1) {
    alert('Bead spacing is larger than the bed — no beads fit.');
    return;
  }
  if (gridReady && blackCount > 0) {
    if (!confirm('Applying a new grid will clear your current design. Continue?')) return;
  }

  bedW           = newBedW;
  bedH           = newBedH;
  beadDiameterMm = newDiam;
  beadGapMm      = newGap;
  beadSpacingMm  = newSpacing;
  cols           = newCols;
  rows           = newRows;

  cellPx   = Math.max(5, Math.min(40, Math.floor(680 / cols)));
  radiusPx = (beadDiameterMm / beadSpacingMm) * cellPx * 0.5;

  // Canvas size includes ruler margins on left and top
  canvas.width  = cols * cellPx + RULER_PX;
  canvas.height = rows * cellPx + RULER_PX;

  grid = Array.from({ length: rows }, () => new Uint8Array(cols));
  blackCount = 0;

  placeholder.style.display = 'none';
  canvas.style.display = 'block';
  document.getElementById('stats-section').style.display = 'block';

  gridReady = true;
  setToolsEnabled(true);
  updateStats();
  render();
  updateTimeDisplay();
});

// ── Ruler label step ──────────────────────────────────────────
// Returns how many beads between each labelled tick (ensures ≥45px spacing)
function rulerLabelStep() {
  const minPx     = 45;
  const perLabel  = Math.ceil(minPx / cellPx);
  const nice      = [1, 2, 5, 10, 20, 50, 100, 200, 500];
  return nice.find(s => s >= perLabel) || perLabel;
}

// ── Draw rulers ───────────────────────────────────────────────
// Layout: Y ruler on the LEFT, X ruler on the BOTTOM.
// Origin (0,0) is at the bottom-left corner where both rulers meet.
function drawRulers() {
  const step      = rulerLabelStep();
  const rulerBg   = '#0f1e35';
  const borderClr = '#1a4060';
  const tickClr   = '#2a4a70';
  const labelClr  = '#6688aa';
  const arrowClr  = '#e94560';
  const gridH     = rows * cellPx;   // canvas Y where the grid ends and X ruler begins

  // ── Backgrounds ───────────────────────────────────────────
  ctx.fillStyle = rulerBg;
  ctx.fillRect(0, 0,    RULER_PX,      gridH);          // Y ruler (left)
  ctx.fillRect(0, gridH, canvas.width, RULER_PX);       // X ruler (bottom)

  // Corner square at (0,0) — bottom-left
  ctx.fillStyle = '#090f1a';
  ctx.fillRect(0, gridH, RULER_PX, RULER_PX);

  // ── Border lines between rulers and grid ──────────────────
  ctx.strokeStyle = borderClr;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(RULER_PX, 0);     ctx.lineTo(RULER_PX, gridH);        // right edge of Y ruler
  ctx.moveTo(RULER_PX, gridH); ctx.lineTo(canvas.width, gridH);    // top edge of X ruler
  ctx.stroke();

  ctx.font         = '9px system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  // ── X ruler (bottom) ──────────────────────────────────────
  ctx.textAlign = 'center';
  for (let c = 0; c <= cols; c++) {
    const x     = RULER_PX + c * cellPx;
    const major = c % step === 0;
    const tLen  = major ? 7 : 3;

    ctx.strokeStyle = tickClr;
    ctx.lineWidth   = 0.5;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, gridH);
    ctx.lineTo(x + 0.5, gridH + tLen);
    ctx.stroke();

    if (major) {
      const mm = c * beadSpacingMm;
      ctx.fillStyle = labelClr;
      ctx.fillText(mm % 1 === 0 ? mm : mm.toFixed(1), x, gridH + RULER_PX * 0.55);
    }
  }

  // ── Y ruler (left) — Y=0 at bottom, increases upward ──────
  ctx.textAlign = 'right';
  for (let r = 0; r <= rows; r++) {
    // r=0 → bottom of grid (canvas y = gridH), r=rows → top (canvas y = 0)
    const y     = (rows - r) * cellPx;
    const major = r % step === 0;
    const tLen  = major ? 7 : 3;

    ctx.strokeStyle = tickClr;
    ctx.lineWidth   = 0.5;
    ctx.beginPath();
    ctx.moveTo(RULER_PX - tLen, y + 0.5);
    ctx.lineTo(RULER_PX,        y + 0.5);
    ctx.stroke();

    if (major) {
      const mm = r * beadSpacingMm;
      ctx.fillStyle = labelClr;
      ctx.fillText(mm % 1 === 0 ? mm : mm.toFixed(1), RULER_PX - 13, y);

      // Direction arrow at the centre of logical row r (r=0 is bottom row)
      if (r < rows) {
        const rowCenterY = (rows - 1 - r) * cellPx + cellPx * 0.5;
        _drawRulerArrow(RULER_PX - 4, rowCenterY, r % 2 === 0, arrowClr);
      }
    }
  }

  // "mm" label in origin corner
  ctx.fillStyle    = '#334';
  ctx.font         = '8px system-ui, sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('mm', RULER_PX / 2, gridH + RULER_PX / 2);
}

// Small directional arrow drawn inside the Y ruler
function _drawRulerArrow(x, y, isLtr, color) {
  const s = 3.5;
  ctx.fillStyle = color;
  ctx.beginPath();
  if (isLtr) {                     // ▶ points right
    ctx.moveTo(x + s, y);
    ctx.lineTo(x - s, y - s * 0.65);
    ctx.lineTo(x - s, y + s * 0.65);
  } else {                         // ◀ points left
    ctx.moveTo(x - s, y);
    ctx.lineTo(x + s, y - s * 0.65);
    ctx.lineTo(x + s, y + s * 0.65);
  }
  ctx.closePath();
  ctx.fill();
}

// ── Draw snake path overlay ───────────────────────────────────
function drawPath() {
  if (!cols || !rows) return;
  const step = rulerLabelStep();

  ctx.save();

  // Path line
  ctx.strokeStyle = 'rgba(233, 69, 96, 0.50)';
  ctx.lineWidth   = Math.max(0.5, cellPx * 0.09);
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.beginPath();
  for (let r = 0; r < rows; r++) {
    const ltr = r % 2 === 0;
    for (let ci = 0; ci < cols; ci++) {
      const c = ltr ? ci : (cols - 1 - ci);
      const x = RULER_PX + c * cellPx + cellPx / 2;
      const y = (rows - 1 - r) * cellPx + cellPx / 2;  // Y-up, no top offset
      (r === 0 && ci === 0) ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  // Arrowheads at the start of every labelled row
  const arrowSz = Math.max(3, cellPx * 0.38);
  ctx.fillStyle = 'rgba(233, 69, 96, 0.85)';
  for (let r = 0; r < rows; r += step) {
    const ltr  = r % 2 === 0;
    const c    = ltr ? 0 : cols - 1;
    const sx   = RULER_PX + c * cellPx + cellPx / 2;
    const sy   = (rows - 1 - r) * cellPx + cellPx / 2;  // Y-up, no top offset
    ctx.beginPath();
    if (ltr) {
      ctx.moveTo(sx + arrowSz, sy);
      ctx.lineTo(sx - arrowSz, sy - arrowSz * 0.6);
      ctx.lineTo(sx - arrowSz, sy + arrowSz * 0.6);
    } else {
      ctx.moveTo(sx - arrowSz, sy);
      ctx.lineTo(sx + arrowSz, sy - arrowSz * 0.6);
      ctx.lineTo(sx + arrowSz, sy + arrowSz * 0.6);
    }
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

// ── Full canvas render ────────────────────────────────────────
function render() {
  // Grid area background — grid occupies y=0..rows*cellPx, X ruler is below
  ctx.fillStyle = colorSpace;
  ctx.fillRect(RULER_PX, 0, cols * cellPx, rows * cellPx);

  // Bead circles — row 0 at bottom (Y-up), X ruler below grid so no top offset
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.beginPath();
      ctx.arc(
        RULER_PX + c * cellPx + cellPx / 2,
        (rows - 1 - r) * cellPx + cellPx / 2,
        radiusPx, 0, Math.PI * 2
      );
      ctx.fillStyle = grid[r][c] === 1 ? colorBlack : colorWhite;
      ctx.fill();
    }
  }

  // Path overlay (if toggled on)
  if (showPath) drawPath();

  // Rulers drawn last so they always sit on top
  drawRulers();
}

// ── Paint a single cell (incremental, fast) ───────────────────
function paintCell(col, row) {
  if (col < 0 || col >= cols || row < 0 || row >= rows) return;
  const val = activeTool === 'pen' ? 1 : 0;
  if (grid[row][col] === val) return;

  if (val === 1) blackCount++;
  else           blackCount--;
  grid[row][col] = val;

  // Repaint this cell only (Y-up, X ruler is below the grid)
  ctx.fillStyle = colorSpace;
  ctx.fillRect(RULER_PX + col * cellPx, (rows - 1 - row) * cellPx, cellPx, cellPx);

  ctx.beginPath();
  ctx.arc(
    RULER_PX + col * cellPx + cellPx / 2,
    (rows - 1 - row) * cellPx + cellPx / 2,
    radiusPx, 0, Math.PI * 2
  );
  ctx.fillStyle = val === 1 ? colorBlack : colorWhite;
  ctx.fill();

  // Re-draw rulers on top (cheap, keeps them crisp)
  if (showPath) drawPath();
  drawRulers();

  updateStats();
}

function cellFromEvent(e) {
  const rect   = canvas.getBoundingClientRect();
  const col    = Math.floor((e.clientX - rect.left - RULER_PX) / cellPx);
  // No RULER_PX offset on Y — X ruler is at the bottom, grid starts at y=0
  const rawRow = Math.floor((e.clientY - rect.top) / cellPx);
  const row    = rows - 1 - rawRow;
  return { col, row };
}

// ── Mouse drawing ─────────────────────────────────────────────
canvas.addEventListener('mousedown', e => {
  if (!gridReady || e.button !== 0) return;
  isDrawing = true;
  const { col, row } = cellFromEvent(e);
  lastPainted = { col, row };
  paintCell(col, row);
});

canvas.addEventListener('mousemove', e => {
  if (!isDrawing) return;
  const { col, row } = cellFromEvent(e);
  if (lastPainted && lastPainted.col === col && lastPainted.row === row) return;
  lastPainted = { col, row };
  paintCell(col, row);
});

window.addEventListener('mouseup',    () => { isDrawing = false; lastPainted = null; });
canvas.addEventListener('mouseleave', () => { isDrawing = false; lastPainted = null; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ── Tool buttons ──────────────────────────────────────────────
document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    activeTool = btn.dataset.tool;
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ── Show path toggle ──────────────────────────────────────────
document.getElementById('btn-path').addEventListener('click', () => {
  if (!gridReady) return;
  showPath = !showPath;
  document.getElementById('btn-path').classList.toggle('active', showPath);
  render();
});

// ── Color pickers ─────────────────────────────────────────────
document.getElementById('color-black').addEventListener('input', e => {
  colorBlack = e.target.value;
  if (gridReady) render();
});
document.getElementById('color-white').addEventListener('input', e => {
  colorWhite = e.target.value;
  if (gridReady) render();
});
document.getElementById('color-space').addEventListener('input', e => {
  colorSpace = e.target.value;
  if (gridReady) render();
});

// ── Clear all ─────────────────────────────────────────────────
document.getElementById('btn-clear').addEventListener('click', () => {
  if (!gridReady || !confirm('Clear all beads?')) return;
  for (let r = 0; r < rows; r++) grid[r].fill(0);
  blackCount = 0;
  updateStats();
  render();
});

// ── Import image ──────────────────────────────────────────────
document.getElementById('btn-import').addEventListener('click', () => {
  if (!gridReady) return;
  fileInput.value = '';
  fileInput.click();
});

fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file || !gridReady) return;

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const off  = document.createElement('canvas');
    off.width  = cols;
    off.height = rows;
    const octx = off.getContext('2d');
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, cols, rows);
    octx.drawImage(img, 0, 0, cols, rows);

    const data = octx.getImageData(0, 0, cols, rows).data;
    blackCount = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i    = (r * cols + c) * 4;
        const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const val  = luma < 128 ? 1 : 0;
        grid[r][c] = val;
        if (val === 1) blackCount++;
      }
    }
    URL.revokeObjectURL(url);
    updateStats();
    render();
  };
  img.onerror = () => {
    alert('Could not load image.');
    URL.revokeObjectURL(url);
  };
  img.src = url;
});

// ── SVG download (laser-cut template) ────────────────────────
// Outlines only — bed border + all bead circles as 0.1 mm red strokes.
// No fills. Intended for laser cutting the base plate.
document.getElementById('btn-svg').addEventListener('click', () => {
  if (!gridReady) return;

  const beadR  = beadDiameterMm / 2;
  const total  = cols * rows;
  const lines  = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg"`);
  lines.push(`     width="${bedW}mm" height="${bedH}mm"`);
  lines.push(`     viewBox="0 0 ${bedW} ${bedH}">`);
  lines.push(`  <title>Pixel Bead Placer \u2014 Laser Cut Template \u2014 ${cols}\u00d7${rows}</title>`);
  lines.push(`  <!-- Bed: ${bedW}x${bedH}mm | Bead \u00d8: ${beadDiameterMm}mm | Gap: ${beadGapMm}mm | Pitch: ${beadSpacingMm}mm | Total holes: ${total} -->`);
  lines.push(`  <!-- Stroke: red | Stroke-width: 0.1mm | Fill: none | For laser cutting -->`);

  // All geometry in one group: fill=none, stroke=red, stroke-width=0.1mm
  lines.push(`  <g fill="none" stroke="red" stroke-width="0.1">`);

  // Bed border
  lines.push(`    <rect x="0" y="0" width="${bedW}" height="${bedH}"/>`);

  // One circle per bead position — all holes identical regardless of color
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (c * beadSpacingMm + beadSpacingMm / 2).toFixed(3);
      const cy = (r * beadSpacingMm + beadSpacingMm / 2).toFixed(3);
      lines.push(`    <circle cx="${cx}" cy="${cy}" r="${beadR}"/>`);
    }
  }

  lines.push(`  </g>`);
  lines.push(`</svg>`);

  const blob = new Blob([lines.join('\n')], { type: 'image/svg+xml' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'bead_plate_lasercut.svg';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── GCode builder (shared by download and machine runner) ─────
function buildGcodeLines() {
  const lines    = [];
  const now      = new Date().toISOString();
  const dwellMs  = Math.max(10, parseInt(dwellInput.value) || 300);
  const feedRate = Math.max(100, parseInt(moveSpeedInput.value) || 800);
  const originX  = parseFloat(originXInput.value) || 0;
  const originY  = parseFloat(originYInput.value) || 0;
  const total    = cols * rows;
  const whiteCnt = total - blackCount;

  lines.push(`; Pixel Bead Placer \u2014 GCode`);
  lines.push(`; Firmware      : grbl_esp32 (GRBL 1.1 compatible)`);
  lines.push(`; Bed size      : ${bedW} x ${bedH} mm`);
  lines.push(`; Bead diameter : ${beadDiameterMm} mm`);
  lines.push(`; Bead gap      : ${beadGapMm} mm  (edge-to-edge clearance)`);
  lines.push(`; Bead spacing  : ${beadSpacingMm} mm  (center-to-center = diameter + gap)`);
  lines.push(`; Grid          : ${cols} x ${rows}  (${total.toLocaleString()} beads)`);
  lines.push(`; Black beads   : ${blackCount.toLocaleString()}`);
  lines.push(`; White beads   : ${whiteCnt.toLocaleString()}`);
  lines.push(`; Origin        : X${originX} Y${originY} mm`);
  lines.push(`; Dwell/bead    : ${dwellMs} ms`);
  lines.push(`; Generated     : ${now}`);
  lines.push(`;`);
  const blackSide = blackBeadSideInput.value; // 'left' | 'right'
  const whiteSide = whiteBeadSideInput.value;
  const S_BLACK   = blackSide === 'left' ? S_LEFT : S_RIGHT;
  const S_WHITE   = whiteSide === 'left' ? S_LEFT : S_RIGHT;

  lines.push(`; Servo control (GPIO 27, 50Hz PWM):`);
  lines.push(`;   M3 S${S_LEFT}   \u2192  Left  bead`);
  lines.push(`;   M3 S${S_RIGHT}   \u2192  Right bead`);
  lines.push(`;   M3 S${S_REST}    \u2192  Rest (neutral)`);
  lines.push(`;   BLACK bead = ${blackSide} side (M3 S${S_BLACK})`);
  lines.push(`;   WHITE bead = ${whiteSide} side (M3 S${S_WHITE})`);
  lines.push(`;   G4 P${(dwellMs/1000).toFixed(3)}  \u2192  Dwell ${dwellMs} ms (bead drop time)`);
  lines.push(`;`);
  lines.push(`; Snake path: even rows L\u2192R, odd rows R\u2192L`);
  lines.push(``);
  lines.push(`G21`);
  lines.push(`G90`);
  lines.push(`M3 S${S_REST}`);
  lines.push(`G28`);
  lines.push(``);

  for (let r = 0; r < rows; r++) {
    const ltr = r % 2 === 0;
    lines.push(``);
    lines.push(`; Row ${r}  (${ltr ? 'L\u2192R' : 'R\u2192L'})`);
    for (let ci = 0; ci < cols; ci++) {
      const c     = ltr ? ci : (cols - 1 - ci);
      const color = grid[r][c];
      const xMm   = (originX + c * beadSpacingMm + beadSpacingMm / 2).toFixed(2);
      const yMm   = (originY + r * beadSpacingMm + beadSpacingMm / 2).toFixed(2);
      lines.push(`G1 X${xMm} Y${yMm} F${feedRate}`);
      lines.push(`G4 P0`);
      lines.push(color === 1 ? `M3 S${S_BLACK}` : `M3 S${S_WHITE}`);
      lines.push(`G4 P${(dwellMs/1000).toFixed(3)}`);
      lines.push(`M3 S${S_REST}`);
    }
  }
  lines.push(``);
  lines.push(`G28`);
  lines.push(`M30`);
  return lines;
}

// ── GCode download ────────────────────────────────────────────
document.getElementById('btn-gcode').addEventListener('click', () => {
  if (!gridReady) return;
  const lines = buildGcodeLines();
  const blob  = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a     = document.createElement('a');
  a.href      = URL.createObjectURL(blob);
  a.download  = 'bead_art.gcode';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ══════════════════════════════════════════════════════════════
// MACHINE CONTROL — Web Serial API (grbl_esp32 / GRBL 1.1)
// ══════════════════════════════════════════════════════════════

// ── Serial state ──────────────────────────────────────────────
let serialPort   = null;
let pollTimer    = null;
let serialWriter = null;
let rxBuffer     = '';

// ── Command queue — promise-based (for interactive commands) ──
// Each entry: { resolve, reject }  — resolved/rejected on 'ok'/'error'
const cmdQueue = [];

// ── Job state ─────────────────────────────────────────────────
let jobLines   = [];
let jobIndex   = 0;
let jobRunning = false;
let jobPaused  = false;
let jobStartTime = null;
let jobTimer     = null;

function fmtTime(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return h > 0
    ? `${h}h ${String(m % 60).padStart(2,'0')}m ${String(s % 60).padStart(2,'0')}s`
    : `${String(m).padStart(2,'0')}m ${String(s % 60).padStart(2,'0')}s`;
}

function estimateJobMs() {
  if (!gridReady || rows === 0 || cols === 0) return 0;
  const dwellMs   = Math.max(10, parseInt(dwellInput.value) || 300);
  const feedRate  = Math.max(100, parseInt(moveSpeedInput.value) || 800);
  const feedMmMs  = feedRate / 60000;
  const originX   = parseFloat(originXInput.value) || 0;
  const originY   = parseFloat(originYInput.value) || 0;
  let totalMs = 0, px = originX, py = originY;
  for (let r = 0; r < rows; r++) {
    const ltr = r % 2 === 0;
    for (let ci = 0; ci < cols; ci++) {
      const c  = ltr ? ci : (cols - 1 - ci);
      const x  = originX + c * beadSpacingMm + beadSpacingMm / 2;
      const y  = originY + r * beadSpacingMm + beadSpacingMm / 2;
      const d  = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
      totalMs += d / feedMmMs + dwellMs + 80; // travel + dwell + servo cmds
      px = x; py = y;
    }
  }
  return totalMs;
}

function updateTimeDisplay() {
  const el = document.getElementById('mp-time-info');
  if (!el) return;
  if (!jobRunning && !jobPaused) {
    if (gridReady) {
      el.textContent = `Est. time: ${fmtTime(estimateJobMs())}`;
    } else {
      el.textContent = '—';
    }
    return;
  }
  const elapsed = Date.now() - jobStartTime;
  const pct = jobLines.length > 0 ? jobIndex / jobLines.length : 0;
  const eta = pct > 0.01 ? (elapsed / pct) - elapsed : estimateJobMs();
  el.textContent = `Elapsed: ${fmtTime(elapsed)}  |  ETA: ${fmtTime(Math.max(0, eta))}`;
}

// ── Checklist state ───────────────────────────────────────────
const CHK = { connect: false, home: false, origin: false, testX: false, testY: false, testBead: false };

// ── DOM refs ──────────────────────────────────────────────────
const mpConnectBtn   = document.getElementById('btn-serial-connect');
const mpDot          = document.getElementById('serial-dot');
const mpStatusTxt    = document.getElementById('serial-status-text');
const mpMcStatus     = document.getElementById('mc-status');
const mpMcPosX       = document.getElementById('mc-pos-x');
const mpMcPosY       = document.getElementById('mc-pos-y');
const mpTerminal     = document.getElementById('serial-terminal');
const mpRunBtn       = document.getElementById('btn-run-gcode');
const mpPauseBtn     = document.getElementById('btn-pause-gcode');
const mpStopBtn      = document.getElementById('btn-stop-gcode');
const mpProgFill     = document.getElementById('mp-progress-fill');
const mpProgText     = document.getElementById('mp-progress-text');
const mpJobInfo      = document.getElementById('mp-job-info');
const mpCmdInput     = document.getElementById('serial-cmd');
const mpSendBtn      = document.getElementById('btn-send-cmd');

// ── Terminal ──────────────────────────────────────────────────
function termLog(text, type) {
  // type: 'rx' | 'tx' | 'sys' | 'err'
  const div  = document.createElement('div');
  div.className = 'term-line term-' + type;
  const t    = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const pfx  = type === 'tx' ? '\u2192 ' : type === 'sys' ? '# ' : type === 'err' ? '\u2717 ' : '\u2190 ';
  div.textContent = `[${t}] ${pfx}${text}`;
  mpTerminal.appendChild(div);
  mpTerminal.scrollTop = mpTerminal.scrollHeight;
  // Cap at 600 lines
  while (mpTerminal.childElementCount > 600) mpTerminal.removeChild(mpTerminal.firstChild);
}

document.getElementById('btn-clr-terminal').addEventListener('click', () => {
  mpTerminal.innerHTML = '';
});

document.getElementById('btn-copy-terminal').addEventListener('click', () => {
  const text = Array.from(mpTerminal.querySelectorAll('.term-line'))
    .map(el => el.textContent).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('btn-copy-terminal');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
});

// ── Raw write (fire-and-forget) ────────────────────────────────
async function sendRaw(cmd, silent = false) {
  if (!serialWriter) return;
  if (!silent) termLog(cmd, 'tx');
  try {
    await serialWriter.write(new TextEncoder().encode(cmd + '\n'));
  } catch (e) {
    termLog('Write error: ' + e.message, 'err');
  }
}

let silentOkCount = 0; // suppress ok responses from silent polls

// ── Promise-based send (waits for GRBL 'ok') ─────────────────
function sendCmd(cmd) {
  if (!serialWriter) return Promise.reject(new Error('Not connected'));
  return new Promise((resolve, reject) => {
    cmdQueue.push({ resolve, reject });
    sendRaw(cmd);
  });
}

// ── Status poll button ────────────────────────────────────────
document.getElementById('btn-poll').addEventListener('click', () => {
  if (serialWriter) sendRaw('?');
});

// ── Manual terminal send ───────────────────────────────────────
// Supports \n as separator — e.g. "$X\n$22=0\nG0 X10 F500"
// Each command is sent sequentially, waiting for ok before the next.
mpSendBtn.addEventListener('click', async () => {
  const raw = mpCmdInput.value.trim();
  if (!raw || !serialWriter) return;
  mpCmdInput.value = '';
  mpSendBtn.disabled = true;

  // Split on literal \n typed by user OR actual newline characters
  const cmds = raw.split(/\\n|\n/).map(c => c.trim()).filter(c => c.length > 0);
  for (const cmd of cmds) {
    try {
      if (cmd === '?') sendRaw('?');
      else await sendCmd(cmd);
    } catch (e) {
      termLog('Stopped at: ' + cmd + ' — ' + e.message, 'err');
      break;
    }
  }
  mpSendBtn.disabled = false;
});
mpCmdInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') mpSendBtn.click();
});

// ── Connect / Disconnect ──────────────────────────────────────
mpConnectBtn.addEventListener('click', async () => {
  if (serialPort) await doDisconnect();
  else            await doConnect();
});

async function doConnect() {
  if (!('serial' in navigator)) {
    alert('Web Serial API not supported.\nUse Google Chrome or Microsoft Edge (v89+).\n\nIn Chrome: chrome://flags → enable Experimental Web Platform Features if needed.');
    return;
  }
  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 115200 });
    serialWriter = serialPort.writable.getWriter();
    startReading();
    onConnected(true);
    termLog('Port opened at 115200 baud', 'sys');
    // Poll status once on connect, then every 2s while connected
    setTimeout(() => { if (serialWriter) { silentOkCount++; sendRaw('?', true); } }, 1200);
    pollTimer = setInterval(() => { if (serialWriter) { silentOkCount++; sendRaw('?', true); } }, 2000);
  } catch (err) {
    serialPort = null;
    if (err.name !== 'NotFoundError') termLog('Connect failed: ' + err.message, 'err');
  }
}

async function doDisconnect() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  const wasRunning = jobRunning || jobPaused;
  jobRunning = false;
  jobPaused  = false;
  // Reject all waiting commands
  while (cmdQueue.length) cmdQueue.shift().reject(new Error('Disconnected'));
  if (serialWriter) { try { serialWriter.releaseLock(); } catch {} serialWriter = null; }
  if (serialPort)   { try { await serialPort.close();   } catch {} serialPort   = null; }
  onConnected(false);
  if (wasRunning) termLog('Job aborted — port closed', 'err');
  termLog('Disconnected', 'sys');
}

function onConnected(on) {
  mpConnectBtn.textContent = on ? 'Disconnect' : 'Connect USB';
  mpConnectBtn.classList.toggle('connected', on);
  mpDot.className = 'serial-dot ' + (on ? 'dot-on' : 'dot-off');
  mpStatusTxt.textContent = on ? 'Connected' : 'Disconnected';

  // Toggle serial-dependent controls
  const serIds = ['btn-chk-home','btn-chk-origin','btn-chk-testx','btn-chk-testy',
                  'btn-chk-testbead','btn-chk-testbead-skip','btn-poll','jog-yp','jog-ym','jog-xp','jog-xm',
                  'jog-center','btn-send-cmd'];
  serIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !on;
  });
  mpCmdInput.disabled = !on;

  setChk('connect', on);
  if (!on) {
    ['home','origin','testX','testY','testBead'].forEach(k => setChk(k, false));
  }
  updateJobButtons();
}

// ── Serial read loop ──────────────────────────────────────────
async function startReading() {
  const decoder = new TextDecoder();
  while (serialPort && serialPort.readable) {
    const reader = serialPort.readable.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        rxBuffer += decoder.decode(value, { stream: true });
        while (rxBuffer.length > 0) {
          const ltIdx = rxBuffer.indexOf('<');
          const gtIdx = rxBuffer.indexOf('>');
          const nlIdx = rxBuffer.indexOf('\n');
          // Complete status report <...> — extract and parse silently
          if (ltIdx !== -1 && gtIdx !== -1 && ltIdx < gtIdx &&
              (nlIdx === -1 || ltIdx <= nlIdx)) {
            if (ltIdx > 0) {
              // flush anything before the '<'
              const before = rxBuffer.slice(0, ltIdx).replace(/\r/g, '').trim();
              if (before) handleLine(before);
            }
            parseGrblStatus(rxBuffer.slice(ltIdx, gtIdx + 1));
            rxBuffer = rxBuffer.slice(gtIdx + 1);
            continue;
          }
          // Normal \n-terminated line
          if (nlIdx === -1) break;
          const line = rxBuffer.slice(0, nlIdx).replace(/\r/g, '').trim();
          rxBuffer = rxBuffer.slice(nlIdx + 1);
          if (line) handleLine(line);
        }
      }
    } catch (_) {
      // port closed or reset — exit loop
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    break; // exit outer while — reconnect not attempted automatically
  }
}

// ── Handle incoming GRBL line ─────────────────────────────────
function handleLine(line) {
  // Status report (<...>) — parse quietly, don't flood terminal
  if (line.startsWith('<')) {
    parseGrblStatus(line);
    return;
  }

  if (line === 'ok' && silentOkCount > 0) {
    silentOkCount--;
    return; // suppress ok from auto-poll
  }

  termLog(line, 'rx');

  if (line === 'ok') {
    if (jobRunning && !jobPaused) {
      sendNextJobLine();
    } else if (cmdQueue.length) {
      cmdQueue.shift().resolve();
    }
    return;
  }

  if (line.startsWith('error:')) {
    if (jobRunning) {
      jobPaused = true;
      termLog('Job paused — GRBL error. Fix then Resume, or Stop.', 'err');
      updateJobButtons();
    } else if (cmdQueue.length) {
      cmdQueue.shift().reject(new Error(line));
    }
    return;
  }

  if (line.startsWith('ALARM:')) {
    if (cmdQueue.length) cmdQueue.shift().reject(new Error(line));
    if (jobRunning || jobPaused) {
      jobRunning = false;
      jobPaused  = false;
      termLog('Job halted — ALARM. Send $X to unlock.', 'err');
      updateJobButtons();
    }
    return;
  }
}

// ── Parse GRBL status report ─────────────────────────────────
// Format: <Idle|WPos:10.000,20.000,0.000|FS:0,0>
function parseGrblStatus(s) {
  const st = s.match(/^<([^|>]+)/);
  if (st) {
    mpMcStatus.textContent = st[1];
    mpMcStatus.style.color =
      st[1] === 'Idle'          ? '#4caf50' :
      st[1] === 'Run'           ? '#e94560' :
      st[1] === 'Hold:0'        ? '#ffcc80' :
      st[1] === 'Hold:1'        ? '#ffcc80' :
      st[1].startsWith('Alarm') ? '#ff5722' : '#aab';
  }
  const pos = s.match(/(?:WPos|MPos):([-\d.]+),([-\d.]+)/);
  if (pos) {
    mpMcPosX.textContent = parseFloat(pos[1]).toFixed(2) + ' mm';
    mpMcPosY.textContent = parseFloat(pos[2]).toFixed(2) + ' mm';
  }
}

// ── Checklist helpers ─────────────────────────────────────────
const CHK_IDS = {
  connect:'chk-connect', home:'chk-home', origin:'chk-origin',
  testX:'chk-testx', testY:'chk-testy', testBead:'chk-testbead'
};

function setChk(key, state) {
  // state: true (done) | false (pending)
  CHK[key] = !!state;
  const li = document.getElementById(CHK_IDS[key]);
  if (!li) return;
  li.dataset.state = state ? 'done' : 'pending';
  li.querySelector('.chk-icon').textContent = state ? '\u2713' : '\u25cb';
  // Sync "ready" item
  const allDone = Object.values(CHK).every(Boolean);
  const readyLi = document.getElementById('chk-ready');
  readyLi.dataset.state = allDone ? 'done' : 'pending';
  readyLi.querySelector('.chk-icon').textContent = allDone ? '\u2713' : '\u25cb';
  updateJobButtons();
}

function setChkBusy(key) {
  const li = document.getElementById(CHK_IDS[key]);
  if (li) { li.dataset.state = 'busy'; li.querySelector('.chk-icon').textContent = '\u2026'; }
}

// ── Checklist action: Home machine ────────────────────────────
document.getElementById('btn-chk-home').addEventListener('click', async () => {
  if (!serialPort) return;
  const btn = document.getElementById('btn-chk-home');
  btn.disabled = true;
  setChkBusy('home');
  termLog('Homing all axes ($H)…', 'sys');
  try {
    await sendCmd('$H');
    setChk('home', true);
    termLog('Homing complete — machine at (0,0)', 'sys');
    sendRaw('?');
  } catch (err) {
    setChk('home', false);
    termLog('Homing failed: ' + err.message + '  (send $X to clear ALARM)', 'err');
  } finally {
    btn.disabled = !serialPort;
  }
});

// ── Checklist action: Move to origin ─────────────────────────
document.getElementById('btn-chk-origin').addEventListener('click', async () => {
  if (!serialPort) return;
  const btn = document.getElementById('btn-chk-origin');
  btn.disabled = true;
  setChkBusy('origin');
  const ox = parseFloat(originXInput.value) || 0;
  const oy = parseFloat(originYInput.value) || 0;
  termLog(`Moving to origin X${ox} Y${oy}`, 'sys');
  try {
    await sendCmd('G21');
    await sendCmd('G90');
    await sendCmd(`G0 X${ox} Y${oy} F3000`);
    setChk('origin', true);
    termLog('At origin position', 'sys');
    sendRaw('?');
  } catch (err) {
    setChk('origin', false);
    termLog('Move failed: ' + err.message, 'err');
  } finally {
    btn.disabled = !serialPort;
  }
});

// ── Checklist action: Test X axis ────────────────────────────
document.getElementById('btn-chk-testx').addEventListener('click', async () => {
  if (!serialPort) return;
  const btn  = document.getElementById('btn-chk-testx');
  btn.disabled = true;
  setChkBusy('testX');
  const step = parseInt(document.getElementById('jog-step').value) || 10;
  const feed = parseInt(document.getElementById('jog-feed').value) || 3000;
  termLog(`Testing X axis \u00b1${step} mm @ F${feed}`, 'sys');
  try {
    await sendCmd(`$J=G91 G21 X${step} F${feed}`);
    await sendCmd(`$J=G91 G21 X${-step} F${feed}`);
    const ok = confirm(`X axis test complete.\n\nDid the machine move ${step} mm in X+ direction then return?\n\nClick OK to mark test passed, Cancel to retry.`);
    setChk('testX', ok);
    termLog('X axis test ' + (ok ? 'PASSED' : 'failed — retry'), ok ? 'sys' : 'err');
  } catch (err) {
    setChk('testX', false);
    termLog('X test error: ' + err.message, 'err');
  } finally {
    btn.disabled = !serialPort;
  }
});

// ── Checklist action: Test Y axis ────────────────────────────
document.getElementById('btn-chk-testy').addEventListener('click', async () => {
  if (!serialPort) return;
  const btn  = document.getElementById('btn-chk-testy');
  btn.disabled = true;
  setChkBusy('testY');
  const step = parseInt(document.getElementById('jog-step').value) || 10;
  const feed = parseInt(document.getElementById('jog-feed').value) || 3000;
  termLog(`Testing Y axis \u00b1${step} mm @ F${feed}`, 'sys');
  try {
    await sendCmd(`$J=G91 G21 Y${step} F${feed}`);
    await sendCmd(`$J=G91 G21 Y${-step} F${feed}`);
    const ok = confirm(`Y axis test complete.\n\nDid the machine move ${step} mm in Y+ direction then return?\n\nClick OK to mark test passed, Cancel to retry.`);
    setChk('testY', ok);
    termLog('Y axis test ' + (ok ? 'PASSED' : 'failed — retry'), ok ? 'sys' : 'err');
  } catch (err) {
    setChk('testY', false);
    termLog('Y test error: ' + err.message, 'err');
  } finally {
    btn.disabled = !serialPort;
  }
});

// ── Checklist action: Test bead drop ─────────────────────────
document.getElementById('btn-chk-testbead').addEventListener('click', async () => {
  if (!serialPort) return;
  const btn    = document.getElementById('btn-chk-testbead');
  btn.disabled = true;
  setChkBusy('testBead');
  const dwellMs   = Math.max(10, parseInt(dwellInput.value) || 300);
  const blackSide = blackBeadSideInput.value;
  const whiteSide = whiteBeadSideInput.value;
  const S_BLACK   = blackSide === 'left' ? S_LEFT : S_RIGHT;
  const S_WHITE   = whiteSide === 'left' ? S_LEFT : S_RIGHT;
  const originX   = parseFloat(originXInput.value) || 0;
  const originY   = parseFloat(originYInput.value) || 0;
  const slot1X    = (originX + beadSpacingMm * 0.5).toFixed(2);
  const slot1Y    = (originY + beadSpacingMm * 0.5).toFixed(2);
  const slot2X    = (originX + beadSpacingMm * 1.5).toFixed(2);
  const slot2Y    = slot1Y;
  const feedRate  = Math.max(100, parseInt(moveSpeedInput.value) || 800);
  termLog(`Testing servo bead drop — dwell ${dwellMs} ms, speed F${feedRate}`, 'sys');
  try {
    termLog(`Moving to slot 1 (X${slot1X} Y${slot1Y}) → BLACK bead`, 'sys');
    await sendCmd(`G1 X${slot1X} Y${slot1Y} F${feedRate}`);
    await sendCmd(`G4 P0`);
    await sendCmd(`M3 S${S_BLACK}`);
    await sendCmd(`G4 P${(dwellMs/1000).toFixed(3)}`);
    await sendCmd(`M3 S${S_REST}`);
    const blackOk = confirm(`BLACK bead drop test.\n\nSlot 1 — ${blackSide.toUpperCase()} side (M3 S${S_BLACK}).\n\nDid a BLACK bead drop?\n\nOK = yes, Cancel = no/retry`);
    if (!blackOk) { setChk('testBead', false); termLog('Black bead test failed — retry', 'err'); return; }

    termLog(`Moving to slot 2 (X${slot2X} Y${slot2Y}) → WHITE bead`, 'sys');
    await sendCmd(`G1 X${slot2X} Y${slot2Y} F${feedRate}`);
    await sendCmd(`G4 P0`);
    await sendCmd(`M3 S${S_WHITE}`);
    await sendCmd(`G4 P${(dwellMs/1000).toFixed(3)}`);
    await sendCmd(`M3 S${S_REST}`);
    const whiteOk = confirm(`WHITE bead drop test.\n\nSlot 2 — ${whiteSide.toUpperCase()} side (M3 S${S_WHITE}).\n\nDid a WHITE bead drop?\n\nOK = yes, Cancel = no/retry`);
    const ok = blackOk && whiteOk;
    setChk('testBead', ok);
    termLog('Bead drop test ' + (ok ? 'PASSED (both colours)' : 'failed — retry'), ok ? 'sys' : 'err');
  } catch (err) {
    setChk('testBead', false);
    termLog('Bead test error: ' + err.message, 'err');
  } finally {
    btn.disabled = !serialPort;
  }
});

// ── Checklist: Skip bead drop test ───────────────────────────
document.getElementById('btn-chk-testbead-skip').addEventListener('click', () => {
  setChk('testBead', true);
  termLog('Bead drop test skipped', 'sys');
});

// ── Jog controls ──────────────────────────────────────────────
function doJog(axis, dir) {
  if (!serialPort || jobRunning) return;
  const step = parseInt(document.getElementById('jog-step').value) || 10;
  const feed = parseInt(document.getElementById('jog-feed').value) || 3000;
  sendCmd(`$J=G91 G21 ${axis}${dir > 0 ? step : -step} F${feed}`).catch(() => {});
}

document.getElementById('jog-xp').addEventListener('click', () => doJog('X',  1));
document.getElementById('jog-xm').addEventListener('click', () => doJog('X', -1));
document.getElementById('jog-yp').addEventListener('click', () => doJog('Y',  1));
document.getElementById('jog-ym').addEventListener('click', () => doJog('Y', -1));
document.getElementById('jog-center').addEventListener('click', () => {
  if (!serialPort || jobRunning) return;
  const ox = parseFloat(originXInput.value) || 0;
  const oy = parseFloat(originYInput.value) || 0;
  sendCmd(`G0 X${ox} Y${oy} F3000`).catch(() => {});
});

// ── Job controls ──────────────────────────────────────────────
mpRunBtn.addEventListener('click', () => {
  if (!serialPort) return;

  // Resume from pause
  if (jobPaused) {
    jobPaused  = false;
    jobRunning = true;
    termLog('Job resumed', 'sys');
    updateJobButtons();
    sendNextJobLine();
    return;
  }

  if (jobRunning) return;
  if (!gridReady) { alert('Apply grid settings and design a pattern first.'); return; }

  // Warn if checklist not complete
  if (!Object.values(CHK).every(Boolean)) {
    if (!confirm('Pre-run checklist is not fully complete.\n\nProceed anyway?')) return;
  }

  jobLines     = buildGcodeLines();
  jobIndex     = 0;
  jobRunning   = true;
  jobPaused    = false;
  jobStartTime = Date.now();
  if (jobTimer) clearInterval(jobTimer);
  jobTimer = setInterval(updateTimeDisplay, 1000);
  termLog(`Job started — ${jobLines.length} total lines  (est. ${fmtTime(estimateJobMs())})`, 'sys');
  updateJobButtons();
  updateTimeDisplay();
  sendNextJobLine();
});

mpPauseBtn.addEventListener('click', () => {
  if (!jobRunning) return;
  jobPaused = true;
  termLog('Job will pause after current line completes', 'sys');
  updateJobButtons();
});

mpStopBtn.addEventListener('click', () => {
  if (!jobRunning && !jobPaused) return;
  if (jobTimer) { clearInterval(jobTimer); jobTimer = null; }
  jobRunning = false;
  jobPaused  = false;
  jobLines   = [];
  jobIndex   = 0;
  sendRaw('!');
  setTimeout(() => { if (serialWriter) sendRaw('\x18'); }, 250);
  termLog('Job stopped — feed hold + soft reset sent', 'err');
  updateJobButtons();
  updateTimeDisplay();
});

// ── Job line sender (called on each 'ok' when running) ────────
function sendNextJobLine() {
  if (!jobRunning || jobPaused || !serialWriter) return;

  // Skip blank lines and pure comment lines
  while (jobIndex < jobLines.length) {
    const stripped = jobLines[jobIndex].split(';')[0].trim();
    if (stripped.length > 0) break;
    jobIndex++;
  }

  if (jobIndex >= jobLines.length) {
    jobRunning = false;
    if (jobTimer) { clearInterval(jobTimer); jobTimer = null; }
    const elapsed = jobStartTime ? fmtTime(Date.now() - jobStartTime) : '—';
    termLog(`Job complete! Total time: ${elapsed}`, 'sys');
    updateJobButtons();
    updateTimeDisplay();
    return;
  }

  const raw = jobLines[jobIndex].split(';')[0].trim();
  jobIndex++;
  sendRaw(raw);
  updateJobInfo();
}

// ── Job UI helpers ────────────────────────────────────────────
function updateJobButtons() {
  const canRun   = serialPort && gridReady;
  const running  = jobRunning && !jobPaused;

  mpRunBtn.disabled   = !(canRun && (!jobRunning || jobPaused));
  mpRunBtn.textContent = jobPaused ? '\u25b6 Resume' : '\u25b6 Run';
  mpPauseBtn.disabled  = !running;
  mpStopBtn.disabled   = !jobRunning && !jobPaused;
  const hint = document.getElementById('run-hint');
  if (hint) hint.style.display = (serialPort && !gridReady) ? 'block' : 'none';

  // Disable jog + checklist buttons while job is active
  const lockDuringJob = jobRunning || jobPaused;
  ['jog-yp','jog-ym','jog-xp','jog-xm','jog-center'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !serialPort || lockDuringJob;
  });
  ['btn-chk-home','btn-chk-origin','btn-chk-testx','btn-chk-testy','btn-chk-testbead'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !serialPort || lockDuringJob;
  });

  updateJobInfo();
}

function updateJobInfo() {
  if (!gridReady) {
    mpJobInfo.textContent = 'Apply grid settings first';
    mpProgFill.style.width = '0%';
    mpProgText.textContent = '—';
    return;
  }
  if (jobRunning || jobPaused) {
    const total = jobLines.length;
    const pct   = total > 0 ? Math.round(jobIndex / total * 100) : 0;
    mpProgFill.style.width = pct + '%';
    mpProgText.textContent = `Line ${jobIndex} / ${total}  (${pct}%)`;
    mpJobInfo.textContent  = jobPaused ? 'Paused' : 'Running\u2026';
  } else {
    const done = jobIndex > 0 && jobIndex >= jobLines.length;
    mpProgFill.style.width = done ? '100%' : '0%';
    mpProgText.textContent = done ? 'Complete \u2714' : '—';
    mpJobInfo.textContent  = `${cols}\u00d7${rows} grid \u2014 ${(cols * rows).toLocaleString()} beads`;
  }
}

// Refresh job info when grid is (re-)applied
document.getElementById('btn-apply').addEventListener('click', () => {
  setTimeout(updateJobInfo, 0);
});
