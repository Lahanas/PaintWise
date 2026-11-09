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
  currency: '$',
  labourRate: '',
  taxPercent: '',
  prices: { metric: { paint: {}, primer: {} }, imperial: { paint: {}, primer: {} } },
  quote: { business: '', client: '', address: '', notes: '' },
  rooms: [{ name: 'Living room', length: 5, width: 4, height: 2.5, doors: 1, windows: 2, includeCeiling: false }],
});

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.rooms)) {
      const base = defaultState();
      return { ...base, ...saved, prices: { ...base.prices, ...saved.prices }, quote: { ...base.quote, ...saved.quote } };
    }
  } catch { /* storage unavailable */ }
  return defaultState();
}

let state = load();

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

const SQFT_PER_SQM = 10.7639;

const money = (n) => {
  const cur = (state.currency || '').trim();
  const value = Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cur ? `${cur}${/^[A-Za-z]/.test(cur) ? ' ' : ''}${value}` : value;
};

// Inputs to the estimator, including the prices for the current unit system.
function estimateInput() {
  const p = state.prices[state.system] || { paint: {}, primer: {} };
  return { ...state, paintPrices: p.paint, primerPrices: p.primer };
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
      else if (input.tagName === 'SELECT') input.value = room[key] || input.options[0].value;
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
  const r = estimate(estimateInput());
  renderQuote(r);
  const u = r.units;
  const el = $('#result');
  if (r.area <= 0) {
    el.innerHTML = '<p class="empty">Add a room with its measurements to see your estimate.</p>';
    return;
  }
  const cans = canItems(r.purchase.cans, r.cost.paint, r.system);
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
    ${r.cost.hasAny ? costHtml(r) : ''}
    <h3>By room</h3>
    <table><thead><tr><th>Room</th><th>Area</th><th>Paint (no margin)</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function primerHtml(r) {
  const u = r.units;
  const cans = canItems(r.primer.purchase.cans, r.cost.primer, r.system);
  return `
    <div class="primer-block">
      <h3>Primer: ${fmt(r.primer.paint, 1)} ${u.volume}</h3>
      <p class="hint">One coat at ${fmt(r.primer.coverage)} ${u.area}/${u.volume}, plus the same margin.</p>
      <ul class="cans">${cans}</ul>
    </div>`;
}

function canItems(cans, cost, system) {
  return cans
    .map((c, i) => {
      const line = cost && cost.lines[i];
      const price = line && line.price !== null ? ` <span class="price-tag">${money(line.total)}</span>` : '';
      return `<li><strong>${c.count} ×</strong> ${canLabel(c.size, system)}${price}</li>`;
    })
    .join('');
}

function costHtml(r) {
  const c = r.cost;
  const rows = [];
  if (c.paint.total) rows.push(['Paint', c.paint.total, !c.paint.complete]);
  if (c.primer && c.primer.total) rows.push(['Primer', c.primer.total, !c.primer.complete]);
  if (c.labour) rows.push([`Labour (${fmt(r.area, 1)} ${r.units.area})`, c.labour]);
  const body = rows
    .map(([label, value, partial]) => `<tr><td>${label}${partial ? ' <span class="price-tag">(some cans have no price)</span>' : ''}</td><td>${money(value)}</td></tr>`)
    .join('');
  const tax = c.tax ? `<tr class="muted"><td>Subtotal</td><td>${money(c.subtotal)}</td></tr><tr class="muted"><td>Tax (${fmt(Number(state.taxPercent), 2)}%)</td><td>${money(c.tax)}</td></tr>` : '';
  return `
    <h3>Cost</h3>
    <table class="cost-table"><tbody>${body}${tax}<tr class="total"><td>Total</td><td>${money(c.total)}</td></tr></tbody></table>`;
}

function renderQuote(r) {
  const q = state.quote || {};
  const u = r.units;
  const today = new Date();
  const dateStr = today.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const number = `Q-${today.toISOString().slice(0, 10).replace(/-/g, '')}`;
  const roomRows = r.perRoom
    .map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${fmt(p.walls, 1)} ${u.area}</td><td>${p.ceiling ? `${fmt(p.ceiling, 1)} ${u.area}` : '–'}</td><td>${fmt(p.total, 1)} ${u.area}</td></tr>`)
    .join('');
  const materialRows = (label, cans, cost) =>
    cans
      .map((c, i) => {
        const line = cost.lines[i];
        return `<tr><td>${label}: ${canLabel(c.size, r.system)}</td><td>${c.count}</td><td>${line.price !== null ? money(line.price) : '–'}</td><td>${line.price !== null ? money(line.total) : '–'}</td></tr>`;
      })
      .join('');
  const materials =
    materialRows('Paint', r.purchase.cans, r.cost.paint) +
    (r.primer ? materialRows('Primer', r.primer.purchase.cans, r.cost.primer) : '') +
    (r.cost.labour ? `<tr><td>Labour, ${fmt(r.area, 1)} ${u.area} (${r.coats} coat${r.coats > 1 ? "s" : ""}${r.primer ? " + primer" : ""})</td><td></td><td>${money(Number(state.labourRate))} / ${u.area}</td><td>${money(r.cost.labour)}</td></tr>` : '');
  const totals = r.cost.hasAny
    ? `<table class="q-totals"><tbody>
        ${r.cost.tax ? `<tr><td>Subtotal</td><td>${money(r.cost.subtotal)}</td></tr><tr><td>Tax (${fmt(Number(state.taxPercent), 2)}%)</td><td>${money(r.cost.tax)}</td></tr>` : ''}
        <tr class="total"><td>Total</td><td>${money(r.cost.total)}</td></tr>
      </tbody></table>`
    : '';
  const surface = r.surfaceFactor !== 1 ? `, ${escapeHtml(SURFACES[r.surface].label.toLowerCase())} walls` : '';
  $('#quote').innerHTML = `
    <div class="q-head">
      <div>
        <h1>Painting quote</h1>
        ${q.business ? `<div>${escapeHtml(q.business)}</div>` : ''}
      </div>
      <div class="q-meta"><div>${number}</div><div>${dateStr}</div></div>
    </div>
    <div class="q-parties">
      <div><div class="q-label">Client</div><div>${escapeHtml(q.client || '—')}</div></div>
      <div><div class="q-label">Job address</div><div>${escapeHtml(q.address || '—')}</div></div>
    </div>
    <h2>Areas to paint</h2>
    <table><thead><tr><th>Room</th><th>Walls</th><th>Ceiling</th><th>Total</th></tr></thead>
      <tbody>${roomRows}<tr><td><strong>Total</strong></td><td></td><td></td><td><strong>${fmt(r.area, 1)} ${u.area}</strong></td></tr></tbody></table>
    <p>${r.coats} coat${r.coats > 1 ? 's' : ''} at ${fmt(r.coverage)} ${u.area}/${u.volume}${surface}, ${fmt(r.wastePercent, 0)}% margin. Paint needed: <strong>${fmt(r.paint, 1)} ${u.volume}</strong>${r.primer ? `, primer: <strong>${fmt(r.primer.paint, 1)} ${u.volume}</strong>` : ''}.</p>
    <h2>Materials and labour</h2>
    <table><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${materials}</tbody></table>
    ${totals}
    ${q.notes ? `<h2>Notes</h2><p class="q-notes">${escapeHtml(q.notes)}</p>` : ''}
    <p class="q-foot">This quote is an estimate based on the measurements provided. Final quantities may vary with wall condition and paint brand.</p>`;
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
    $('#pricing').classList.toggle('with-primer', state.primer);
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
    if (Number(state.labourRate) > 0) {
      const perArea = state.system === 'imperial' ? 1 / SQFT_PER_SQM : SQFT_PER_SQM;
      state.labourRate = Math.round(state.labourRate * perArea * 100) / 100;
    }
    fillPricing();
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

// ---------- prices and quote ----------
function renderPriceInputs(containerId, kind) {
  const box = $(containerId);
  const u = UNIT_SYSTEMS[state.system];
  const prices = state.prices[state.system][kind];
  box.innerHTML = '';
  u.cans.forEach((size) => {
    const label = document.createElement('label');
    label.innerHTML = `<span>${canLabel(size, state.system)}</span>`;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.01';
    input.placeholder = '0.00';
    input.value = prices[size] ?? '';
    input.addEventListener('input', () => {
      if (input.value === '') delete prices[size];
      else prices[size] = Number(input.value);
      update();
    });
    label.appendChild(input);
    box.appendChild(label);
  });
}

function fillPricing() {
  $('#currency').value = state.currency;
  $('#labour-rate').value = state.labourRate;
  $('#tax').value = state.taxPercent;
  $('#labour-unit').textContent = `per ${UNIT_SYSTEMS[state.system].area}`;
  ['business', 'client', 'address', 'notes'].forEach((k) => { $(`#q-${k}`).value = state.quote[k] || ''; });
  $('#pricing').classList.toggle('with-primer', !!state.primer);
  renderPriceInputs('#paint-prices', 'paint');
  renderPriceInputs('#primer-prices', 'primer');
}

function bindPricing() {
  $('#currency').addEventListener('input', (e) => { state.currency = e.target.value; update(); });
  $('#labour-rate').addEventListener('input', (e) => { state.labourRate = e.target.value === '' ? '' : Number(e.target.value); update(); });
  $('#tax').addEventListener('input', (e) => { state.taxPercent = e.target.value === '' ? '' : Number(e.target.value); update(); });
  ['business', 'client', 'address', 'notes'].forEach((k) => {
    $(`#q-${k}`).addEventListener('input', (e) => { state.quote[k] = e.target.value; update(); });
  });
  $('#print-quote').addEventListener('click', () => {
    renderResult();
    window.print();
  });
  fillPricing();
}

bindSettings();
bindPricing();
renderRooms();
update();
