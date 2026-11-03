import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomWallArea, roomPaintableArea, pickCans, estimate } from '../src/estimator.js';

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
