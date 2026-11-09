import { estimate, UNIT_SYSTEMS, SURFACES } from './estimator.js';
import { encodeProject, decodeProject, listProjects, saveProject, deleteProject } from './projects.js';
import * as api from './api.js';

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

// Fill in anything missing (older saves, shared links) with defaults.
function normalize(saved) {
  const base = defaultState();
  return { ...base, ...saved, prices: { ...base.prices, ...saved.prices }, quote: { ...base.quote, ...saved.quote } };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.rooms)) return normalize(saved);
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

function fillSettings() {
  $('#system').value = state.system;
  $('#coats').value = state.coats;
  $('#coverage').value = state.coverage;
  $('#waste').value = state.wastePercent;
  $('#surface').value = state.surface;
  $('#primer').checked = !!state.primer;
  $('#primer-coverage').value = state.primerCoverage;
  $('#surface').closest('.panel').classList.toggle('with-primer', !!state.primer);
}

// Replace the whole job (opening a saved project or a shared link) and refresh every input.
function setState(next) {
  state = normalize(next);
  fillSettings();
  fillPricing();
  renderRooms();
  update();
}

function bindSettings() {
  const system = $('#system');
  const coats = $('#coats');
  const coverage = $('#coverage');
  const waste = $('#waste');
  const surface = $('#surface');
  const primer = $('#primer');
  const primerCoverage = $('#primer-coverage');
  const settingsPanel = surface.closest('.panel');
  surface.innerHTML = Object.entries(SURFACES)
    .map(([key, s]) => `<option value="${key}">${s.label}</option>`)
    .join('');
  fillSettings();
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

// ---------- saved projects and share links ----------
// Projects are saved on this device, or in your account when you're logged in.
// Both places answer the same questions (list, open, save, delete), so the buttons don't care which.
const localStore = {
  cloud: false,
  list: async () => listProjects(),
  get: async (id) => listProjects().find((p) => p.id === id) || null,
  save: async (name, data, id) => saveProject(name, data, id),
  remove: async (id) => deleteProject(id),
};

const cloudStore = {
  cloud: true,
  list: () => api.listProjects(),
  get: async (id) => {
    const p = await api.getProject(id);
    return { id: p.id, name: p.name, updated: p.updated, state: p.data };
  },
  save: (name, data, id) => (id ? api.updateProject(id, name, data) : api.createProject(name, data)),
  remove: (id) => api.deleteProject(id),
};

let account = { available: false, user: null };
let store = localStore;
let projectCache = [];

let statusTimer;
function showStatus(text, isError = false) {
  const el = $('#project-status');
  el.textContent = text;
  el.classList.toggle('error', isError);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.textContent = ''; }, isError ? 8000 : 4000);
}

function formatDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Run a project action, showing a friendly message if the server says no.
async function attempt(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.status === 401 && store.cloud) {
      await setAccount(null);
      showStatus('You were logged out. Log in again to use your saved projects.', true);
    } else {
      showStatus(err.message || 'Something went wrong.', true);
    }
    return undefined;
  }
}

