import { estimate, UNIT_SYSTEMS } from './estimator.js';

const STORAGE_KEY = 'wpe:v1';
const FT_PER_M = 3.28084;
const LENGTH_FIELDS = ['length', 'width', 'height', 'doorWidth', 'doorHeight', 'windowWidth', 'windowHeight'];
const $ = (sel) => document.querySelector(sel);

const defaultState = () => ({
  system: 'metric',
  coats: 2,
  coverage: UNIT_SYSTEMS.metric.defaultCoverage,
  wastePercent: 10,
  rooms: [{ name: 'Living room', length: 5, width: 4, height: 2.5, doors: 1, windows: 2, includeCeiling: false }],
});

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.rooms)) return saved;
  } catch { /* storage unavailable */ }
  return defaultState();
}

let state = load();

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

const fmt = (n, d = 2) => Number(n.toFixed(d)).toLocaleString(undefined, { maximumFractionDigits: d });

function canLabel(size, system) {
  if (system === 'imperial') {
    if (size === 0.25) return 'quart';
    if (size === 1) return '1 gal can';
    return `${size} gal bucket`;
  }
  return `${size} L tin`;
}

function renderUnits() {
  const u = UNIT_SYSTEMS[state.system];
  document.querySelectorAll('[data-unit="length"]').forEach((el) => (el.textContent = u.length));
  document.querySelectorAll('[data-unit="coverage"]').forEach((el) => (el.textContent = `${u.area}/${u.volume}`));
  document.querySelectorAll('[data-field="doorWidth"]').forEach((el) => (el.placeholder = u.door.width));
  document.querySelectorAll('[data-field="doorHeight"]').forEach((el) => (el.placeholder = u.door.height));
  document.querySelectorAll('[data-field="windowWidth"]').forEach((el) => (el.placeholder = u.window.width));
  document.querySelectorAll('[data-field="windowHeight"]').forEach((el) => (el.placeholder = u.window.height));
}

function renderRooms() {
  const container = $('#rooms');
  container.innerHTML = '';
  const tpl = $('#room-template');
  state.rooms.forEach((room, i) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelectorAll('[data-field]').forEach((input) => {
      const key = input.dataset.field;
      if (input.type === 'checkbox') input.checked = !!room[key];
      else input.value = room[key] ?? '';
      input.addEventListener('input', () => {
        room[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? (input.value === '' ? '' : Number(input.value)) : input.value;
        update();
      });
    });
    node.querySelector('.remove').addEventListener('click', () => {
      state.rooms.splice(i, 1);
      renderRooms();
      update();
    });
    container.appendChild(node);
  });
  renderUnits();
}

function renderResult() {
  const r = estimate(state);
  const u = r.units;
  const el = $('#result');
  if (r.area <= 0) {
    el.innerHTML = '<p class="empty">Add a room with length, width and height to see your estimate.</p>';
    return;
  }
  const cans = r.purchase.cans.map((c) => `<li><strong>${c.count} ×</strong> ${canLabel(c.size, r.system)}</li>`).join('');
  const rows = r.perRoom
    .map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${fmt(p.total, 1)} ${u.area}</td><td>${fmt(p.paint)} ${u.volume}</td></tr>`)
    .join('');
  el.innerHTML = `
    <div class="headline">
      <div><span class="big">${fmt(r.paint, 1)}</span> <span>${u.volume} of paint</span></div>
      <p>${fmt(r.area, 1)} ${u.area} paintable × ${r.coats} coat${r.coats > 1 ? 's' : ''} ÷ ${fmt(r.coverage)} ${u.area}/${u.volume}, plus ${fmt(r.wastePercent, 0)}% margin</p>
    </div>
    <h3>What to buy</h3>
    <ul class="cans">${cans}</ul>
    <p class="hint">That is ${fmt(r.purchase.total)} ${u.volume} in total, ${fmt(r.purchase.total - r.paint)} ${u.volume} more than needed.</p>
    <h3>By room</h3>
    <table><thead><tr><th>Room</th><th>Area</th><th>Paint (no margin)</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function update() {
  save();
  renderResult();
}

function bindSettings() {
  const system = $('#system');
  const coats = $('#coats');
  const coverage = $('#coverage');
  const waste = $('#waste');
  system.value = state.system;
  coats.value = state.coats;
  coverage.value = state.coverage;
  waste.value = state.wastePercent;

  system.addEventListener('change', () => {
    // Convert existing dimensions so switching units keeps the same room.
    const factor = system.value === 'imperial' ? FT_PER_M : 1 / FT_PER_M;
    state.rooms.forEach((room) => {
      LENGTH_FIELDS.forEach((key) => {
        if (room[key] !== '' && room[key] != null) room[key] = Math.round(room[key] * factor * 100) / 100;
      });
    });
    renderRooms();
    state.system = system.value;
    state.coverage = UNIT_SYSTEMS[state.system].defaultCoverage;
    coverage.value = state.coverage;
    renderUnits();
    update();
  });
  coats.addEventListener('input', () => { state.coats = Number(coats.value); update(); });
  coverage.addEventListener('input', () => { state.coverage = Number(coverage.value); update(); });
  waste.addEventListener('input', () => { state.wastePercent = Number(waste.value); update(); });
  $('#add-room').addEventListener('click', () => {
    state.rooms.push({ name: `Room ${state.rooms.length + 1}`, length: '', width: '', height: state.rooms[0]?.height ?? '', doors: 1, windows: 1 });
    renderRooms();
    update();
  });
}

bindSettings();
renderRooms();
update();
