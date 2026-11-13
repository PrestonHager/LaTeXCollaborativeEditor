import { detectPlatform, normalizeKeybind, type Platform } from '../ui/modifierShortcutLabels';

/**
 * Keys a browser or the OS keeps for itself, so a page never gets the keydown and preventDefault can't stop them.
 * The keymap (app/keymap.ts) uses this to switch a built-in shortcut to its fallback key where its main key
 * is taken, and Settings warns about these keys. Keybinds are written the stored way (see modifierShortcutLabels.ts):
 * `Mod` is Cmd on a Mac and Ctrl everywhere else, and `Ctrl` in a Mac entry is the Control key.
 *
 * `checked` says where an entry comes from:
 * - 'linux-chromium': pressed for real (XTEST key events on an X display) in Chromium 153 on Linux,
 *   in a normal tab and in an `--app=` window. See "How these were checked" in docs/keyboard-shortcuts.md.
 * - 'docs': from the browser's source or help pages, not pressed here. Firefox and Safari weren't available to test.
 *
 * Keys that browsers use but let pages take were checked too and are left out on purpose: in Chromium on Linux,
 * Ctrl+P, Ctrl+O, Ctrl+S, Ctrl+Shift+O, Ctrl+Shift+S, Ctrl+Shift+E, Ctrl+Shift+T (with no closed tab to reopen),
 * Ctrl+Shift+P, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, F12, Ctrl+Shift+B, Ctrl+L, Ctrl+H, Ctrl+J, Ctrl+D, Ctrl+1,
 * Ctrl+Q and Ctrl+Shift+Q all reached the page, and preventDefault kept the browser from acting on them.
 */

export type BrowserFamily = 'chromium' | 'firefox' | 'safari' | 'other';
export type KeyOs = 'mac' | 'windows' | 'linux' | 'chromeos' | 'ios' | 'android' | 'other';

/** Where the page is running, which decides what the browser keeps. */
export type KeyContext = {
  browser: BrowserFamily;
  /** What to call the browser in messages, like "Chrome" or "Edge". */
  browserName: string;
  os: KeyOs;
  platform: Platform;
  /**
   * In its own window: an installed app, a "Create shortcut, Open as window" window, or browser fullscreen (F11).
   * Chromium hands its reserved keys to the page there (checked); other browsers aren't known to.
   */
  appWindow: boolean;
};

/**
 * Why a key doesn't reach the page, for Settings: "{by} uses {key} {what}".
 * `keptInAppWindow` is true when an installed app window wouldn't get it either.
 */
export type ReservedKey = { keybind: string; by: string; what: string; keptInAppWindow: boolean };

type Entry = {
  keys: string[];
  what: string;
  browsers: BrowserFamily[] | 'all';
  os?: KeyOs[];
  /** The OS takes it, so it isn't the browser's, and an app window doesn't help. */
  system?: string;
  /** Still kept in an app window. Chromium's browser keys aren't (checked); unchecked browsers are assumed to keep them. */
  keptInAppWindow?: boolean;
  checked: 'linux-chromium' | 'docs';
};

const OTHER_OS: KeyOs[] = ['windows', 'linux', 'chromeos', 'other'];
const APPLE: KeyOs[] = ['mac', 'ios'];

/**
 * Sources:
 * - Chromium: BrowserCommandController::IsReservedCommandOrKey in chrome/browser/ui/browser_command_controller.cc
 *   reserves new window, new incognito window, new tab, close tab, close window, reopen closed tab, next and previous tab,
 *   and quit, except in app windows and fullscreen. Chrome help, "Chrome keyboard shortcuts".
 * - Firefox: the <key reserved="true"> entries in browser/base/content/browser-sets.inc, and
 *   support.mozilla.org "Keyboard shortcuts - Perform common Firefox tasks quickly". A site can be allowed to
 *   take them in Page Info > Permissions > Override keyboard shortcuts.
 * - Safari: support.apple.com "Keyboard shortcuts and gestures in Safari on Mac".
 * - macOS: support.apple.com "Mac keyboard shortcuts".
 */
