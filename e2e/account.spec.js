import { test, expect } from '@playwright/test';
import { newEmail, signUp, logIn, logOut, lastEmailTo } from './helpers.js';

test('a wrong password is refused', async ({ page }) => {
  const email = newEmail();
  await page.goto('/');
  await signUp(page, email);
  await logOut(page);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('#auth-email').fill(email);
  await page.locator('#auth-password').fill('not-my-password');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-error')).toHaveText('Wrong email or password');
});

test('changes the password', async ({ page }) => {
  const email = newEmail();
  await page.goto('/');
  await signUp(page, email);
  await page.getByRole('button', { name: 'Change password' }).click();
  await page.locator('#auth-current').fill('first-password');
  await page.locator('#auth-password').fill('second-password');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#project-status')).toHaveText('Password changed.');

  await logOut(page);
  await logIn(page, email, 'second-password');
});

test('resets a forgotten password with the emailed link', async ({ page }) => {
  const email = newEmail();
  await page.goto('/');
  await signUp(page, email);
  await logOut(page);

  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('button', { name: 'Forgot your password?' }).click();
  await page.locator('#auth-email').fill(email);
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-success')).toContainText('reset link is on its way');
  await page.locator('#auth-cancel').click();

  const mail = await lastEmailTo(email);
  const link = mail.text.match(/https?:\/\/\S+#reset=\S+/)[0];
  await page.goto(link);
  await expect(page.locator('#auth-title')).toHaveText('Choose a new password');
  await expect(page).not.toHaveURL(/#reset=/);
  await page.locator('#auth-password').fill('brand-new-password');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#account-email')).toHaveText(email);

  await logOut(page);
  await logIn(page, email, 'brand-new-password');

  // The link only works once
  await logOut(page);
  await page.goto(link);
  await page.locator('#auth-password').fill('another-password');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-error')).toContainText('expired or was already used');
});
