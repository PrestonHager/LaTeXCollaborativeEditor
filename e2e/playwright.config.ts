import { defineConfig, devices } from '@playwright/test';
import type { SyncOptions } from './tests/fixtures';

const port = Number(process.env.E2E_PORT ?? 4184);
// Use 127.0.0.1 instead of localhost so the app picks the same relays as production.
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}/`;

// Peers meet through a WebTorrent tracker on this machine (tracker/server.mjs), not the public ones,
// so the test doesn't depend on third-party uptime (issue #167). The e2e build gets its URL in
// VITE_P2P_RENDEZVOUS, which also adds it to that build's CSP connect-src. Production builds keep
// the default trackers and CSP. E2E_PUBLIC_TRACKERS=1 builds with the public trackers instead.
const usePublicTrackers = process.env.E2E_PUBLIC_TRACKERS === '1';
const trackerPort = Number(process.env.E2E_TRACKER_PORT ?? 4185);
const trackerUrl = `ws://127.0.0.1:${trackerPort}`;

// Playwright launches its own pinned browser build. To use one that's already installed
// (for example when the pinned build isn't downloaded), set E2E_CHROMIUM_EXECUTABLE to its path.
const chromiumExecutable = process.env.E2E_CHROMIUM_EXECUTABLE;
const chromiumLaunch = chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {};

// The e2e build goes to its own folder so it never ends up in frontend/dist, which is what ships.
const appServer = {
  command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --host 127.0.0.1 --port ${port} --strictPort`,
  cwd: '../frontend',
  env: usePublicTrackers ? {} : { VITE_P2P_RENDEZVOUS: trackerUrl },
  url: baseURL,
  timeout: 300_000,
  reuseExistingServer: !process.env.CI,
};

const trackerServer = {
  command: 'node tracker/server.mjs',
  env: { E2E_TRACKER_PORT: String(trackerPort) },
  url: `http://127.0.0.1:${trackerPort}/stats.json`,
  timeout: 30_000,
  reuseExistingServer: !process.env.CI,
  stdout: 'pipe' as const,
};

export default defineConfig<SyncOptions>({
  testDir: './tests',
  // Finding each other and setting up WebRTC can take a while, more so with the public trackers.
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
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...chromiumLaunch } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'chromium-host-firefox-guest', use: { ...devices['Desktop Chrome'], ...chromiumLaunch, guestBrowserName: 'firefox' } },
  ],
  // Build the app and serve it with vite preview, unless E2E_BASE_URL points somewhere else.
  // A site at E2E_BASE_URL uses whatever trackers it was built with, so no local tracker then.
  webServer: process.env.E2E_BASE_URL ? undefined : usePublicTrackers ? [appServer] : [trackerServer, appServer],
});
