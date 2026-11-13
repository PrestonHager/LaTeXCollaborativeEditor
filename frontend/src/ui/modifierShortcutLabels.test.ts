import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  detectPlatform,
  formatKeybind,
  hasModKey,
  isAssignableKeybind,
  isMac,
  keybindFromEvent,
  normalizeKeybind,
} from './modifierShortcutLabels';

const nav = (platform: string, userAgent: string, uaPlatform?: string) =>
  ({ platform, userAgent, ...(uaPlatform === undefined ? {} : { userAgentData: { platform: uaPlatform } }) }) as unknown as Navigator;

const navigators = {
  mac: nav('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'),
  macUaData: nav('', 'Mozilla/5.0', 'macOS'),
  // iPadOS asks for desktop sites, so it says it's a Mac.
  ipad: nav('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.0 Safari'),
  iphone: nav('iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'),
  windows: nav('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Windows'),
  linux: nav('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)', 'Linux'),
  chromebook: nav('', 'Mozilla/5.0 (X11; CrOS x86_64)', 'Chrome OS'),
};

const press = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}, code = '') => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectPlatform', () => {
  it('finds Macs, iPads and iPhones', () => {
    expect(detectPlatform(navigators.mac)).toBe('mac');
    expect(detectPlatform(navigators.macUaData)).toBe('mac');
    expect(detectPlatform(navigators.ipad)).toBe('mac');
    expect(detectPlatform(navigators.iphone)).toBe('mac');
  });

  it('says other for Windows, Linux and ChromeOS', () => {
    expect(detectPlatform(navigators.windows)).toBe('other');
    expect(detectPlatform(navigators.linux)).toBe('other');
    expect(detectPlatform(navigators.chromebook)).toBe('other');
  });

  it('prefers userAgentData over the old platform string', () => {
    expect(detectPlatform(nav('MacIntel', '', 'Windows'))).toBe('other');
  });

  it('falls back to other without a navigator, or when reading it throws', () => {
    expect(detectPlatform(undefined)).toBe('other');
    const throwing = { userAgent: '' } as Navigator;
    Object.defineProperty(throwing, 'platform', {
      get() {
        throw new Error('blocked');
      },
    });
    expect(detectPlatform(throwing)).toBe('other');
  });

  it('reads the global navigator by default', () => {
    vi.stubGlobal('navigator', navigators.mac);
    expect(isMac()).toBe(true);
    vi.stubGlobal('navigator', navigators.windows);
    expect(isMac()).toBe(false);
  });
});

describe('formatKeybind', () => {
  it('uses Ctrl and plus signs off a Mac', () => {
    expect(formatKeybind('Mod+Shift+O', 'other')).toBe('Ctrl+Shift+O');
    expect(formatKeybind('Mod+,', 'other')).toBe('Ctrl+,');
    expect(formatKeybind('Mod+Enter', 'other')).toBe('Ctrl+Enter');
    expect(formatKeybind('Alt+ArrowUp', 'other')).toBe('Alt+Up');
    expect(formatKeybind('Meta+K', 'other')).toBe('Win+K');
    expect(formatKeybind('F5', 'other')).toBe('F5');
  });

  it('uses the Mac symbols in the Mac order', () => {
    expect(formatKeybind('Mod+Shift+O', 'mac')).toBe('⇧⌘O');
    expect(formatKeybind('Mod+P', 'mac')).toBe('⌘P');
    expect(formatKeybind('Mod+Enter', 'mac')).toBe('⌘↩');
    expect(formatKeybind('Mod+Ctrl+Alt+K', 'mac')).toBe('⌃⌥⌘K');
  });

  it('follows the current platform by default', () => {
    vi.stubGlobal('navigator', navigators.mac);
    expect(formatKeybind('Mod+S')).toBe('⌘S');
    vi.stubGlobal('navigator', navigators.linux);
    expect(formatKeybind('Mod+S')).toBe('Ctrl+S');
  });

  it('leaves text that is not a keybind alone', () => {
    expect(formatKeybind('Hyper+K', 'other')).toBe('Hyper+K');
  });
});

describe('normalizeKeybind', () => {
  it('puts modifiers in order and upper-cases the key', () => {
    expect(normalizeKeybind('shift+mod+o', 'other')).toBe('Mod+Shift+O');
    expect(normalizeKeybind('Alt+Mod+enter', 'mac')).toBe('Mod+Alt+Enter');
    expect(normalizeKeybind('Mod++', 'other')).toBe('Mod++');
  });

  it('treats Ctrl as Mod off a Mac, but not on one', () => {
    expect(normalizeKeybind('Ctrl+K', 'other')).toBe('Mod+K');
    expect(normalizeKeybind('Ctrl+K', 'mac')).toBe('Ctrl+K');
  });

  it('rejects things that are not keybinds', () => {
    expect(normalizeKeybind('', 'other')).toBeNull();
    expect(normalizeKeybind('Mod+Shift', 'other')).toBeNull();
    expect(normalizeKeybind('Hyper+K', 'other')).toBeNull();
  });
});

