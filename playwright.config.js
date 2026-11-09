// Browser tests: they start the app with an empty in-memory database and click through it
// in a real Chromium, like a user would. Run with `npm run test:e2e`.
import { defineConfig, devices } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';

const PORT = 3210;
export const OUTBOX = '.data/e2e-outbox.jsonl';
mkdirSync('.data', { recursive: true });
rmSync(OUTBOX, { force: true });

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node scripts/dev.js',
    env: { PORT: String(PORT), DATA_DIR: 'memory', MAIL_OUTBOX: OUTBOX },
    url: `http://localhost:${PORT}/api/auth/me`,
    reuseExistingServer: !process.env.CI,
  },
});
