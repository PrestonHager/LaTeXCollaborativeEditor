import { describe, expect, it, vi, afterEach } from 'vitest';
import { formatPrimaryChord, primaryModifierLabel } from './modifierShortcutLabels';

const stubNavigator = (platform: string, userAgent: string) => {
  vi.stubGlobal('navigator', { platform, userAgent } as Navigator);
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('primaryModifierLabel', () => {
  it('returns Ctrl when navigator is undefined', () => {
    vi.stubGlobal('navigator', undefined as unknown as Navigator);
    expect(primaryModifierLabel()).toBe('Ctrl');
  });

  it('returns ⌘ for MacIntel', () => {
    stubNavigator('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    expect(primaryModifierLabel()).toBe('⌘');
  });

  it('returns ⌘ for iPad', () => {
    stubNavigator('iPad', 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X)');
    expect(primaryModifierLabel()).toBe('⌘');
  });

  it('returns Ctrl for Win32', () => {
    stubNavigator('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    expect(primaryModifierLabel()).toBe('Ctrl');
  });

  it('returns Ctrl for Linux', () => {
    stubNavigator('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)');
    expect(primaryModifierLabel()).toBe('Ctrl');
  });

  it('returns Ctrl when navigator.platform throws', () => {
    const nav = { get userAgent() {
      return '';
    } } as Navigator;
    Object.defineProperty(nav, 'platform', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    vi.stubGlobal('navigator', nav);
    expect(primaryModifierLabel()).toBe('Ctrl');
  });
});

describe('formatPrimaryChord', () => {
  it('joins modifier and rest', () => {
    stubNavigator('Win32', '');
    expect(formatPrimaryChord('N')).toBe('Ctrl+N');
    expect(formatPrimaryChord('Shift+O')).toBe('Ctrl+Shift+O');
  });

  it('uses ⌘ on Mac', () => {
    stubNavigator('MacIntel', 'Macintosh');
    expect(formatPrimaryChord('P')).toBe('⌘+P');
    expect(formatPrimaryChord('Shift+C')).toBe('⌘+Shift+C');
  });
});
