import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4184);
// Use 127.0.0.1 instead of localhost so the app picks the same relays as production.
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}/`;

export default defineConfig({
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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
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
