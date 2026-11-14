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

/**
 * Where this copy of the app keeps its projects and settings, for UI text: "this browser" on the
 * web, "this app" in the desktop app, which keeps its own storage (docs/desktop.md).
 */
export function localPlace(win: object | undefined = globalThis.window): 'this browser' | 'this app' {
  return isDesktopShell(win) ? 'this app' : 'this browser';
}

/**
 * The notice shown when Google Drive's sign-in lapses and saves fall back to local storage. Says
 * "this app" in the desktop app, which keeps its own storage (issue #235).
 */
export function driveSessionLostNotice(win: object | undefined = globalThis.window): string {
  return `Google Drive sign-in expired, so edits are saving in ${localPlace(win)}. Use File > Connect Google Drive to switch back.`;
}

/**
 * In the desktop app, a stand-in for VITE_GOOGLE_CLIENT_ID: set when the shell was built with a
 * Google Desktop OAuth client, which it says in `__LCE_DESKTOP__` before the page loads (#177,
 * docs/desktop.md "Google sign-in"). The client id itself stays in the shell.
 */
export function desktopGoogleClient(win: object | undefined = globalThis.window): string | undefined {
  try {
    return (win as { __LCE_DESKTOP__?: { googleSignIn?: boolean } } | undefined)?.__LCE_DESKTOP__?.googleSignIn ? 'desktop' : undefined;
  } catch {
    return undefined;
  }
}
