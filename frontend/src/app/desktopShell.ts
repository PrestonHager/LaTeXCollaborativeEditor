/**
 * Whether the page runs inside the native desktop app (the Tauri shell in desktop/, issue #122,
 * docs/desktop.md). Tauri 2 defines `window.__TAURI_INTERNALS__` in every page it loads, even
 * with no Tauri APIs allowed, so this is a runtime check: the desktop app ships the same build as
 * the website, with no build flag. It never throws.
 */
export function isDesktopShell(win: object | undefined = globalThis.window): boolean {
  try {
    return Boolean(win) && '__TAURI_INTERNALS__' in (win as object);
  } catch {
    return false;
  }
}

type TauriInternals = { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> };

/**
 * Open an https link in the system browser, through the shell's opener plugin (its capability
 * only allows https URLs, docs/desktop.md). Resolves false outside the desktop app or when the
 * shell refuses, so the caller can fall back to copying the link.
 */
export async function openInSystemBrowser(url: string, win: object | undefined = globalThis.window): Promise<boolean> {
  if (!/^https:\/\//i.test(url) || !isDesktopShell(win)) return false;
  try {
    const internals = (win as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
    if (typeof internals?.invoke !== 'function') return false;
    await internals.invoke('plugin:opener|open_url', { url });
    return true;
  } catch (error) {
    console.warn('Could not open the link in the system browser', error);
    return false;
  }
}
