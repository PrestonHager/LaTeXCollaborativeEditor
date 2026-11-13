import { createKeymap } from './keymap';
import { shortcuts } from './commands';
import {
  describeKeyContext,
  detectAppWindow,
  detectBrowser,
  detectKeyContext,
  detectOs,
  reservedKeyTable,
  reservedKeys,
  watchKeyContext,
  type BrowserFamily,
  type KeyContext,
  type KeyOs,
} from './reservedKeys';

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  chromeLinux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0',
  opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 OPR/120.0.0.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/153.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
  unknown: 'SomeBrowser/1.0',
};

const nav = (userAgent: string, extra: Record<string, unknown> = {}) => ({ userAgent, ...extra });
const context = (browser: BrowserFamily, os: KeyOs, appWindow = false): KeyContext => ({
  browser,
  browserName: { chromium: 'Chrome', firefox: 'Firefox', safari: 'Safari', other: 'Your browser' }[browser],
  os,
  platform: os === 'mac' || os === 'ios' ? 'mac' : 'other',
  appWindow,
});

describe('detecting the browser and OS', () => {
  it('tells the engine family and name apart', () => {
    expect(detectBrowser(nav(UA.chromeWin))).toEqual({ browser: 'chromium', browserName: 'Chrome' });
    expect(detectBrowser(nav(UA.edge))).toEqual({ browser: 'chromium', browserName: 'Edge' });
    expect(detectBrowser(nav(UA.opera))).toEqual({ browser: 'chromium', browserName: 'Opera' });
    expect(detectBrowser(nav(UA.firefoxLinux))).toEqual({ browser: 'firefox', browserName: 'Firefox' });
    expect(detectBrowser(nav(UA.safariMac))).toEqual({ browser: 'safari', browserName: 'Safari' });
    // Every iOS browser is Safari underneath, and an iPad says it's a Mac but has a touch screen.
    expect(detectBrowser(nav(UA.chromeIphone)).browser).toBe('safari');
    expect(detectBrowser(nav(UA.chromeMac, { maxTouchPoints: 5 })).browser).toBe('safari');
    expect(detectBrowser(nav(UA.unknown))).toEqual({ browser: 'other', browserName: 'Your browser' });
    expect(detectBrowser(nav('', { userAgentData: { brands: [{ brand: 'Microsoft Edge' }] } })).browserName).toBe('Edge');
    expect(detectBrowser(nav('', { userAgentData: { brands: [{ brand: 'Chromium' }] } })).browser).toBe('chromium');
    expect(detectBrowser(nav('', { userAgentData: { brands: [{ brand: 'Opera' }] } })).browserName).toBe('Opera');
    expect(detectBrowser(undefined).browser).toBe('other');
  });

  it('finds the OS', () => {
    expect(detectOs(nav(UA.chromeWin))).toBe('windows');
    expect(detectOs(nav(UA.chromeLinux))).toBe('linux');
    expect(detectOs(nav(UA.chromeMac))).toBe('mac');
    expect(detectOs(nav(UA.chromeOs))).toBe('chromeos');
    expect(detectOs(nav(UA.chromeIphone))).toBe('ios');
    expect(detectOs(nav(UA.safariMac, { maxTouchPoints: 5 }))).toBe('ios');
    expect(detectOs(nav(UA.android))).toBe('android');
    expect(detectOs(nav(UA.unknown))).toBe('other');
    expect(detectOs(nav('', { userAgentData: { platform: 'Windows' } }))).toBe('windows');
    expect(detectOs(undefined)).toBe('other');
  });

  it('counts installed apps and browser fullscreen as an app window', () => {
    const matching = (modes: string[]) => ({ matchMedia: (query: string) => ({ matches: modes.some((mode) => query.includes(mode)) }) as MediaQueryList });
    expect(detectAppWindow(matching(['browser']))).toBe(false);
    for (const mode of ['standalone', 'minimal-ui', 'window-controls-overlay', 'fullscreen']) expect(detectAppWindow(matching([mode])), mode).toBe(true);
    expect(detectAppWindow({ matchMedia: () => { throw new Error('no'); } })).toBe(false);
    expect(detectAppWindow(undefined)).toBe(false);
    // jsdom has no display modes, so it's a tab.
    expect(detectKeyContext()).toMatchObject({ appWindow: false });
  });

  it('follows the window as it goes in and out of an app window', () => {
    const listeners: (() => void)[] = [];
    let standalone = false;
    const win = {
      navigator: nav(UA.chromeLinux),
      matchMedia: (query: string) => ({
        get matches() {
          return standalone && query.includes('standalone');
        },
        addEventListener: (_: string, listener: () => void) => listeners.push(listener),
        removeEventListener: (_: string, listener: () => void) => listeners.splice(listeners.indexOf(listener), 1),
      }),
    } as unknown as Window;
    const onChange = vi.fn();
    const watch = watchKeyContext(onChange, win);
    expect(watch.current()).toMatchObject({ browser: 'chromium', browserName: 'Chrome', os: 'linux', appWindow: false });
    listeners[0]();
    expect(onChange).not.toHaveBeenCalled();
    standalone = true;
    listeners[0]();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ appWindow: true }));
    expect(watch.current().appWindow).toBe(true);
    watch.stop();
    expect(listeners).toHaveLength(0);
    expect(describeKeyContext(watch.current())).toBe('Chrome in its own window');
    expect(describeKeyContext(context('firefox', 'linux'))).toBe('Firefox in a browser tab');
  });
});