describe('hasModKey', () => {
  it('only counts Cmd on a Mac and Ctrl elsewhere', () => {
    expect(hasModKey(press('p', { metaKey: true }), 'mac')).toBe(true);
    expect(hasModKey(press('p', { ctrlKey: true }), 'mac')).toBe(false);
    expect(hasModKey(press('p', { ctrlKey: true }), 'other')).toBe(true);
    // The Windows key is not Ctrl.
    expect(hasModKey(press('p', { metaKey: true }), 'other')).toBe(false);
  });
});

describe('keybindFromEvent', () => {
  it('records Ctrl as Mod off a Mac, and the Windows key as Meta', () => {
    expect(keybindFromEvent(press('p', { ctrlKey: true }), 'other')).toBe('Mod+P');
    expect(keybindFromEvent(press('p', { metaKey: true }), 'other')).toBe('Meta+P');
    expect(keybindFromEvent(press('O', { ctrlKey: true, shiftKey: true }), 'other')).toBe('Mod+Shift+O');
  });

  it('records Cmd as Mod and Ctrl as Ctrl on a Mac', () => {
    expect(keybindFromEvent(press('p', { metaKey: true }), 'mac')).toBe('Mod+P');
    expect(keybindFromEvent(press('p', { ctrlKey: true }), 'mac')).toBe('Ctrl+P');
  });

  it('uses the key position when a modifier changed the character', () => {
    // Option+O types ø on a Mac.
    expect(keybindFromEvent(press('ø', { metaKey: true, altKey: true }, 'KeyO'), 'mac')).toBe('Mod+Alt+O');
    expect(keybindFromEvent(press('!', { ctrlKey: true, shiftKey: true }, 'Digit1'), 'other')).toBe('Mod+Shift+1');
    // ⌥⌘N can arrive as a dead key, since ⌥N starts ñ. With ⌘ held it's a shortcut, not typing.
    expect(keybindFromEvent(press('Dead', { metaKey: true, altKey: true }, 'KeyN'), 'mac')).toBe('Mod+Alt+N');
    // On its own, a dead key is typing.
    expect(keybindFromEvent(press('Dead', { altKey: true }, 'KeyN'), 'mac')).toBeNull();
    expect(keybindFromEvent(press('Dead', { metaKey: true }, 'Quote'), 'mac')).toBeNull();
  });

  it('keeps Shift out of symbols that already include it', () => {
    expect(keybindFromEvent(press('<', { ctrlKey: true, shiftKey: true }, 'Comma'), 'other')).toBe('Mod+<');
    expect(keybindFromEvent(press(',', { ctrlKey: true }, 'Comma'), 'other')).toBe('Mod+,');
  });

  it('names special keys', () => {
    expect(keybindFromEvent(press('Enter', { ctrlKey: true }), 'other')).toBe('Mod+Enter');
    expect(keybindFromEvent(press(' ', { altKey: true }, 'Space'), 'other')).toBe('Alt+Space');
    expect(keybindFromEvent(press('F5'), 'other')).toBe('F5');
  });

  it('ignores modifiers on their own and unknown keys', () => {
    expect(keybindFromEvent(press('Control', { ctrlKey: true }), 'other')).toBeNull();
    expect(keybindFromEvent(press('Shift', { shiftKey: true }), 'other')).toBeNull();
    expect(keybindFromEvent(press('Dead', { altKey: true }), 'mac')).toBeNull();
    expect(keybindFromEvent(press(''), 'other')).toBeNull();
  });
});

describe('isAssignableKeybind', () => {
  it('needs Ctrl, Cmd, Alt or Win so typing is never taken', () => {
    expect(isAssignableKeybind('Mod+K')).toBe(true);
    expect(isAssignableKeybind('Alt+K')).toBe(true);
    expect(isAssignableKeybind('Ctrl+K')).toBe(true);
    expect(isAssignableKeybind('Meta+K')).toBe(true);
    expect(isAssignableKeybind('K')).toBe(false);
    expect(isAssignableKeybind('Shift+K')).toBe(false);
    expect(isAssignableKeybind('Enter')).toBe(false);
    expect(isAssignableKeybind('Hyper+K')).toBe(false);
  });

  it('allows function keys on their own', () => {
    expect(isAssignableKeybind('F5')).toBe(true);
    expect(isAssignableKeybind('Shift+F12')).toBe(true);
    expect(isAssignableKeybind('F25')).toBe(false);
  });
});
