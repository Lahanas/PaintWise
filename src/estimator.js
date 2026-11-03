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
  },
  imperial: {
    length: 'ft',
    area: 'ft²',
    volume: 'gal',
    defaultCoverage: 350, // ft² per US gallon
    door: { width: 3, height: 7 },
    window: { width: 4, height: 4 },
    cans: [5, 1, 0.25], // 5-gallon bucket, gallon, quart
  },
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Gross wall area of a rectangular room: perimeter × height. */
export function roomWallArea(room) {
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
  const ceiling = room.includeCeiling ? num(room.length) * num(room.width) : 0;
  return { walls, ceiling, total: walls + ceiling };
}

/**
 * Pick the cheapest-in-volume set of cans that covers `needed`.
 * Minimises leftover paint first, then the number of cans.
 * Works on a grid of the smallest can size so it stays exact.
 */
export function pickCans(needed, sizes) {
  if (needed <= 0) return { cans: [], total: 0 };
  const sorted = [...sizes].sort((a, b) => b - a);
  // Grid step = greatest common divisor of the can sizes (to 0.01 precision).
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const scaled = sorted.map((s) => Math.round(s * 100));
  const step = scaled.reduce(gcd) / 100;
  const units = scaled.map((s) => Math.round(s / (step * 100)));
  const target = Math.ceil(needed / step - 1e-9);
  const limit = target + Math.max(...units);
  // best[i] = fewest cans to make exactly i units
  const best = new Array(limit + 1).fill(Infinity);
  const choice = new Array(limit + 1).fill(-1);
  best[0] = 0;
  for (let i = 1; i <= limit; i++) {
    units.forEach((u, idx) => {
      if (u <= i && best[i - u] + 1 < best[i]) {
        best[i] = best[i - u] + 1;
        choice[i] = idx;
      }
    });
  }
  let amount = target;
  while (amount <= limit && best[amount] === Infinity) amount++;
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

/**
 * Full estimate.
 * @param {object} input
 * @param {'metric'|'imperial'} input.system
 * @param {Array} input.rooms
 * @param {number} input.coats
 * @param {number} input.coverage area per volume unit
 * @param {number} input.wastePercent extra margin for spills, texture, touch-ups
 */
export function estimate({ system = 'metric', rooms = [], coats = 2, coverage, wastePercent = 10 }) {
  const cfg = UNIT_SYSTEMS[system];
  const cov = num(coverage) || cfg.defaultCoverage;
  const nCoats = Math.max(1, Math.round(num(coats) || 1));
  const waste = Math.max(0, Number(wastePercent) || 0);

  const perRoom = rooms.map((room) => {
    const area = roomPaintableArea(room, system);
    const paint = (area.total * nCoats) / cov;
    return { name: room.name || 'Room', ...area, paint };
  });

  const area = perRoom.reduce((s, r) => s + r.total, 0);
  const basePaint = (area * nCoats) / cov;
  const paint = basePaint * (1 + waste / 100);
  const purchase = pickCans(paint, cfg.cans);

  return { system, units: cfg, coats: nCoats, coverage: cov, wastePercent: waste, perRoom, area, basePaint, paint, purchase };
}
