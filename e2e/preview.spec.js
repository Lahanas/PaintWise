import { test, expect } from '@playwright/test';

test('paints a wall on an uploaded photo', async ({ page }) => {
  await page.goto('/#preview');
  await expect(page.locator('#tab-preview')).toBeVisible();
  await page.locator('#photo-upload').setInputFiles('e2e/fixtures/room.jpg');
  await expect(page.locator('#stage-empty')).toBeHidden();

  const canvas = page.locator('#preview-canvas');
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.locator('#undo-tap')).toBeEnabled();
  await expect(page.locator('#save-image')).toBeEnabled();

  await page.locator('#undo-tap').click();
  await expect(page.locator('#undo-tap')).toBeDisabled();
});