async function renderProjectList() {
  projectCache = (await attempt(() => store.list())) || [];
  const select = $('#project-list');
  const label = store.cloud ? 'My projects (in your account)…' : 'My projects (on this device)…';
  select.innerHTML = `<option value="">${label}</option>` +
    projectCache.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} · ${formatDate(p.updated)}</option>`).join('');
  select.value = projectCache.some((p) => p.id === state.projectId) ? state.projectId : '';
  $('#project-open').hidden = projectCache.length === 0;
  $('#delete-project').disabled = !state.projectId;
  renderMoveOffer();
}

// After logging in: offer to move projects saved on this device into the account.
function renderMoveOffer() {
  const local = store.cloud ? listProjects() : [];
  const btn = $('#move-projects');
  btn.hidden = local.length === 0;
  btn.textContent = `Move ${local.length} project${local.length === 1 ? '' : 's'} from this device to your account`;
}

function projectData() {
  const { projectId, projectName, ...data } = state;
  return { ...data, projectName };
}

function bindProjects() {
  const name = $('#project-name');
  name.value = state.projectName || '';
  name.addEventListener('input', () => { state.projectName = name.value; save(); });

  $('#save-project').addEventListener('click', async () => {
    const entry = await attempt(() => store.save(state.projectName, projectData(), state.projectId));
    if (!entry) return;
    state.projectId = entry.id;
    state.projectName = entry.name;
    name.value = entry.name;
    save();
    await renderProjectList();
    showStatus(store.cloud ? `Saved “${entry.name}” to your account` : `Saved “${entry.name}” on this device`);
  });

  $('#new-project').addEventListener('click', async () => {
    setState({ ...defaultState(), system: state.system, currency: state.currency, prices: state.prices, quote: { ...defaultState().quote, business: state.quote.business }, rooms: [{ name: 'Room 1', length: '', width: '', height: '', doors: 1, windows: 1 }] });
    name.value = '';
    await renderProjectList();
    showStatus('New project started. Your prices were kept.');
  });

  $('#project-list').addEventListener('change', async (e) => {
    if (!e.target.value) return;
    const p = await attempt(() => store.get(e.target.value));
    if (!p) return;
    setState({ ...p.state, projectId: p.id, projectName: p.name });
    name.value = p.name;
    await renderProjectList();
    showStatus(`Opened “${p.name}”`);
  });

  $('#delete-project').addEventListener('click', async () => {
    const p = projectCache.find((x) => x.id === state.projectId);
    if (!p || !confirm(`Delete “${p.name}”? This can't be undone.`)) return;
    if ((await attempt(() => store.remove(p.id).then(() => true))) !== true) return;
    state.projectId = undefined;
    save();
    await renderProjectList();
    showStatus(`Deleted “${p.name}”`);
  });

  $('#move-projects').addEventListener('click', async () => {
    const local = listProjects();
    let moved = 0;
    for (const p of local) {
      const ok = await attempt(() => cloudStore.save(p.name, p.state).then(() => true));
      if (!ok) break;
      deleteProject(p.id);
      moved++;
    }
    await renderProjectList();
    if (moved) showStatus(`Moved ${moved} project${moved === 1 ? '' : 's'} to your account`);
  });

  $('#share-project').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#p=${await encodeProject(projectData())}`;
    const title = state.projectName || 'PaintWise project';
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      showStatus('Link copied. Anyone with it can open a copy of this project.');
    } catch (err) {
      if (err && err.name === 'AbortError') return; // closed the share sheet
      prompt('Copy this link:', url);
    }
  });
}

// ---------- account ----------
async function setAccount(user) {
  const wasCloud = store.cloud;
  account.user = user;
  store = user ? cloudStore : localStore;
  // A project id from one place means nothing in the other, so the open job becomes unsaved.
  if (wasCloud !== store.cloud) {
    state.projectId = undefined;
    save();
  }
  renderAccount();
  await renderProjectList();
}

function renderAccount() {
  const box = $('#account');
  box.hidden = !account.available;
  $('#account-email').textContent = account.user ? account.user.email : '';
  $('#account-in').hidden = !account.user;
  $('#account-out').hidden = !!account.user;
  $('#login-hint').hidden = !account.available || !!account.user;
}

// One dialog for every account screen. Each mode says which fields show and what Submit does.
const AUTH_MODES = {
  login: {
    title: 'Log in', submit: 'Log in', fields: ['email', 'password'], passwordLabel: 'Password',
    autocomplete: 'current-password', switchTo: 'signup', switchText: 'New here? Create an account',
    run: async (f) => { const user = await api.login(f.email, f.password); return { user, status: `Welcome back, ${user.email}` }; },
  },
  signup: {
    title: 'Create your account', submit: 'Create account', fields: ['email', 'password'], passwordLabel: 'Password',
    autocomplete: 'new-password', hint: true, switchTo: 'login', switchText: 'Already have an account? Log in',
    run: async (f) => { const user = await api.signup(f.email, f.password); return { user, status: 'Account created. Your projects will now be saved to it.' }; },
  },
  forgot: {
    title: 'Reset your password', submit: 'Send me a reset link', fields: ['email'],
    intro: "Enter your account's email and we'll send you a link to choose a new password.",
    switchTo: 'login', switchText: 'Back to log in',
    run: async (f) => ({ message: await api.forgotPassword(f.email) }),
  },
  reset: {
    title: 'Choose a new password', submit: 'Save new password', fields: ['password'], passwordLabel: 'New password',
    autocomplete: 'new-password', hint: true,
    run: async (f, ctx) => { const user = await api.resetPassword(ctx.token, f.password); return { user, status: 'Password changed. You are logged in.' }; },
  },
  change: {
    title: 'Change password', submit: 'Change password', fields: ['current', 'password'], passwordLabel: 'New password',
    autocomplete: 'new-password', hint: true, intro: "You'll stay logged in here, and be logged out on your other devices.",
    run: async (f) => { const user = await api.changePassword(f.current, f.password); return { user, status: 'Password changed.' }; },
  },
};

