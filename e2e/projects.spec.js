import { test, expect } from '@playwright/test';
import { newEmail, signUp, logIn, logOut, setRoom } from './helpers.js';

test('saves a project to the account and opens it after logging back in', async ({ page }) => {
  const email = newEmail();
  await page.goto('/');
  await signUp(page, email);

  await page.locator('#project-name').fill('Kitchen');
  await setRoom(page, { length: 3.5, width: 3, height: 2.4 });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#project-status')).toContainText('Saved “Kitchen” to your account');

  await logOut(page);
  await expect(page.locator('#project-list')).not.toContainText('Kitchen');

  await logIn(page, email, 'first-password');
  const saved = page.locator('#project-list option', { hasText: 'Kitchen' });
  await page.locator('#project-list').selectOption(await saved.getAttribute('value'));
  await expect(page.locator('#project-name')).toHaveValue('Kitchen');
  await expect(page.locator('.room [data-field="length"]').first()).toHaveValue('3.5');
});

test('a share link opens a copy of the project', async ({ page, browser }) => {
  await page.addInitScript(() => {
    navigator.clipboard.writeText = async (text) => { window.copied = text; };
    Object.defineProperty(navigator, 'share', { value: undefined });
  });
  await page.goto('/');
  await page.locator('#project-name').fill('Mom’s living room');
  await setRoom(page, { length: 5, width: 4, height: 2.6 });
  await page.getByRole('button', { name: 'Share link' }).click();
  await expect(page.locator('#project-status')).toContainText('Link copied');
  const link = await page.evaluate(() => window.copied);
  expect(link).toContain('#p=');

  // Someone else opens it in their own browser
  const other = await browser.newContext();
  const theirPage = await other.newPage();
  await theirPage.goto(link);
  await expect(theirPage.locator('#shared-banner')).toBeVisible();
  await expect(theirPage.locator('#project-name')).toHaveValue('Mom’s living room');
  await expect(theirPage.locator('.room [data-field="width"]').first()).toHaveValue('4');
  await expect(theirPage).not.toHaveURL(/#p=/);
  await other.close();
});
