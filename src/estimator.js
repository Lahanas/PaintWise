// Pure estimation logic. No DOM access here so it can be unit-tested with Node.

export const UNIT_SYSTEMS = {
  metric: {
    length: 'm',
    area: 'm²',
    volume: 'L',
    defaultCoverage: 10, // m² per litre, typical interior emulsion
    door: { width: 0.9, height: 2.1 },
    window: { width: 1.2, height: 1.2 },
    cans: [10, 5, 2.5, 1], // litres
    primerCoverage: 8,
  },
  imperial: {
    length: 'ft',
    area: 'ft²',
    volume: 'gal',
    defaultCoverage: 350, // ft² per US gallon
    door: { width: 3, height: 7 },
    window: { width: 4, height: 4 },
    cans: [5, 1, 0.25], // 5-gallon bucket, gallon, quart
    primerCoverage: 300,
  },
};

// Rough or porous walls soak up more paint than the can's coverage figure assumes.
export const SURFACES = {
  smooth: { label: 'Smooth / previously painted', factor: 1 },
  textured: { label: 'Light texture', factor: 1.15 },
  rough: { label: 'Rough or porous (new plaster, brick, stucco)', factor: 1.3 },
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Gross wall area of a room.
 * Rectangle mode: perimeter × height.
 * Walls mode: sum of each wall's width × height (for L-shaped rooms, slopes, feature walls...).
 */
export function roomWallArea(room) {
  if (room.mode === 'walls') {
    return (room.walls || []).reduce((sum, w) => sum + num(w.width) * num(w.height), 0);
  }
  return 2 * (num(room.length) + num(room.width)) * num(room.height);
}

/** Area removed by openings (doors and windows). */
export function openingsArea(room, system) {
  const { door, window } = UNIT_SYSTEMS[system];
  const dw = num(room.doorWidth) || door.width;
  const dh = num(room.doorHeight) || door.height;
  const ww = num(room.windowWidth) || window.width;
  const wh = num(room.windowHeight) || window.height;
  return num(room.doors) * dw * dh + num(room.windows) * ww * wh;
}

/** Paintable area for a room, never negative. Ceiling is optional. */
export function roomPaintableArea(room, system) {
  const walls = Math.max(0, roomWallArea(room) - openingsArea(room, system));
  let ceiling = 0;
  if (room.includeCeiling) {
    ceiling = room.mode === 'walls' ? num(room.ceilingArea) : num(room.length) * num(room.width);
  }
  return { walls, ceiling, total: walls + ceiling };
}

/**
 * Pick the set of cans to buy for `needed`.
 * Without prices: least leftover paint first, then fewest cans.
 * With a price for every can size: cheapest total first, then least leftover
 * (a big bucket is often cheaper than several small tins, even with paint left over).
 * Works on a grid of the can sizes' common step so it stays exact.
 * @param {number} needed
 * @param {number[]} sizes
 * @param {Object<string, number>} [prices] price per can, keyed by size
 */
export function pickCans(needed, sizes, prices) {
  if (needed <= 0) return { cans: [], total: 0 };
  const sorted = [...sizes].sort((a, b) => b - a);
  const priced = hasAllPrices(sorted, prices);
  // Grid step = greatest common divisor of the can sizes (to 0.01 precision).
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const scaled = sorted.map((s) => Math.round(s * 100));
  const step = scaled.reduce(gcd) / 100;
  const units = scaled.map((s) => Math.round(s / (step * 100)));
  const target = Math.ceil(needed / step - 1e-9);
  const limit = target + Math.max(...units);
  // weight of one can: its price, or 1 (= count cans) when there are no prices
  const weight = sorted.map((size) => (priced ? Number(prices?.[size]) : 1));

  // best[i] = lowest weight to make exactly i units
  const best = new Array(limit + 1).fill(Infinity);
  const choice = new Array(limit + 1).fill(-1);
  best[0] = 0;
  for (let i = 1; i <= limit; i++) {
    units.forEach((u, idx) => {
      if (u <= i && best[i - u] + weight[idx] < best[i] - 1e-9) {
        best[i] = best[i - u] + weight[idx];
        choice[i] = idx;
      }
    });
  }

  let amount = -1;
  for (let i = target; i <= limit; i++) {
    if (best[i] === Infinity) continue;
    if (amount < 0) { amount = i; if (!priced) break; continue; }
    if (best[i] < best[amount] - 1e-9) amount = i; // strictly cheaper wins; ties keep less leftover
  }
  const counts = new Map();
  for (let i = amount; i > 0; i -= units[choice[i]]) {
    const size = sorted[choice[i]];
    counts.set(size, (counts.get(size) || 0) + 1);
  }
  const cans = [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([size, count]) => ({ size, count }));
  return { cans, total: amount * step };
}

function hasAllPrices(sizes, prices) {
  return !!prices && sizes.every((size) => Number(prices[size]) > 0);
}

/**
 * Cost of a list of cans. Sizes without a price are listed with price null.
 * @returns {{lines: Array<{size:number,count:number,price:number|null,total:number}>, total: number, complete: boolean}}
 */
export function costOf(cans, prices = {}) {
  let total = 0;
  let complete = true;
  const lines = cans.map(({ size, count }) => {
    const price = Number(prices[size]) > 0 ? Number(prices[size]) : null;
    if (price === null) complete = false;
    const lineTotal = price === null ? 0 : price * count;
    total += lineTotal;
    return { size, count, price, total: lineTotal };
  });
  return { lines, total, complete };
}

/**
 * Full estimate.
 * @param {object} input
 * @param {'metric'|'imperial'} input.system
 * @param {Array} input.rooms
 * @param {number} input.coats
 * @param {number} input.coverage area per volume unit
 * @param {number} input.wastePercent extra margin for spills, texture, touch-ups
 * @param {'smooth'|'textured'|'rough'} [input.surface]
 * @param {boolean} [input.primer] add one coat of primer
 * @param {number} [input.primerCoverage] area per volume unit for the primer
 * @param {Object<string, number>} [input.paintPrices] price per can of paint, keyed by can size
 * @param {Object<string, number>} [input.primerPrices] price per can of primer, keyed by can size
 * @param {number} [input.labourRate] price per area unit of wall painted (all coats included)
 * @param {number} [input.taxPercent] tax added to the subtotal
 */
export function estimate({
  system = 'metric',
  rooms = [],
  coats = 2,
  coverage,
  wastePercent = 10,
  surface = 'smooth',
  primer = false,
  primerCoverage,
  paintPrices = {},
  primerPrices = {},
  labourRate = 0,
  taxPercent = 0,
}) {
  const cfg = UNIT_SYSTEMS[system];
  const cov = num(coverage) || cfg.defaultCoverage;
  const nCoats = Math.max(1, Math.round(num(coats) || 1));
  const waste = Math.max(0, Number(wastePercent) || 0);
  const surfaceFactor = (SURFACES[surface] || SURFACES.smooth).factor;
  const margin = 1 + waste / 100;

  const perRoom = rooms.map((room) => {
    const area = roomPaintableArea(room, system);
    const paint = (area.total * nCoats * surfaceFactor) / cov;
    return { name: room.name || 'Room', ...area, paint };
  });

  const area = perRoom.reduce((s, r) => s + r.total, 0);
  const basePaint = (area * nCoats * surfaceFactor) / cov;
  const paint = basePaint * margin;
  const purchase = pickCans(paint, cfg.cans, paintPrices);

  let primerResult = null;
  if (primer) {
    const pCov = num(primerCoverage) || cfg.primerCoverage;
    const amount = ((area * surfaceFactor) / pCov) * margin;
    primerResult = { coverage: pCov, paint: amount, purchase: pickCans(amount, cfg.cans, primerPrices) };
  }

  // Money: only when the user entered some prices or a labour rate.
  const paintCost = costOf(purchase.cans, paintPrices);
  const primerCost = primerResult ? costOf(primerResult.purchase.cans, primerPrices) : null;
  const labour = area * (Number(labourRate) > 0 ? Number(labourRate) : 0);
  const subtotal = paintCost.total + (primerCost ? primerCost.total : 0) + labour;
  const tax = subtotal * Math.max(0, Number(taxPercent) || 0) / 100;
  const cost = {
    paint: paintCost,
    primer: primerCost,
    labour,
    subtotal,
    tax,
    total: subtotal + tax,
    hasAny: subtotal > 0,
  };

  return {
    system,
    units: cfg,
    coats: nCoats,
    coverage: cov,
    wastePercent: waste,
    surface,
    surfaceFactor,
    perRoom,
    area,
    basePaint,
    paint,
    purchase,
    primer: primerResult,
    cost,
  };
}