const ENTRIES: Entry[] = [
  // Chromium (Chrome, Edge, Opera, Brave, Vivaldi).
  { keys: ['Mod+N'], what: 'to open a new window', browsers: ['chromium', 'other'], checked: 'linux-chromium' },
  { keys: ['Mod+Shift+N'], what: 'to open a private window', browsers: ['chromium', 'other'], checked: 'linux-chromium' },
  { keys: ['Mod+T'], what: 'to open a new tab', browsers: ['chromium', 'other'], checked: 'linux-chromium' },
  { keys: ['Mod+W'], what: 'to close the tab', browsers: ['chromium', 'other'], checked: 'linux-chromium' },
  { keys: ['Mod+Shift+W'], what: 'to close the window', browsers: ['chromium', 'other'], checked: 'linux-chromium' },
  // Only once a closed tab can be reopened. With none, it reached the page in the check.
  { keys: ['Mod+Shift+T'], what: 'to reopen a closed tab', browsers: ['chromium', 'other'], checked: 'docs' },
  { keys: ['Mod+Tab', 'Mod+Shift+Tab', 'Mod+PageDown', 'Mod+PageUp'], what: 'to switch tabs', browsers: ['chromium', 'other'], os: OTHER_OS, checked: 'linux-chromium' },
  { keys: ['Ctrl+Tab', 'Ctrl+Shift+Tab'], what: 'to switch tabs', browsers: ['chromium', 'other'], os: APPLE, checked: 'docs' },
  { keys: ['Mod+F4'], what: 'to close the tab', browsers: ['chromium', 'other'], os: ['windows'], checked: 'docs' },

  // Firefox. Nothing is checked here: Firefox wasn't available. Its reserved keys are assumed to stay in fullscreen too.
  { keys: ['Mod+N'], what: 'to open a new window', browsers: ['firefox'], keptInAppWindow: true, checked: 'docs' },
  { keys: ['Mod+Shift+N'], what: 'to reopen a closed window', browsers: ['firefox'], keptInAppWindow: true, checked: 'docs' },
  { keys: ['Mod+Shift+P'], what: 'to open a private window', browsers: ['firefox'], keptInAppWindow: true, checked: 'docs' },
  { keys: ['Mod+T'], what: 'to open a new tab', browsers: ['firefox'], keptInAppWindow: true, checked: 'docs' },
  { keys: ['Mod+Shift+T'], what: 'to reopen a closed tab', browsers: ['firefox'], keptInAppWindow: true, checked: 'docs' },
  { keys: ['Mod+W'], what: 'to close the tab', browsers: ['firefox'], keptInAppWindow: true, checked: 'docs' },
  { keys: ['Mod+Shift+W'], what: 'to close the window', browsers: ['firefox'], keptInAppWindow: true, checked: 'docs' },
  { keys: ['Mod+Tab', 'Mod+Shift+Tab', 'Mod+PageDown', 'Mod+PageUp'], what: 'to switch tabs', browsers: ['firefox'], os: OTHER_OS, keptInAppWindow: true, checked: 'docs' },
  { keys: ['Ctrl+Tab', 'Ctrl+Shift+Tab'], what: 'to switch tabs', browsers: ['firefox'], os: APPLE, keptInAppWindow: true, checked: 'docs' },
  { keys: ['Mod+Q'], what: 'to quit', browsers: ['firefox'], os: ['linux', 'mac'], keptInAppWindow: true, checked: 'docs' },
  // Opens the Network Monitor on Windows and Linux (it's ⌥⌘E on a Mac). Not known to be reserved, but treated
  // as taken so Export never depends on it there.
  { keys: ['Mod+Shift+E'], what: 'to open the Network Monitor', browsers: ['firefox'], os: ['windows', 'linux', 'chromeos', 'other'], keptInAppWindow: true, checked: 'docs' },

  // Safari, on a Mac and on an iPad or iPhone with a keyboard. Every iOS browser is Safari underneath.
  { keys: ['Mod+N'], what: 'to open a new window', browsers: ['safari'], keptInAppWindow: true, checked: 'docs' },
  { keys: ['Mod+Shift+N'], what: 'to open a private window', browsers: ['safari'], keptInAppWindow: true, checked: 'docs' },
  { keys: ['Mod+T'], what: 'to open a new tab', browsers: ['safari'], keptInAppWindow: true, checked: 'docs' },
  { keys: ['Mod+W'], what: 'to close the tab', browsers: ['safari'], keptInAppWindow: true, checked: 'docs' },
  { keys: ['Ctrl+Tab', 'Ctrl+Shift+Tab'], what: 'to switch tabs', browsers: ['safari'], keptInAppWindow: true, checked: 'docs' },

  // The OS, whatever the browser or window.
  { keys: ['Mod+Q'], what: 'to quit', browsers: 'all', os: APPLE, system: 'macOS', keptInAppWindow: true, checked: 'docs' },
  { keys: ['Mod+H'], what: 'to hide the app', browsers: 'all', os: ['mac'], system: 'macOS', keptInAppWindow: true, checked: 'docs' },
  { keys: ['Mod+M'], what: 'to minimize the window', browsers: 'all', os: ['mac'], system: 'macOS', keptInAppWindow: true, checked: 'docs' },
  { keys: ['Mod+Tab', 'Mod+Space'], what: 'to switch apps or search', browsers: 'all', os: APPLE, system: 'macOS', keptInAppWindow: true, checked: 'docs' },
  { keys: ['Alt+Tab', 'Alt+F4'], what: 'to switch or close windows', browsers: 'all', os: ['windows', 'linux', 'chromeos'], system: 'your system', keptInAppWindow: true, checked: 'docs' },
];

