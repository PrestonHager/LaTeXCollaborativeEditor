import type { ThemeMode } from '../state/appSession';

export function resolveDisplayTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Keep the editor and preview themes, and put them on the page's root element. */
export function createThemeController() {
  let editorTheme: ThemeMode = 'system';
  let previewTheme: ThemeMode = 'system';

  function applyEditorTheme(theme: ThemeMode) {
    editorTheme = theme;
    const display = resolveDisplayTheme(theme);
    // Basecoat switches its own colors on the `dark` class.
    document.documentElement.classList.toggle('dark', display === 'dark');
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-editor-theme');
    } else {
      document.documentElement.setAttribute('data-editor-theme', theme);
    }
    document.documentElement.style.colorScheme = display === 'dark' ? 'dark' : 'light';
    window.dispatchEvent(new CustomEvent('editorthemechange'));
  }

  function applyPreviewTheme(theme: ThemeMode) {
    previewTheme = theme;
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-preview-theme');
    } else {
      document.documentElement.setAttribute('data-preview-theme', theme);
    }
    window.dispatchEvent(new CustomEvent('previewthemechange'));
  }

  /** Follow the OS when either theme is set to system. */
  function watchSystemTheme() {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (editorTheme === 'system') applyEditorTheme('system');
      if (previewTheme === 'system') applyPreviewTheme('system');
    });
  }

  return {
    get editorTheme() {
      return editorTheme;
    },
    get previewTheme() {
      return previewTheme;
    },
    /** The preview theme actually shown: light or dark, with system resolved from the OS. */
    get previewDisplayTheme() {
      return resolveDisplayTheme(previewTheme);
    },
    applyEditorTheme,
    applyPreviewTheme,
    watchSystemTheme,
  };
}

export type ThemeController = ReturnType<typeof createThemeController>;
