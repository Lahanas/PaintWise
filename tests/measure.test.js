import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureWall, resizeLabels, regions, addMeasuredWall, CLASSES } from '../src/measure.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

// A grid with a 200 × 100 wall, a 20 × 80 door and a 30 × 20 window in it.
function room({ door = true, sofa = false } = {}) {
  const w = 220, h = 120;
  const labels = new Uint8Array(w * h);
  const fill = (x0, y0, x1, y1, c) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) labels[y * w + x] = c;
  };
  fill(10, 10, 210, 110, CLASSES.wall);
  if (door) fill(30, 30, 50, 110, CLASSES.door);
  fill(120, 30, 150, 50, CLASSES.window);
  if (sofa) fill(80, 80, 160, 110, CLASSES.other);
  return { labels, w, h };
}

test('measures a wall using the door as a ruler', () => {
  const { labels, w, h } = room();
  const m = measureWall(labels, w, h, { reference: { kind: 'door', height: 2 } });
  assert.equal(m.ok, true);
  close(m.metresPerPixel, 2 / 80);
  close(m.width, 5);
  close(m.height, 2.5);
  close(m.grossArea, 12.5);
  close(m.doorArea, 1);
  close(m.windowArea, 0.375);
  close(m.netArea, 11.125);
  assert.equal(m.doors, 1);
  assert.equal(m.windows, 1);
});

test('measures a wall from the ceiling height', () => {
  const { labels, w, h } = room({ door: false });
  const m = measureWall(labels, w, h, { reference: { kind: 'ceiling', height: 2.5 } });
  close(m.width, 5);
  close(m.height, 2.5);
  assert.equal(m.doors, 0);
});

test('a sofa in front of the wall does not change its height', () => {
  const { labels, w, h } = room({ sofa: true });
  const m = measureWall(labels, w, h, { reference: { kind: 'door', height: 2 } });
  close(m.height, 2.5);
  close(m.width, 5);
  close(m.grossArea, 12.5); // the hidden part still gets painted
});

test('needs a door when the door is the reference', () => {
  const { labels, w, h } = room({ door: false });
  assert.deepEqual(measureWall(labels, w, h), { ok: false, reason: 'no-door' });
});

test('says so when there is no wall', () => {
  assert.deepEqual(measureWall(new Uint8Array(100), 10, 10), { ok: false, reason: 'no-wall' });
});

test('measures the wall that was tapped', () => {
  const w = 100, h = 50;
  const labels = new Uint8Array(w * h);
  for (let y = 0; y < 50; y++) for (let x = 0; x < 100; x++) {
    if (x < 60) labels[y * w + x] = CLASSES.wall; // big wall
    else if (x > 70) labels[y * w + x] = CLASSES.wall; // small wall, 29 px wide
  }
  const ref = { kind: 'ceiling', height: 2.5 };
  close(measureWall(labels, w, h, { reference: ref }).width, 60 * 2.5 / 50);
  close(measureWall(labels, w, h, { reference: ref, tap: { x: 80, y: 10 } }).width, 29 * 2.5 / 50);
});

test('ignores tiny specks of door', () => {
  const { labels, w, h } = room();
  labels[60 * w + 190] = CLASSES.door; // one stray pixel
  assert.equal(measureWall(labels, w, h, { reference: { kind: 'door', height: 2 } }).doors, 1);
});

test('resizes labels without mixing classes', () => {
  const small = Uint8Array.from([0, 1, 2, 3]); // 2 × 2
  assert.deepEqual([...resizeLabels(small, 2, 2, 4, 2)], [0, 0, 1, 1, 2, 2, 3, 3]);
});

test('finds connected regions, largest first', () => {
  const labels = Uint8Array.from([1, 1, 0, 1, 1, 0, 0, 0, 1]);
  const found = regions(labels, 3, 3, (c) => c === 1);
  assert.deepEqual(found.map((r) => r.pixels.length), [4, 1]);
  assert.deepEqual(found[0].box, { x: 0, y: 0, width: 2, height: 2 });
});

test('adds measured walls to a "From photos" room', () => {
  const rooms = [{ name: 'Living room', length: 5, width: 4, height: 2.5 }];
  const once = addMeasuredWall(rooms, { width: 4.2, height: 2.5, doors: 1, windows: 2 }, 'metric');
  assert.equal(rooms.length, 1, 'the original list is not changed');
  assert.equal(once.length, 2);
  assert.deepEqual(once[1].walls, [{ width: 4.2, height: 2.5 }]);
  assert.equal(once[1].mode, 'walls');
  const twice = addMeasuredWall(once, { width: 3, height: 2.5, doors: 0, windows: 1 }, 'metric');
  assert.equal(twice.length, 2);
  assert.equal(twice[1].walls.length, 2);
  assert.equal(twice[1].doors, 1);
  assert.equal(twice[1].windows, 3);
});

test('adds measured walls in feet when the job is imperial', () => {
  const [room] = addMeasuredWall([], { width: 3, height: 2.5, doors: 0, windows: 0 }, 'imperial');
  assert.deepEqual(room.walls, [{ width: 9.84, height: 8.2 }]);
});
