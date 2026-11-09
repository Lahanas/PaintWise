import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPlanes } from '../src/segment.js';

test('splits RGBA pixels into R, G and B planes from 0 to 1', () => {
  const rgba = Uint8Array.from([255, 0, 51, 255, 0, 102, 255, 255]);
  assert.deepEqual([...toPlanes(rgba, 2)].map((v) => Math.round(v * 100) / 100), [1, 0, 0, 0.4, 0.2, 1]);
});