const appliesTo = (entry: Entry, context: KeyContext) =>
  (entry.browsers === 'all' || entry.browsers.includes(context.browser)) &&
  (!entry.os || entry.os.includes(context.os)) &&
  (!context.appWindow || Boolean(entry.keptInAppWindow));

/** Every key kept in this context, by stored keybind. */
export function reservedKeys(context: KeyContext | null | undefined): Map<string, ReservedKey> {
  const out = new Map<string, ReservedKey>();
  if (!context) return out;
  for (const entry of ENTRIES) {
    if (!appliesTo(entry, context)) continue;
    for (const key of entry.keys) {
      const keybind = normalizeKeybind(key, context.platform);
      if (keybind && !out.has(keybind)) {
        out.set(keybind, { keybind, by: entry.system ?? context.browserName, what: entry.what, keptInAppWindow: Boolean(entry.keptInAppWindow) });
      }
    }
  }
  return out;
}

/** Every entry, for tests and the docs. */
export const reservedKeyTable: readonly Readonly<Entry>[] = ENTRIES;

type NavigatorLike = Pick<Navigator, 'userAgent'> & { userAgentData?: { brands?: { brand: string }[]; platform?: string }; maxTouchPoints?: number; platform?: string };

/** The browser engine family and its name, from the user agent. Every iOS browser is Safari underneath. */
export function detectBrowser(nav: NavigatorLike | undefined = globalThis.navigator): { browser: BrowserFamily; browserName: string } {
  try {
    return browserFrom(nav);
  } catch {
    return { browser: 'other', browserName: 'Your browser' };
  }
}