describe('when the browser APIs are missing or throw (old Safari, locked-down modes)', () => {
  const throwing = () => {
    throw new Error('blocked');
  };

  it('never throws while detecting, and falls back to a tab', () => {
    const nav = { get userAgent(): string { return throwing(); } };
    expect(detectBrowser(nav)).toEqual({ browser: 'other', browserName: 'Your browser' });
    expect(detectOs(nav)).toBe('other');
    const win = { get navigator(): Navigator { return throwing(); }, matchMedia: throwing } as unknown as Window;
    expect(detectKeyContext(win)).toMatchObject({ browser: 'other', appWindow: false });
    expect(detectKeyContext(undefined)).toMatchObject({ appWindow: false });
    expect(reservedKeys(undefined).size).toBe(0);
  });

  it('watches with the old addListener, and keeps going when matchMedia or a listener fails', () => {
    const listeners: (() => void)[] = [];
    let standalone = false;
    const oldSafari = {
      navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1 Safari/605.1.15' },
      matchMedia: (query: string) => ({
        get matches() {
          return standalone && query.includes('standalone');
        },
        addListener: (listener: () => void) => listeners.push(listener),
        removeListener: (listener: () => void) => listeners.splice(listeners.indexOf(listener), 1),
      }),
    } as unknown as Window;
    const onChange = vi.fn(throwing);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const watch = watchKeyContext(onChange, oldSafari);
    expect(watch.current()).toMatchObject({ browser: 'safari', os: 'mac', appWindow: false });
    expect(listeners).toHaveLength(4);
    standalone = true;
    // The page's own update fails, but that's reported, not thrown into the browser's event.
    expect(() => listeners[0]()).not.toThrow();
    expect(watch.current().appWindow).toBe(true);
    expect(warn).toHaveBeenCalled();
    watch.stop();
    expect(listeners).toHaveLength(0);

    // No way to listen at all, or matchMedia throws: it still starts, and stop does nothing.
    const silent = watchKeyContext(vi.fn(), { navigator: oldSafari.navigator, matchMedia: () => ({ matches: false }) } as unknown as Window);
    expect(() => silent.stop()).not.toThrow();
    const broken = watchKeyContext(vi.fn(), { navigator: oldSafari.navigator, matchMedia: throwing } as unknown as Window);
    expect(broken.current().appWindow).toBe(false);
    const failingListen = watchKeyContext(vi.fn(), {
      navigator: oldSafari.navigator,
      matchMedia: () => ({ matches: false, addEventListener: throwing }),
    } as unknown as Window);
    expect(failingListen.current().browser).toBe('safari');
    const failingStop = watchKeyContext(vi.fn(), {
      navigator: oldSafari.navigator,
      matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: throwing }),
    } as unknown as Window);
    expect(() => failingStop.stop()).not.toThrow();
    expect(watchKeyContext(vi.fn(), undefined).current().appWindow).toBe(false);
    warn.mockRestore();
  });

  it('keeps the keymap working when reading the kept keys fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const keymap = createKeymap(shortcuts, () => 'other', undefined, throwing);
    expect(keymap.labelFor('file.newFile')).toBe('Ctrl+N');
    expect(keymap.commandFor('Alt+N')?.id).toBe('file.newFile');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('reserved keys', () => {
  it('has the keys Chromium keeps in a tab (checked) and gives them back in an app window', () => {
    const tab = reservedKeys(context('chromium', 'linux'));
    for (const key of ['Mod+N', 'Mod+Shift+N', 'Mod+T', 'Mod+W', 'Mod+Shift+W', 'Mod+Tab', 'Mod+PageDown']) expect(tab.has(key), key).toBe(true);
    expect(tab.get('Mod+N')).toEqual({ keybind: 'Mod+N', by: 'Chrome', what: 'to open a new window', keptInAppWindow: false });
    // Pages can take these (checked), so they aren't in the table.
    for (const key of ['Mod+P', 'Mod+O', 'Mod+S', 'Mod+Shift+O', 'Mod+Shift+S', 'Mod+Shift+E', 'Mod+Shift+P', 'Mod+Shift+C', 'F12', 'Alt+N']) expect(tab.has(key), key).toBe(false);
    const app = reservedKeys(context('chromium', 'linux', true));
    expect(app.has('Mod+N')).toBe(false);
    // The OS still has its keys.
    expect(app.get('Alt+F4')).toMatchObject({ by: 'your system', keptInAppWindow: true });
  });

  it('has Firefox keys, including Ctrl+Shift+E off a Mac, and keeps them in fullscreen', () => {
    const linux = reservedKeys(context('firefox', 'linux', true));
    for (const key of ['Mod+N', 'Mod+Shift+N', 'Mod+Shift+P', 'Mod+Shift+E', 'Mod+Q']) expect(linux.has(key), key).toBe(true);
    expect(reservedKeys(context('firefox', 'windows')).has('Mod+Q')).toBe(false);
    expect(reservedKeys(context('firefox', 'mac')).has('Mod+Shift+E')).toBe(false);
    expect(reservedKeys(context('firefox', 'mac')).has('Ctrl+Tab')).toBe(true);
  });

  it('has Safari and macOS keys', () => {
    const safari = reservedKeys(context('safari', 'mac'));
    expect(safari.get('Mod+N')).toMatchObject({ by: 'Safari' });
    expect(safari.get('Mod+H')).toMatchObject({ by: 'macOS', what: 'to hide the app' });
    expect(safari.get('Ctrl+Tab')).toBeDefined();
    // On a Mac, Ctrl is its own key, so Ctrl+N is free.
    expect(safari.has('Ctrl+N')).toBe(false);
  });

  it('says where every entry came from', () => {
    for (const entry of reservedKeyTable) expect(['linux-chromium', 'docs']).toContain(entry.checked);
    expect(reservedKeyTable.filter((entry) => entry.checked === 'linux-chromium').every((entry) => entry.browsers !== 'all' && entry.browsers.includes('chromium'))).toBe(true);
  });

  it('leaves no built-in shortcut on a kept key, in any browser, OS or window', () => {
    const browsers: BrowserFamily[] = ['chromium', 'firefox', 'safari', 'other'];
    const systems: KeyOs[] = ['windows', 'linux', 'chromeos', 'mac', 'ios', 'android', 'other'];
    for (const browser of browsers) {
      for (const os of systems) {
        for (const appWindow of [false, true]) {
          const where = context(browser, os, appWindow);
          const kept = reservedKeys(where);
          const keymap = createKeymap(shortcuts, () => where.platform, undefined, () => kept);
          for (const { id, native } of shortcuts) {
            if (native) continue;
            const main = keymap.keybindsFor(id)[0];
            expect(main, `${id} in ${browser} on ${os}${appWindow ? ' (app)' : ''}`).toBeDefined();
            expect(kept.has(main), `${id} uses ${main} in ${browser} on ${os}${appWindow ? ' (app)' : ''}`).toBe(false);
          }
        }
      }
    }
  });

  it('uses the fallbacks only where they are needed', () => {
    const label = (where: KeyContext, id: 'file.new' | 'file.newFile' | 'file.export') =>
      createKeymap(shortcuts, () => where.platform, undefined, () => reservedKeys(where)).labelFor(id);
    expect(label(context('chromium', 'windows'), 'file.newFile')).toBe('Alt+N');
    expect(label(context('chromium', 'windows'), 'file.new')).toBe('Alt+Shift+N');
    expect(label(context('chromium', 'windows'), 'file.export')).toBe('Ctrl+Shift+E');
    expect(label(context('chromium', 'windows', true), 'file.newFile')).toBe('Ctrl+N');
    expect(label(context('firefox', 'linux'), 'file.export')).toBe('Alt+Shift+E');
    expect(label(context('firefox', 'mac'), 'file.export')).toBe('⇧⌘E');
    expect(label(context('safari', 'mac'), 'file.newFile')).toBe('⌥⌘N');
    expect(label(context('safari', 'mac'), 'file.new')).toBe('⌥⇧⌘N');
    expect(label(context('chromium', 'mac', true), 'file.new')).toBe('⇧⌘N');
  });
});
