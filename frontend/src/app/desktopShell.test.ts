import { isDesktopShell, openInSystemBrowser } from './desktopShell';

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

describe('openInSystemBrowser', () => {
  it('asks the opener plugin to open https links', async () => {
    const invoke = vi.fn(async () => undefined);
    await expect(openInSystemBrowser('https://example.com/?room=r', { __TAURI_INTERNALS__: { invoke } })).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('plugin:opener|open_url', { url: 'https://example.com/?room=r' });
  });

  it('opens nothing but https, and nothing outside the desktop app', async () => {
    const invoke = vi.fn(async () => undefined);
    await expect(openInSystemBrowser('http://example.com/', { __TAURI_INTERNALS__: { invoke } })).resolves.toBe(false);
    await expect(openInSystemBrowser('javascript:alert(1)', { __TAURI_INTERNALS__: { invoke } })).resolves.toBe(false);
    await expect(openInSystemBrowser('https://example.com/', {})).resolves.toBe(false);
    await expect(openInSystemBrowser('https://example.com/')).resolves.toBe(false);
    await expect(openInSystemBrowser('https://example.com/', { __TAURI_INTERNALS__: {} })).resolves.toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('resolves false when the shell refuses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const invoke = vi.fn(async () => {
      throw new Error('not allowed');
    });
    await expect(openInSystemBrowser('https://example.com/', { __TAURI_INTERNALS__: { invoke } })).resolves.toBe(false);
    warn.mockRestore();
  });
});
