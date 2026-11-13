import { test as base, chromium, firefox, webkit, type Browser, type BrowserType } from '@playwright/test';

export type BrowserName = 'chromium' | 'firefox' | 'webkit';

export type SyncOptions = {
  // The engine the guest runs in. Leave it unset to use the project's browser for both peers.
  guestBrowserName: BrowserName | undefined;
};

const browserTypes: Record<BrowserName, BrowserType> = { chromium, firefox, webkit };

export const test = base.extend<SyncOptions & { guestBrowser: Browser }>({
  guestBrowserName: [undefined, { option: true }],
  // The browser the guest's context comes from: the project's own browser,
  // or a second one launched here for a mixed pair.
  guestBrowser: async ({ browser, browserName, guestBrowserName, headless }, use) => {
    if (!guestBrowserName || guestBrowserName === browserName) {
      await use(browser);
      return;
    }
    const other = await browserTypes[guestBrowserName].launch({ headless });
    try {
      await use(other);
    } finally {
      await other.close();
    }
  },
});

export { expect } from '@playwright/test';
