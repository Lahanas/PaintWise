import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomWallArea, roomPaintableArea, pickCans, costOf, estimate } from '../src/estimator.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('wall area is perimeter times height', () => {
  close(roomWallArea({ length: 4, width: 3, height: 2.5 }), 35);
});

test('doors and windows are deducted with default sizes', () => {
  const r = roomPaintableArea({ length: 4, width: 3, height: 2.5, doors: 1, windows: 1 }, 'metric');
  close(r.walls, 35 - 0.9 * 2.1 - 1.2 * 1.2);
});

test('area never goes negative', () => {
  const r = roomPaintableArea({ length: 1, width: 1, height: 1, doors: 5 }, 'metric');
  assert.equal(r.walls, 0);
});

test('ceiling is added when requested', () => {
  const r = roomPaintableArea({ length: 4, width: 3, height: 2.5, includeCeiling: true }, 'metric');
  close(r.total, 35 + 12);
});

test('estimate applies coats, coverage and waste', () => {
  const e = estimate({ system: 'metric', rooms: [{ length: 4, width: 3, height: 2.5 }], coats: 2, coverage: 10, wastePercent: 10 });
  close(e.area, 35);
  close(e.basePaint, 7);
  close(e.paint, 7.7);
});

test('pickCans minimises leftover, then can count', () => {
  const p = pickCans(7.7, [10, 5, 2.5, 1]);
  assert.equal(p.total, 8);
  assert.deepEqual(p.cans, [{ size: 5, count: 1 }, { size: 1, count: 3 }]);
  const sum = p.cans.reduce((s, c) => s + c.size * c.count, 0);
  close(sum, 8);
});

test('pickCans imperial uses quarts for small jobs', () => {
  const p = pickCans(0.4, [5, 1, 0.25]);
  close(p.total, 0.5);
  assert.deepEqual(p.cans, [{ size: 0.25, count: 2 }]);
});

test('pickCans returns nothing for zero need', () => {
  assert.deepEqual(pickCans(0, [10, 5]), { cans: [], total: 0 });
});

test('pickCans prefers one big can when it is an exact fit', () => {
  const p = pickCans(9.6, [10, 5, 2.5, 1]);
  assert.deepEqual(p.cans, [{ size: 10, count: 1 }]);
});

test('custom walls mode sums each wall', () => {
  const room = { mode: 'walls', walls: [{ width: 4, height: 2.5 }, { width: 2, height: 2.5 }, { width: 3, height: 1.8 }], doors: 1 };
  close(roomWallArea(room), 10 + 5 + 5.4);
  close(roomPaintableArea(room, 'metric').walls, 20.4 - 0.9 * 2.1);
});

test('custom walls mode uses ceilingArea for the ceiling', () => {
  const room = { mode: 'walls', walls: [{ width: 4, height: 2.5 }], includeCeiling: true, ceilingArea: 9, length: 100, width: 100 };
  close(roomPaintableArea(room, 'metric').ceiling, 9);
});

test('rough surface needs more paint', () => {
  const base = { system: 'metric', rooms: [{ length: 4, width: 3, height: 2.5 }], coats: 2, coverage: 10, wastePercent: 0 };
  close(estimate({ ...base, surface: 'smooth' }).paint, 7);
  close(estimate({ ...base, surface: 'rough' }).paint, 9.1);
});

test('primer is one coat at primer coverage, with margin', () => {
  const e = estimate({ system: 'metric', rooms: [{ length: 4, width: 3, height: 2.5 }], coats: 2, coverage: 10, wastePercent: 10, primer: true });
  close(e.primer.paint, (35 / 8) * 1.1);
  assert.ok(e.primer.purchase.total >= e.primer.paint);
});

test('no primer by default', () => {
  assert.equal(estimate({ rooms: [{ length: 4, width: 3, height: 2.5 }] }).primer, null);
});

test('pickCans with prices picks the cheapest mix, even with leftover', () => {
  // 7.7 L needed: least leftover is 5 + 1 + 1 + 1 = 8 L, but one 10 L bucket is cheaper here
  const prices = { 10: 60, 5: 40, 2.5: 25, 1: 14 };
  const p = pickCans(7.7, [10, 5, 2.5, 1], prices);
  assert.deepEqual(p.cans, [{ size: 10, count: 1 }]);
});

test('pickCans with prices keeps least leftover when it is also cheapest', () => {
  const prices = { 10: 100, 5: 40, 2.5: 22, 1: 10 };
  const p = pickCans(7.7, [10, 5, 2.5, 1], prices);
  assert.equal(p.total, 8);
});

test('pickCans ignores incomplete prices', () => {
  const p = pickCans(7.7, [10, 5, 2.5, 1], { 10: 60 });
  assert.equal(p.total, 8);
});

test('costOf adds up lines and flags missing prices', () => {
  const c = costOf([{ size: 5, count: 2 }, { size: 1, count: 1 }], { 5: 40 });
  assert.equal(c.total, 80);
  assert.equal(c.complete, false);
  assert.equal(c.lines[1].price, null);
});

test('estimate adds paint, primer, labour and tax', () => {
  const e = estimate({
    system: 'metric',
    rooms: [{ length: 4, width: 3, height: 2.5 }], // 35 m²
    coats: 2, coverage: 10, wastePercent: 0,       // 7 L
    primer: true, primerCoverage: 7,                // 5 L
    paintPrices: { 10: 60, 5: 35, 2.5: 20, 1: 10 },
    primerPrices: { 10: 50, 5: 30, 2.5: 18, 1: 9 },
    labourRate: 4,
    taxPercent: 20,
  });
  // paint 7 L: 5 + 2.5 = 55, or 5 + 1 + 1 = 55, or 10 = 60 → 55
  assert.equal(e.cost.paint.total, 55);
  assert.equal(e.cost.primer.total, 30);
  assert.equal(e.cost.labour, 140);
  assert.equal(e.cost.subtotal, 225);
  assert.equal(e.cost.tax, 45);
  assert.equal(e.cost.total, 270);
});

test('estimate has no cost when nothing is priced', () => {
  const e = estimate({ rooms: [{ length: 4, width: 3, height: 2.5 }] });
  assert.equal(e.cost.hasAny, false);
  assert.equal(e.cost.total, 0);
});
