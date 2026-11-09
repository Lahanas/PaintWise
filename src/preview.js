import { floodSelect, recolor } from './recolor.js';

const $ = (sel) => document.querySelector(sel);
const MAX_SIDE = 1200; // downscale big phone photos so tapping stays fast
const LIVE_SIDE = 480; // live video is repainted every frame, so it runs smaller

const SWATCHES = [
  ['Warm white', '#f1ece1'],
  ['Soft grey', '#b9b8b2'],
  ['Greige', '#a89f91'],
  ['Sage green', '#8fa98b'],
  ['Sky blue', '#9cbcd6'],
  ['Navy', '#2c3e5c'],
  ['Terracotta', '#c0694a'],
  ['Mustard', '#d2a23c'],
];

const canvas = $('#preview-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const video = $('#live-video');
const buttons = {
  undo: $('#undo-tap'),
  clear: $('#clear-taps'),
  compare: $('#hold-original'),
  save: $('#save-image'),
  liveStart: $('#live-start'),
  liveFreeze: $('#live-freeze'),
  liveStop: $('#live-stop'),
};

let original = null; // ImageData of the photo (or of the latest live frame)
let taps = []; // { rx, ry, tolerance } with rx/ry from 0 to 1, so they work at any size
let color = SWATCHES[3][1];
let showingOriginal = false;
let stream = null; // live camera
let frameRequest = 0;

function setStatus(text, isError = false) {
  const el = $('#preview-status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

// ---------- tabs ----------
function showTab() {
  const tab = location.hash === '#preview' ? 'preview' : 'estimate';
  $('#tab-estimate').hidden = tab !== 'estimate';
  $('#tab-preview').hidden = tab !== 'preview';
  document.querySelectorAll('.tab').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (tab !== 'preview') stopLive();
}
window.addEventListener('hashchange', showTab);
showTab();

// ---------- photo ----------
function showCanvas() {
  canvas.classList.add('ready');
  $('#stage-empty').hidden = true;
}

function drawSource(source, maxSide) {
  const w = source.videoWidth || source.width;
  const h = source.videoHeight || source.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const width = Math.round(w * scale);
  const height = Math.round(h * scale);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

async function loadPhoto(file) {
  if (!file) return;
  stopLive();
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  const source = bitmap || (await loadViaImg(file));
  original = drawSource(source, MAX_SIDE);
  taps = [];
  showCanvas();
  setStatus('');
  render();
}

function loadViaImg(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

['#photo-camera', '#photo-upload'].forEach((id) => {
  $(id).addEventListener('change', (e) => {
    loadPhoto(e.target.files[0]);
    e.target.value = '';
  });
});

// ---------- painting ----------
function buildMask(img) {
  const mask = new Uint8Array(img.width * img.height);
  taps.forEach((t) => floodSelect(img, t.rx * img.width, t.ry * img.height, t.tolerance, mask));
  return mask;
}

function paint(img) {
  if (showingOriginal || !taps.length) {
    ctx.putImageData(img, 0, 0);
  } else {
    const out = ctx.createImageData(img.width, img.height);
    recolor(img, buildMask(img), color, out);
    ctx.putImageData(out, 0, 0);
  }
}

function updateButtons() {
  const hasTaps = taps.length > 0;
  buttons.undo.disabled = !hasTaps;
  buttons.clear.disabled = !hasTaps;
  buttons.compare.disabled = !hasTaps;
  buttons.save.disabled = !original;
}

function render() {
  updateButtons();
  // While the camera is live, the next frame repaints with the new settings.
  if (!original || stream) return;
  paint(original);
}

canvas.addEventListener('click', (e) => {
  if (!original) return;
  const rect = canvas.getBoundingClientRect();
  taps.push({
    rx: (e.clientX - rect.left) / rect.width,
    ry: (e.clientY - rect.top) / rect.height,
    tolerance: Number($('#tolerance').value),
  });
  render();
});

buttons.undo.addEventListener('click', () => { taps.pop(); render(); });
buttons.clear.addEventListener('click', () => { taps = []; render(); });

// Press and hold to see the original, release to see the new color.
const setCompare = (on) => { showingOriginal = on; render(); };
buttons.compare.addEventListener('pointerdown', () => setCompare(true));
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => buttons.compare.addEventListener(ev, () => setCompare(false)));

buttons.save.addEventListener('click', () => {
  if (stream) freezeLive();
  const a = document.createElement('a');
  a.download = 'paintwise-preview.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
});

// Changing sensitivity re-applies to the last tap, so you can fine-tune it.
const tolerance = $('#tolerance');
tolerance.addEventListener('input', () => {
  $('#tolerance-value').textContent = tolerance.value;
  if (taps.length) {
    taps[taps.length - 1].tolerance = Number(tolerance.value);
    render();
  }
});

// ---------- live camera ----------
function setLiveUi(live) {
  buttons.liveStart.hidden = live;
  buttons.liveFreeze.hidden = !live;
  buttons.liveStop.hidden = !live;
  $('#live-badge').hidden = !live;
}

async function startLive() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('Live camera is not supported in this browser. Use "Take a photo" instead.', true);
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    stream = null;
    const blocked = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    setStatus(blocked
      ? 'Camera access was blocked. Allow the camera for this site in your browser settings, or use "Take a photo".'
      : 'No camera was found. Use "Upload a photo" instead.', true);
    return;
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  setLiveUi(true);
  showCanvas();
  setStatus('Point at the wall and tap it. The color follows the camera.');
  loop();
}

// One frame: grab the video, repaint the wall, draw it, repeat.
function loop() {
  if (!stream) return;
  if (video.readyState >= 2 && video.videoWidth) {
    original = drawSource(video, LIVE_SIDE);
    paint(original);
    updateButtons();
  }
  frameRequest = requestAnimationFrame(loop);
}

// Keep the current view as a sharp photo, with the same taps, and stop the camera.
function freezeLive() {
  if (!stream || !video.videoWidth) return;
  const frame = drawSource(video, MAX_SIDE);
  stopLive();
  original = frame;
  render();
  setStatus('Picture taken. You can keep tapping to fine-tune, then save it.');
}

function stopLive() {
  if (!stream) return;
  cancelAnimationFrame(frameRequest);
  stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  setLiveUi(false);
  setStatus('');
  render();
}

buttons.liveStart.addEventListener('click', startLive);
buttons.liveFreeze.addEventListener('click', freezeLive);
buttons.liveStop.addEventListener('click', stopLive);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopLive(); });

// ---------- colors ----------
const swatchBox = $('#swatches');
const picker = $('#paint-color');

function setColor(hex) {
  color = hex;
  picker.value = hex;
  swatchBox.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.color === hex)));
  render();
}

SWATCHES.forEach(([name, hex]) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch';
  b.dataset.color = hex;
  b.style.background = hex;
  b.title = name;
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-label', name);
  b.addEventListener('click', () => setColor(hex));
  swatchBox.appendChild(b);
});
picker.addEventListener('input', () => setColor(picker.value));
setColor(color);
