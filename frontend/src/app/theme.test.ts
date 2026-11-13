import { createThemeController, resolveDisplayTheme } from './theme';

// jsdom has no matchMedia, so we fake one we can flip between dark and light.
function stubMatchMedia(dark: boolean) {
  const listeners: (() => void)[] = [];
  const media = {
    matches: dark,
    addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
  };
  vi.stubGlobal('matchMedia', () => media);
  return {
    flip(next: boolean) {
      media.matches = next;
      for (const listener of listeners) listener();
    },
  };
}

describe('theme', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-editor-theme');
    document.documentElement.removeAttribute('data-preview-theme');
  });

  it('resolves system to the OS setting', () => {
    stubMatchMedia(true);
    expect(resolveDisplayTheme('system')).toBe('dark');
    expect(resolveDisplayTheme('light')).toBe('light');
    expect(resolveDisplayTheme('dark')).toBe('dark');
  });

  it('puts the editor theme on the root element', () => {
    stubMatchMedia(false);
    const theme = createThemeController();
    const changed = vi.fn();
    window.addEventListener('editorthemechange', changed);
    theme.applyEditorTheme('dark');
    expect(theme.editorTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-editor-theme')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    theme.applyEditorTheme('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.hasAttribute('data-editor-theme')).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
    window.removeEventListener('editorthemechange', changed);
  });

  it('puts the preview theme on the root element', () => {
    stubMatchMedia(false);
    const theme = createThemeController();
    theme.applyPreviewTheme('light');
    expect(theme.previewTheme).toBe('light');
    expect(document.documentElement.getAttribute('data-preview-theme')).toBe('light');
    theme.applyPreviewTheme('system');
    expect(document.documentElement.hasAttribute('data-preview-theme')).toBe(false);
  });

  it('follows the OS only for themes set to system', () => {
    const media = stubMatchMedia(false);
    const theme = createThemeController();
    theme.applyEditorTheme('system');
    theme.applyPreviewTheme('light');
    theme.watchSystemTheme();
    const preview = vi.fn();
    window.addEventListener('previewthemechange', preview);
    media.flip(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(preview).not.toHaveBeenCalled();
    window.removeEventListener('previewthemechange', preview);
  });
});