let openAuth = () => {};

function bindAccount() {
  const dialog = $('#auth-dialog');
  const form = $('#auth-form');
  const error = $('#auth-error');
  const success = $('#auth-success');
  let mode = 'login';
  const ctx = { token: '' };

  const setMode = (next) => {
    mode = next;
    const m = AUTH_MODES[mode];
    $('#auth-title').textContent = m.title;
    $('#auth-submit').textContent = m.submit;
    $('#auth-intro').textContent = m.intro || '';
    $('#auth-intro').hidden = !m.intro;
    ['email', 'current', 'password'].forEach((f) => { $(`#row-${f}`).hidden = !m.fields.includes(f); });
    $('#auth-password-label').textContent = m.passwordLabel || 'Password';
    $('#auth-password').autocomplete = m.autocomplete || 'current-password';
    $('#auth-password-hint').hidden = !m.hint;
    $('#auth-forgot').hidden = !(mode === 'login' && account.features && account.features.passwordReset);
    $('#auth-switch').hidden = !m.switchTo;
    $('#auth-switch').textContent = m.switchText || '';
    $('#auth-submit').hidden = false;
    error.textContent = '';
    success.textContent = '';
  };

  openAuth = (next, options = {}) => {
    form.reset();
    ctx.token = options.token || '';
    setMode(next);
    if (!dialog.open) dialog.showModal();
    const first = AUTH_MODES[next].fields[0];
    $(`#auth-${first}`).focus();
  };

  $('#open-login').addEventListener('click', () => openAuth('login'));
  $('#open-signup').addEventListener('click', () => openAuth('signup'));
  $('#open-change').addEventListener('click', () => openAuth('change'));
  $('#login-hint-link').addEventListener('click', () => openAuth('signup'));
  $('#auth-forgot').addEventListener('click', () => {
    const email = $('#auth-email').value;
    setMode('forgot');
    $('#auth-email').value = email;
    $('#auth-email').focus();
  });
  $('#auth-switch').addEventListener('click', () => setMode(AUTH_MODES[mode].switchTo));
  $('#auth-cancel').addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = $('#auth-submit');
    submit.disabled = true;
    error.textContent = '';
    success.textContent = '';
    try {
      const fields = { email: $('#auth-email').value, current: $('#auth-current').value, password: $('#auth-password').value };
      const result = await AUTH_MODES[mode].run(fields, ctx);
      if (result.message) {
        // Forgot password: keep the dialog open and show what happens next.
        success.textContent = result.message;
        submit.hidden = true;
        return;
      }
      dialog.close();
      await setAccount(result.user);
      showStatus(result.status);
    } catch (err) {
      error.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });

  $('#logout').addEventListener('click', async () => {
    await api.logout().catch(() => {});
    await setAccount(null);
    showStatus('Logged out. New saves stay on this device.');
  });
}

// Opening the link from a reset email: show the "choose a new password" screen.
function openResetLink() {
  const match = /^#reset=([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (!match) return;
  history.replaceState(null, '', location.pathname + location.search);
  openAuth('reset', { token: match[1] });
}

async function initAccount() {
  account = await api.getSession();
  await setAccount(account.user);
  if (account.available) openResetLink();
}

// Opening a share link: load it as an unsaved copy, then clean the URL.
async function openSharedLink() {
  const match = /^#p=(.+)$/.exec(location.hash);
  if (!match) return;
  history.replaceState(null, '', location.pathname + location.search);
  const project = await decodeProject(match[1]);
  if (!project) {
    showStatus('That link looks broken, so your current project was kept.', true);
    return;
  }
  setState({ ...project, projectId: undefined });
  $('#project-name').value = state.projectName || '';
  await renderProjectList();
  $('#shared-banner').hidden = false;
}

bindSettings();
bindPricing();
renderRooms();
update();
bindProjects();
bindAccount();
renderProjectList();
initAccount().then(openSharedLink);

// A reset or share link opened in a tab where PaintWise is already running.
window.addEventListener('hashchange', () => {
  if (account.available) openResetLink();
  openSharedLink();
});
