import { test, expect } from '@playwright/test';
import { setRoom } from './helpers.js';

test('works out the paint for a room', async ({ page }) => {
  await page.goto('/');
  await page.locator('#coats').fill('2');
  await page.locator('#coverage').fill('10');
  await page.locator('#waste').fill('0');
  // 4 m × 3 m room, 2.5 m high: 35 m² of wall, 2 coats at 10 m²/L = 7 L
  await setRoom(page, { length: 4, width: 3, height: 2.5 });
  await expect(page.locator('#result .big')).toHaveText('7');
  await expect(page.locator('#result')).toContainText('35 m² paintable');

  // A door takes paint off
  await page.locator('.room [data-field="doors"]').first().fill('1');
  await expect(page.locator('#result .big')).not.toHaveText('7');
});

test('switches to imperial and converts the measurements', async ({ page }) => {
  await page.goto('/');
  await setRoom(page, { length: 4, width: 3, height: 2.5 });
  await page.locator('#system').selectOption('imperial');
  await expect(page.locator('.room [data-field="length"]').first()).toHaveValue(/^13\.1/);
  await expect(page.locator('#result')).toContainText('gal of paint');
});

test('remembers the job after a reload', async ({ page }) => {
  await page.goto('/');
  await setRoom(page, { length: 6, width: 5, height: 3 });
  await page.reload();
  await expect(page.locator('.room [data-field="length"]').first()).toHaveValue('6');
});

test('adds and removes rooms', async ({ page }) => {
  await page.goto('/');
  const rooms = page.locator('.room');
  const before = await rooms.count();
  await page.getByRole('button', { name: '+ Add room' }).click();
  await expect(rooms).toHaveCount(before + 1);
  await rooms.last().getByRole('button', { name: 'Remove room' }).click();
  await expect(rooms).toHaveCount(before);
});
