// What the desktop app (desktop/, docs/desktop.md) changes in the page, loaded lazily behind
// isDesktopShell() so the website never downloads it (issue #181):
// - external links open in the system browser, through the opener plugin (https only);
// - text that says "this browser" says "this app", since the app keeps its own storage.
// The shell itself also blocks navigation away from the app and sends https pop-ups to the
// browser (desktop/src-tauri/src/lib.rs), so this is the friendly path, not the only guard.
import { openInSystemBrowser } from './desktopShell';

/**
 * Rewrites for the page's built-in text, most specific first. Whole sentences where the browser
 * wording doesn't carry over ("other tabs", "your other browsers"), then the plain phrases.
 */
const DESKTOP_WORDING: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /saved in this browser profile only, so changing one here doesn't change it in your other browsers\./g,
    "saved in this app only, so changing one here doesn't change it in a browser.",
  ],
  [/saved in this browser and shared with its other tabs\./g, 'saved in this app.'],
  [/This browser is blocking storage, so settings only last until you close this tab\./g, "This app can't save settings right now, so they only last until you close it."],
  [/in this tab\./g, 'in this app.'],
  [/The file is made in this browser;/g, 'The file is made on this computer;'],
  [/that runs in your browser\./g, 'that runs on your computer.'],
  [/\bthis browser profile\b/g, 'this app'],
  [/\bthis browser\b/g, 'this app'],
  [/\bThis browser\b/g, 'This app'],
  [/^Browser storage$/g, 'App storage'],
];

/** The desktop app's wording for a piece of the page's text. Text with nothing to change comes back as is. */
export function desktopWording(text: string): string {
  if (!/browser|this tab/i.test(text)) return text;
  return DESKTOP_WORDING.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

/** Attributes whose text people read or hear. */
const TEXT_ATTRIBUTES = ['data-description', 'aria-label', 'title', 'placeholder'];
/** Never touched: what people typed, the editor and anything they wrote. */
const SKIP = '.cm-editor, [contenteditable], textarea, input, script, style, [data-desktop-wording="off"]';

/** Rewrite the static text of the page (menus, Settings, dialogs) for the desktop app. Returns how many strings changed. */
export function applyDesktopWording(root: ParentNode = document): number {
  let changed = 0;
  const doc = (root as Node).ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(SKIP)) continue;
    const next = desktopWording(node.nodeValue ?? '');
    if (next !== node.nodeValue) {
      node.nodeValue = next;
      changed += 1;
    }
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(TEXT_ATTRIBUTES.map((name) => `[${name}]`).join(',')))) {
    if (el.closest(SKIP) && !el.matches('input, textarea')) continue;
    for (const name of TEXT_ATTRIBUTES) {
      const value = el.getAttribute(name);
      if (value === null) continue;
      const next = desktopWording(value);
      if (next !== value) {
        el.setAttribute(name, next);
        changed += 1;
      }
    }
  }
  return changed;
}

type LinkOptions = {
  /** The web app's https address (webAppUrl), for the app's own pages like privacy.html, or null. */
  webApp: string | null;
  /** Opens a link in the system browser. Resolves false when it couldn't. */
  open?: (url: string) => Promise<boolean>;
  /** Called when a link couldn't be opened, with the link. */
  onFail?: (url: string) => void;
};

/**
 * Where a clicked link should go instead of this window, or null to leave the click alone:
 * - an https link to another site opens in the system browser;
 * - one of the app's own pages that would open a new window (privacy.html, tos.html) opens on the
 *   website, since the app has no second window;
 * - in-page links (#...) and links that stay in this window are left alone.
 */
export function externalTarget(href: string, target: string, here: string, webApp: string | null): string | null {
  let url: URL;
  try {
    url = new URL(href, here);
  } catch {
    return null;
  }
  const app = new URL(here);
  const sameApp = url.protocol === app.protocol && url.host === app.host;
  if (sameApp) {
    if (target !== '_blank' || !webApp) return null;
    const page = url.pathname.split('/').pop() ?? '';
    return /^[\w-]+\.html$/.test(page) ? new URL(page + url.search + url.hash, webApp).href : null;
  }
  return url.protocol === 'https:' ? url.href : null;
}

/**
 * Send link clicks that would leave the app to the system browser. http and other schemes are
 * blocked by the shell; this only opens https.
 */
export function routeExternalLinks(doc: Document, options: LinkOptions): () => void {
  const open = options.open ?? ((url: string) => openInSystemBrowser(url));
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button > 1) return;
    const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!link) return;
    const url = externalTarget(link.getAttribute('href') ?? '', link.target, doc.location.href, options.webApp);
    if (!url) return;
    event.preventDefault();
    void open(url).then((opened) => {
      if (!opened) options.onFail?.(url);
    });
  };
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('auxclick', onClick, true);
  return () => {
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('auxclick', onClick, true);
  };
}

/** Everything the desktop app changes in the page. Called once at startup, in the app only. */
export function setUpDesktopUi(doc: Document, options: LinkOptions): void {
  applyDesktopWording(doc.body);
  routeExternalLinks(doc, options);
}
