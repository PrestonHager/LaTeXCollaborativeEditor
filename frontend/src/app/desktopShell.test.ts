import { desktopGoogleClient, desktopNativeRtc, driveSessionLostNotice, isDesktopShell, localPlace, openInSystemBrowser } from './desktopShell';

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

describe('localPlace', () => {
  it('names where local data lives', () => {
    expect(localPlace({ __TAURI_INTERNALS__: {} })).toBe('this app');
    expect(localPlace({})).toBe('this browser');
    expect(localPlace()).toBe('this browser');
  });
});

describe('driveSessionLostNotice', () => {
  it('names the place edits now save (issue #235)', () => {
    expect(driveSessionLostNotice({ __TAURI_INTERNALS__: {} })).toBe(
      'Google Drive sign-in expired, so edits are saving in this app. Use File > Connect Google Drive to switch back.',
    );
    expect(driveSessionLostNotice({})).toContain('saving in this browser.');
    expect(driveSessionLostNotice()).toContain('saving in this browser.');
  });
});

describe('desktopGoogleClient', () => {
  it('is set only when the shell says it can sign in to Google (#177)', () => {
    expect(desktopGoogleClient({})).toBeUndefined();
    expect(desktopGoogleClient(undefined)).toBeUndefined();
    expect(desktopGoogleClient({ __LCE_DESKTOP__: { googleSignIn: false } })).toBeUndefined();
    expect(desktopGoogleClient({ __LCE_DESKTOP__: { googleSignIn: true } })).toBe('desktop');
    const hostile = {
      get __LCE_DESKTOP__() {
        throw new Error('nope');
      },
    };
    expect(desktopGoogleClient(hostile)).toBeUndefined();
  });
});

describe('desktopNativeRtc', () => {
  it('is true only when the shell offers its own WebRTC (#176)', () => {
    expect(desktopNativeRtc({})).toBe(false);
    expect(desktopNativeRtc(undefined)).toBe(false);
    expect(desktopNativeRtc({ __LCE_DESKTOP__: { nativeRtc: 'yes' } })).toBe(false);
    expect(desktopNativeRtc({ __LCE_DESKTOP__: { googleSignIn: true, nativeRtc: true } })).toBe(true);
    const hostile = {
      get __LCE_DESKTOP__() {
        throw new Error('nope');
      },
    };
    expect(desktopNativeRtc(hostile)).toBe(false);
  });
});
