import { estimate, UNIT_SYSTEMS, SURFACES } from './estimator.js';

const STORAGE_KEY = 'wpe:v1';
const FT_PER_M = 3.28084;
const LENGTH_FIELDS = ['length', 'width', 'height', 'doorWidth', 'doorHeight', 'windowWidth', 'windowHeight'];
const $ = (sel) => document.querySelector(sel);

const defaultState = () => ({
  system: 'metric',
  coats: 2,
  coverage: UNIT_SYSTEMS.metric.defaultCoverage,
  wastePercent: 10,
  surface: 'smooth',
  primer: false,
  primerCoverage: UNIT_SYSTEMS.metric.primerCoverage,
  rooms: [{ name: 'Living room', length: 5, width: 4, height: 2.5, doors: 1, windows: 2, includeCeiling: false }],
});

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.rooms)) return { ...defaultState(), ...saved };
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
  document.querySelectorAll('[data-unit="area"]').forEach((el) => (el.textContent = u.area));
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
        if (key === 'mode' && room.mode === 'walls' && !(room.walls && room.walls.length)) {
          room.walls = wallsFromRectangle(room);
          renderWalls(node, room);
        }
        syncRoomClasses(node, room);
        update();
      });
    });
    syncRoomClasses(node, room);
    renderWalls(node, room);
    node.querySelector('.add-wall').addEventListener('click', () => {
      room.walls = room.walls || [];
      const last = room.walls[room.walls.length - 1];
      room.walls.push({ width: '', height: last ? last.height : room.height || '' });
      renderWalls(node, room);
      update();
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

// Start custom walls from the rectangle the user already typed, so nothing is lost.
function wallsFromRectangle(room) {
  const h = room.height || '';
  return [room.length, room.width, room.length, room.width].map((w) => ({ width: w || '', height: h }));
}

function syncRoomClasses(node, room) {
  node.dataset.mode = room.mode === 'walls' ? 'walls' : 'rect';
  node.classList.toggle('has-ceiling', !!room.includeCeiling);
}

function renderWalls(node, room) {
  const list = node.querySelector('.wall-list');
  list.innerHTML = '';
  const tpl = $('#wall-template');
  (room.walls || []).forEach((wall, i) => {
    const li = tpl.content.firstElementChild.cloneNode(true);
    li.querySelectorAll('[data-wall]').forEach((input) => {
      const key = input.dataset.wall;
      input.value = wall[key] ?? '';
      input.addEventListener('input', () => {
        wall[key] = input.value === '' ? '' : Number(input.value);
        update();
      });
    });
    li.querySelector('.remove-wall').addEventListener('click', () => {
      room.walls.splice(i, 1);
      renderWalls(node, room);
      update();
    });
    list.appendChild(li);
  });
  renderUnits();
}

function renderResult() {
  const r = estimate(state);
  const u = r.units;
  const el = $('#result');
  if (r.area <= 0) {
    el.innerHTML = '<p class="empty">Add a room with its measurements to see your estimate.</p>';
    return;
  }
  const cans = r.purchase.cans.map((c) => `<li><strong>${c.count} ×</strong> ${canLabel(c.size, r.system)}</li>`).join('');
  const rows = r.perRoom
    .map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${fmt(p.total, 1)} ${u.area}</td><td>${fmt(p.paint)} ${u.volume}</td></tr>`)
    .join('');
  el.innerHTML = `
    <div class="headline">
      <div><span class="big">${fmt(r.paint, 1)}</span> <span>${u.volume} of paint</span></div>
      <p>${fmt(r.area, 1)} ${u.area} paintable × ${r.coats} coat${r.coats > 1 ? 's' : ''} ÷ ${fmt(r.coverage)} ${u.area}/${u.volume}${r.surfaceFactor !== 1 ? `, +${fmt((r.surfaceFactor - 1) * 100, 0)}% for the surface` : ''}, plus ${fmt(r.wastePercent, 0)}% margin</p>
    </div>
    <h3>Paint to buy</h3>
    <ul class="cans">${cans}</ul>
    <p class="hint">That is ${fmt(r.purchase.total)} ${u.volume} in total, ${fmt(r.purchase.total - r.paint)} ${u.volume} more than needed.</p>
    ${r.primer ? primerHtml(r) : ''}
    <h3>By room</h3>
    <table><thead><tr><th>Room</th><th>Area</th><th>Paint (no margin)</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function primerHtml(r) {
  const u = r.units;
  const cans = r.primer.purchase.cans.map((c) => `<li><strong>${c.count} ×</strong> ${canLabel(c.size, r.system)}</li>`).join('');
  return `
    <div class="primer-block">
      <h3>Primer: ${fmt(r.primer.paint, 1)} ${u.volume}</h3>
      <p class="hint">One coat at ${fmt(r.primer.coverage)} ${u.area}/${u.volume}, plus the same margin.</p>
      <ul class="cans">${cans}</ul>
    </div>`;
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

  const surface = $('#surface');
  const primer = $('#primer');
  const primerCoverage = $('#primer-coverage');
  const settingsPanel = surface.closest('.panel');
  surface.innerHTML = Object.entries(SURFACES)
    .map(([key, s]) => `<option value="${key}">${s.label}</option>`)
    .join('');
  surface.value = state.surface;
  primer.checked = !!state.primer;
  primerCoverage.value = state.primerCoverage;
  settingsPanel.classList.toggle('with-primer', !!state.primer);
  surface.addEventListener('change', () => { state.surface = surface.value; update(); });
  primer.addEventListener('change', () => {
    state.primer = primer.checked;
    settingsPanel.classList.toggle('with-primer', state.primer);
    update();
  });
  primerCoverage.addEventListener('input', () => { state.primerCoverage = Number(primerCoverage.value); update(); });

  system.addEventListener('change', () => {
    // Convert existing dimensions so switching units keeps the same room.
    const factor = system.value === 'imperial' ? FT_PER_M : 1 / FT_PER_M;
    state.rooms.forEach((room) => {
      const convert = (v, f) => (v === '' || v == null ? v : Math.round(v * f * 100) / 100);
      LENGTH_FIELDS.forEach((key) => { room[key] = convert(room[key], factor); });
      room.ceilingArea = convert(room.ceilingArea, factor * factor);
      (room.walls || []).forEach((w) => {
        w.width = convert(w.width, factor);
        w.height = convert(w.height, factor);
      });
    });
    renderRooms();
    state.system = system.value;
    state.coverage = UNIT_SYSTEMS[state.system].defaultCoverage;
    coverage.value = state.coverage;
    state.primerCoverage = UNIT_SYSTEMS[state.system].primerCoverage;
    primerCoverage.value = state.primerCoverage;
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
