import { readFileSync, existsSync } from 'node:fs';
import { expect } from '@playwright/test';
import { OUTBOX } from '../playwright.config.js';

/** A new email address for each test, so tests never share an account. */
export const newEmail = () => `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

export async function signUp(page, email, password = 'first-password') {
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.locator('#auth-email').fill(email);
  await page.locator('#auth-password').fill(password);
  await page.locator('#auth-submit').click();
  await expect(page.locator('#account-email')).toHaveText(email);
}

export async function logIn(page, email, password) {
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('#auth-email').fill(email);
  await page.locator('#auth-password').fill(password);
  await page.locator('#auth-submit').click();
  await expect(page.locator('#account-email')).toHaveText(email);
}

export async function logOut(page) {
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.locator('#account-out')).toBeVisible();
}

/** The last email the local server "sent" to this address. */
export async function lastEmailTo(to) {
  let mail;
  await expect
    .poll(() => {
      if (!existsSync(OUTBOX)) return undefined;
      const lines = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      mail = lines.filter((m) => m.to === to).pop();
      return mail;
    })
    .toBeTruthy();
  return mail;
}

/** Fill in the first room on the page. */
export async function setRoom(page, { length, width, height, doors = 0, windows = 0 }) {
  const room = page.locator('.room').first();
  await room.locator('[data-field="length"]').fill(String(length));
  await room.locator('[data-field="width"]').fill(String(width));
  await room.locator('[data-field="height"]').fill(String(height));
  await room.locator('[data-field="doors"]').fill(String(doors));
  await room.locator('[data-field="windows"]').fill(String(windows));
}
