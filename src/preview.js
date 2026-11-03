import { floodSelect, recolor } from './recolor.js';

const $ = (sel) => document.querySelector(sel);
const MAX_SIDE = 1200; // downscale big phone photos so tapping stays fast

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
const buttons = {
  undo: $('#undo-tap'),
  clear: $('#clear-taps'),
  compare: $('#hold-original'),
  save: $('#save-image'),
};

let original = null; // ImageData of the photo
let taps = []; // { x, y, tolerance }
let color = SWATCHES[3][1];

// ---------- tabs ----------
function showTab() {
  const tab = location.hash === '#preview' ? 'preview' : 'estimate';
  $('#tab-estimate').hidden = tab !== 'estimate';
  $('#tab-preview').hidden = tab !== 'preview';
  document.querySelectorAll('.tab').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', showTab);
showTab();

// ---------- photo ----------
async function loadPhoto(file) {
  if (!file) return;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  const source = bitmap || (await loadViaImg(file));
  const scale = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  original = ctx.getImageData(0, 0, canvas.width, canvas.height);
  taps = [];
  canvas.classList.add('ready');
  $('#stage-empty').hidden = true;
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
function buildMask() {
  const mask = new Uint8Array(original.width * original.height);
  taps.forEach((t) => floodSelect(original, t.x, t.y, t.tolerance, mask));
  return mask;
}

function render(showOriginal = false) {
  if (!original) return;
  if (showOriginal || !taps.length) {
    ctx.putImageData(original, 0, 0);
  } else {
    const out = ctx.createImageData(original.width, original.height);
    recolor(original, buildMask(), color, out);
    ctx.putImageData(out, 0, 0);
  }
  const hasTaps = taps.length > 0;
  buttons.undo.disabled = !hasTaps;
  buttons.clear.disabled = !hasTaps;
  buttons.compare.disabled = !hasTaps;
  buttons.save.disabled = !original;
}

canvas.addEventListener('click', (e) => {
  if (!original) return;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
  taps.push({ x, y, tolerance: Number($('#tolerance').value) });
  render();
});

buttons.undo.addEventListener('click', () => { taps.pop(); render(); });
buttons.clear.addEventListener('click', () => { taps = []; render(); });

// Press and hold to see the original photo, release to see the new color.
['pointerdown'].forEach((ev) => buttons.compare.addEventListener(ev, () => render(true)));
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => buttons.compare.addEventListener(ev, () => render()));

buttons.save.addEventListener('click', () => {
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
