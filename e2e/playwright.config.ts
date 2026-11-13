import { defineConfig, devices } from '@playwright/test';
import type { SyncOptions } from './tests/fixtures';

const port = Number(process.env.E2E_PORT ?? 4184);
// Use 127.0.0.1 instead of localhost so the app picks the same relays as production.
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}/`;

export default defineConfig<SyncOptions>({
  testDir: './tests',
  // Peers find each other through public relays, which can take a while.
  timeout: 180_000,
  expect: { timeout: 90_000 },
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // WebRTC differs between engines, so run host and guest in each one,
  // plus a mixed pair where the guest uses a different browser from the host.
  // CI runs each project in its own job (see .github/workflows/test.yml).
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'chromium-host-firefox-guest', use: { ...devices['Desktop Chrome'], guestBrowserName: 'firefox' } },
  ],
  // Build the app and serve it with vite preview, unless E2E_BASE_URL points somewhere else.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm --prefix ../frontend run build && npm --prefix ../frontend run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
        url: baseURL,
        timeout: 300_000,
        reuseExistingServer: !process.env.CI,
      },
});