function browserFrom(nav: NavigatorLike | undefined): { browser: BrowserFamily; browserName: string } {
  const ua = nav?.userAgent ?? '';
  const brands = (nav?.userAgentData?.brands ?? []).map((b) => b.brand);
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1)) return { browser: 'safari', browserName: 'Safari' };
  if (/Firefox\//.test(ua)) return { browser: 'firefox', browserName: 'Firefox' };
  if (/Edg\//.test(ua) || brands.includes('Microsoft Edge')) return { browser: 'chromium', browserName: 'Edge' };
  if (/OPR\//.test(ua) || brands.includes('Opera')) return { browser: 'chromium', browserName: 'Opera' };
  if (/Chrome\/|Chromium\//.test(ua) || brands.some((b) => /Chrom/.test(b))) return { browser: 'chromium', browserName: 'Chrome' };
  if (/Safari\//.test(ua) && /AppleWebKit\//.test(ua)) return { browser: 'safari', browserName: 'Safari' };
  return { browser: 'other', browserName: 'Your browser' };
}

/** The OS, from the user agent. iPadOS says it's a Mac, so a touch screen marks it. */
export function detectOs(nav: NavigatorLike | undefined = globalThis.navigator): KeyOs {
  try {
    return osFrom(nav);
  } catch {
    return 'other';
  }
}

function osFrom(nav: NavigatorLike | undefined): KeyOs {
  const ua = nav?.userAgent ?? '';
  const platform = nav?.userAgentData?.platform || nav?.platform || '';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/CrOS/.test(ua) || /Chrome OS/i.test(platform)) return 'chromeos';
  if (/Mac/i.test(platform) || /Macintosh|Mac OS X/.test(ua)) return 'mac';
  if (/Win/i.test(platform) || /Windows/.test(ua)) return 'windows';
  if (/Linux|X11/i.test(platform) || /Linux|X11/.test(ua)) return 'linux';
  return 'other';
}

/** The display modes where the page has its own window. Browser fullscreen (F11) counts; element fullscreen doesn't (checked). */
export const APP_DISPLAY_MODES = ['standalone', 'minimal-ui', 'window-controls-overlay', 'fullscreen'] as const;

/** Whether the page is in its own window, from the display-mode media queries. */
export function detectAppWindow(win: Pick<Window, 'matchMedia'> | undefined = globalThis.window): boolean {
  if (!win?.matchMedia) return false;
  return APP_DISPLAY_MODES.some((mode) => {
    try {
      return win.matchMedia(`(display-mode: ${mode})`).matches;
    } catch {
      return false;
    }
  });
}

/** A context that assumes the most: a Chromium-like browser in a tab, so every fallback is shown. */
export const FALLBACK_KEY_CONTEXT: KeyContext = { browser: 'other', browserName: 'Your browser', os: 'other', platform: 'other', appWindow: false };

/**
 * Where the page runs now. It never throws: some browsers throw on navigator or matchMedia in locked-down modes,
 * and this runs at startup, before the page joins a room.
 */
export function detectKeyContext(win: (Pick<Window, 'matchMedia'> & { navigator?: Navigator }) | undefined = globalThis.window): KeyContext {
  try {
    const nav = win?.navigator;
    return { ...detectBrowser(nav), os: detectOs(nav), platform: detectPlatform(nav), appWindow: detectAppWindow(win) };
  } catch {
    return { ...FALLBACK_KEY_CONTEXT, platform: detectPlatform() };
  }
}

type Query = Pick<MediaQueryList, 'matches'> & Partial<Pick<MediaQueryList, 'addEventListener' | 'removeEventListener' | 'addListener' | 'removeListener'>>;

/** Listen for a media query change, with the old addListener for Safari before 14. Returns how to stop, or null. */
function listen(query: Query, listener: () => void): (() => void) | null {
  try {
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', listener);
      return () => query.removeEventListener?.('change', listener);
    }
    if (typeof query.addListener === 'function') {
      query.addListener(listener);
      return () => query.removeListener?.(listener);
    }
  } catch {
    // Can't follow this one. The context just won't update when it changes.
  }
  return null;
}

/**
 * Follow the key context as the window changes, like going fullscreen or the page opening in an app window.
 * Calls onChange with the new context when it changes. Returns the current one and a way to stop.
 * Nothing here throws: if the browser can't tell, the page keeps the context it started with.
 */
export function watchKeyContext(onChange: (context: KeyContext) => void, win: Window | undefined = globalThis.window) {
  let context = detectKeyContext(win);
  const update = () => {
    const next = detectKeyContext(win);
    if (next.appWindow === context.appWindow) return;
    context = next;
    try {
      onChange(context);
    } catch (error) {
      console.warn('Updating shortcuts for the window failed', error);
    }
  };
  const stops: (() => void)[] = [];
  for (const mode of APP_DISPLAY_MODES) {
    try {
      const query = typeof win?.matchMedia === 'function' ? win.matchMedia(`(display-mode: ${mode})`) : null;
      const stop = query ? listen(query, update) : null;
      if (stop) stops.push(stop);
    } catch {
      // This display mode can't be watched here.
    }
  }
  return {
    current: () => context,
    stop: () =>
      stops.forEach((stop) => {
        try {
          stop();
        } catch {
          // Already gone.
        }
      }),
  };
}

/** Say what kind of window this is, for Settings: "Chrome in a browser tab" or "Chrome in its own window". */
export function describeKeyContext(context: KeyContext): string {
  return `${context.browserName} ${context.appWindow ? 'in its own window' : 'in a browser tab'}`;
}
