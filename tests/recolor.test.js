import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToRgb, floodSelect, recolor } from '../src/recolor.js';

// Build a small fake image: left half beige wall, right half dark brown door.
function makeImage(width = 10, height = 6) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const wall = x < width / 2;
      // a gentle light gradient across the wall, like real lighting
      const light = wall ? 220 - y * 3 : 70;
      data[i] = wall ? light : 90;
      data[i + 1] = wall ? light - 10 : 50;
      data[i + 2] = wall ? light - 30 : 30;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

test('hexToRgb parses colors', () => {
  assert.deepEqual(hexToRgb('#ff8000'), [255, 128, 0]);
  assert.deepEqual(hexToRgb('00ff00'), [0, 255, 0]);
  assert.throws(() => hexToRgb('red'));
});

test('floodSelect grabs the wall but not the door', () => {
  const img = makeImage();
  const { mask, added } = floodSelect(img, 1, 1, 30);
  assert.equal(added, 5 * 6);
  assert.equal(mask[0], 1); // top-left is wall
  assert.equal(mask[9], 0); // top-right is door
});

test('floodSelect adds to an existing selection', () => {
  const img = makeImage();
  const first = floodSelect(img, 1, 1, 30);
  const second = floodSelect(img, 8, 1, 30, first.mask);
  assert.equal(second.added, 5 * 6);
  assert.equal(second.mask.reduce((s, v) => s + v, 0), 60);
});

test('floodSelect ignores taps outside the image', () => {
  assert.equal(floodSelect(makeImage(), -1, 50, 30).added, 0);
});

test('recolor paints only the selection and keeps shading', () => {
  const img = makeImage();
  const { mask } = floodSelect(img, 1, 1, 30);
  const out = recolor(img, mask, '#3366cc');
  // door untouched
  assert.deepEqual([...out.data.slice(9 * 4, 9 * 4 + 3)], [90, 50, 30]);
  // wall is now blue-ish
  const top = out.data.slice(0, 3);
  assert.ok(top[2] > top[0], 'blue channel dominates');
  // top row was lighter than bottom row, and still is
  const bottom = out.data.slice((5 * 10) * 4, (5 * 10) * 4 + 3);
  assert.ok(top[2] > bottom[2]);
});

test('recolor with an empty selection returns the original', () => {
  const img = makeImage();
  const out = recolor(img, new Uint8Array(60), '#000000');
  assert.deepEqual(out.data, img.data);
});
