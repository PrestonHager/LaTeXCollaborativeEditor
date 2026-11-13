import { defineConfig, devices } from '@playwright/test';
import baseConfig from './playwright.config';

// Load-time check (issue #127). Separate from the sync test so `npm run test:e2e` and CI don't run it.
// Run it from the repo root with `npm run test:load-time`. It builds and serves the app the same way.
export default defineConfig({
  ...baseConfig,
  testDir: './perf',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: 'list',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
