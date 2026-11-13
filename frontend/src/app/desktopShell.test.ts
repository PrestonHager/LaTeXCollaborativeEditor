import { isDesktopShell } from './desktopShell';

describe('isDesktopShell', () => {
  it('sees the Tauri globals and nothing else', () => {
    expect(isDesktopShell({ __TAURI_INTERNALS__: {} })).toBe(true);
    expect(isDesktopShell({ __TAURI__: {} })).toBe(false);
    expect(isDesktopShell({})).toBe(false);
    expect(isDesktopShell(undefined)).toBe(false);
    // jsdom is a browser.
    expect(isDesktopShell()).toBe(false);
  });

  it('never throws', () => {
    const hostile = new Proxy(
      {},
      {
        has: () => {
          throw new Error('blocked');
        },
      },
    );
    expect(isDesktopShell(hostile)).toBe(false);
  });
});
