import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The real model is a 4 MB download from a CDN, so here ONNX Runtime is replaced by a
// stand-in that always "sees" the same room: a wall across the top 3/4 of the photo, a door
// 192 px tall (of 384) and a window. That makes the expected measurements exact.
const FAKE_ORT = `
const S = 384;
export const env = { wasm: {} };
export class Tensor { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } }
export const InferenceSession = {
  async create() {
    return {
      async run() {
        const labels = new Uint8Array(S * S);
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          let c = y < 288 ? 1 : 0;
          if (x >= 40 && x < 100 && y >= 96 && y < 288) c = 2;
          if (x >= 200 && x < 300 && y >= 60 && y < 140) c = 3;
          labels[y * S + x] = c;
        }
        return { labels: { data: labels } };
      },
    };
  },
};`;

test.describe('with a stand-in model', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/models/wall-seg.onnx', (route) => route.fulfill({ status: 200, body: 'model' }));
    await page.route('https://cdn.jsdelivr.net/npm/onnxruntime-web@*/dist/ort.wasm.min.mjs', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_ORT, headers: { 'access-control-allow-origin': '*' } }));
  });

  test('measures a wall from a photo and adds it to the estimate', async ({ page }) => {
    await page.goto('/#preview');
    await expect(page.locator('#measure')).toBeVisible();
    await page.locator('#photo-upload').setInputFiles('e2e/fixtures/room.jpg');

    // Door is 2 m tall and 96 of the 192 grid rows → 1/48 m per row.
    await page.locator('#measure-known').fill('2');
    await page.getByRole('button', { name: 'Measure wall' }).click();
    await expect(page.locator('#measure-result')).toContainText('5.33 m × 3.00 m');
    await expect(page.locator('#measure-result')).toContainText('minus 1 door and 1 window');

    await page.getByRole('button', { name: 'Add to my estimate' }).click();
    await expect(page.locator('#tab-estimate')).toBeVisible();
    const room = page.locator('.room').last();
    await expect(room.locator('.room-name')).toHaveValue('From photos');
    await expect(room.locator('[data-wall="width"]')).toHaveValue('5.33');
    await expect(room.locator('[data-wall="height"]')).toHaveValue('3');
    await expect(room.locator('[data-field="doors"]')).toHaveValue('1');
  });

  test('uses the ceiling height as the ruler', async ({ page }) => {
    await page.goto('/#preview');
    await page.locator('#photo-upload').setInputFiles('e2e/fixtures/room.jpg');
    await page.locator('#measure-ref').selectOption('ceiling');
    await page.locator('#measure-known').fill('2.4');
    await page.getByRole('button', { name: 'Measure wall' }).click();
    // 144 rows tall = 2.4 m, so 256 columns = 4.27 m
    await expect(page.locator('#measure-result')).toContainText('4.27 m × 2.40 m');
  });

  test('hides the measuring tool when the site has no model', async ({ page }) => {
    await page.unroute('**/models/wall-seg.onnx');
    await page.route('**/models/wall-seg.onnx', (route) => route.fulfill({ status: 404, body: '' }));
    await page.goto('/#preview');
    await expect(page.locator('#swatches .swatch').first()).toBeVisible();
    await expect(page.locator('#measure')).toBeHidden();
  });
});

// The real model and the real ONNX Runtime (served from node_modules instead of the CDN).
/** @param {import('@playwright/test').Page} page */
async function useRealOrt(page) {
  const dist = 'node_modules/onnxruntime-web/dist/';
  await page.route('https://cdn.jsdelivr.net/npm/onnxruntime-web@*/dist/**', (route) => {
    const file = route.request().url().split('/dist/')[1];
    route.fulfill({
      status: 200,
      body: readFileSync(dist + file),
      contentType: file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
      headers: { 'access-control-allow-origin': '*' },
    });
  });
}

test('the trained model measures the wall in a photo', async ({ page }) => {
  test.setTimeout(60_000);
  await useRealOrt(page);
  await page.goto('/#preview');
  await expect(page.locator('#measure')).toBeVisible();
  // A drawn 6.25 m × 3.12 m wall with a 2.03 m door (the model doesn't count this frame)
  await page.locator('#photo-upload').setInputFiles('e2e/fixtures/room-door.jpg');
  await page.locator('#measure-known').fill('2.03');
  await page.getByRole('button', { name: 'Measure wall' }).click();
  const size = page.locator('#measure-result .big');
  await expect(size).toBeVisible({ timeout: 30_000 });
  const [width, height] = (await size.textContent()).match(/[\d.]+/g).map(Number);
  // This checks the model runs end to end and gives a sensible size (within 15%).
  // It is a drawing, not a photo, so it says little about accuracy on real walls.
  expect(Math.abs(width / 6.25 - 1)).toBeLessThan(0.15);
  expect(Math.abs(height / 3.12 - 1)).toBeLessThan(0.15);
});

test('the trained model measures a real wall', async ({ page }) => {
  test.setTimeout(60_000);
  await useRealOrt(page);
  await page.goto('/#preview');
  await expect(page.locator('#measure')).toBeVisible();
  // A real wall, measured with a tape: 2.21 m floor to ceiling, door frame 2.08 m tall.
  // Only part of the wall is in the photo, so only the height can be checked.
  await page.locator('#photo-upload').setInputFiles('e2e/fixtures/real-wall.jpg');
  await page.getByRole('button', { name: 'Measure wall' }).click();
  const size = page.locator('#measure-result .big');
  await expect(size).toBeVisible({ timeout: 30_000 });
  const height = Number((await size.textContent()).match(/[\d.]+/g)[1]);
  expect(Math.abs(height / 2.21 - 1)).toBeLessThan(0.1);
});
