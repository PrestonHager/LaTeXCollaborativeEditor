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
