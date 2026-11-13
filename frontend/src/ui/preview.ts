/** Sandbox flags for the preview iframe. No allow-same-origin, so peer content can't reach the app. */
export const PREVIEW_SANDBOX = 'allow-scripts';

export type PreviewDisplayTheme = 'light' | 'dark';

type PreviewColors = {
  background: string;
  text: string;
  link: string;
  noteText: string;
  noteBackground: string;
  noteBorder: string;
  loadingBackground: string;
  loadingText: string;
};

/**
 * Colors for the preview, used for both the pane (as --preview-* variables) and the rendered
 * document inside the frame, so the two always agree.
 */
export const PREVIEW_COLORS: Record<PreviewDisplayTheme, PreviewColors> = {
  light: {
    background: '#ffffff',
    text: '#111111',
    link: '#1a4fb2',
    noteText: '#555555',
    noteBackground: '#f6f6f6',
    noteBorder: '#dddddd',
    loadingBackground: 'rgba(255, 255, 255, 0.82)',
    loadingText: '#222222',
  },
  dark: {
    background: '#1a1a1a',
    text: '#e0e0e0',
    link: '#8ab4ff',
    noteText: '#b8b8b8',
    noteBackground: '#242424',
    noteBorder: '#3a3a3a',
    loadingBackground: 'rgba(0, 0, 0, 0.82)',
    loadingText: '#e0e0e0',
  },
};

export const PREVIEW_THEME_STYLE_ID = 'lc-preview-theme';

/**
 * The style we put in the preview document. LaTeX.js sets no colors of its own, so without this
 * the iframe falls back to the browser default (black text) whatever the preview theme is.
 * `color-scheme` keeps form controls, scrollbars and system colors on the same side.
 */
export function previewThemeCss(theme: PreviewDisplayTheme): string {
  const c = PREVIEW_COLORS[theme];
  return (
    `:root{color-scheme:${theme};background:${c.background};color:${c.text};` +
    `--lc-note-text:${c.noteText};--lc-note-bg:${c.noteBackground};--lc-note-border:${c.noteBorder};}` +
    `a:link,a:visited{color:${c.link};}` +
    // LaTeX.js draws pictures with a hard-coded black stroke, and filled shapes and arrow
    // heads with the SVG default fill (black). Draw them in the text color instead.
    `svg{fill:currentColor;}svg[stroke="#000000"],svg [stroke="#000000"]{stroke:currentColor;}svg [fill="#000000"]{fill:currentColor;}`
  );
}

/** Put the theme style at the end of the document's <head>, after LaTeX.js's own styles. */
export function withPreviewTheme(html: string, theme: PreviewDisplayTheme): string {
  return insertAtHeadEnd(html, `<style id="${PREVIEW_THEME_STYLE_ID}">${previewThemeCss(theme)}</style>`);
}

function insertAtHeadEnd(html: string, markup: string): string {
  const headEnd = html.search(/<\/head\s*>/i);
  if (headEnd !== -1) return html.slice(0, headEnd) + markup + html.slice(headEnd);
  return markup + html;
}

export const PREVIEW_LINK_SCRIPT_ID = 'lc-preview-links';

/** Message types the preview frame's link script posts to the app. */
export const PREVIEW_MESSAGE_OPEN_LINK = 'lc-preview-open-link';
export const PREVIEW_MESSAGE_SCROLL = 'lc-preview-scroll';

/** Schemes an external preview link may open with. Everything else is ignored. */
const EXTERNAL_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const MAX_EXTERNAL_URL_LENGTH = 4096;

/**
 * The script we put in the preview document. It's a fixed string from our own code. The only
 * value in it is the scroll position, a number we checked. Nothing comes from the document.
 *
 * - Links to `#id` (\ref, \hyperref and so on) scroll inside the frame. LaTeX.js sets <base> to
 *   its CDN, so if the browser followed them, the frame would load the CDN's page instead.
 * - Other links never navigate the frame. The script sends their href to the app, which checks
 *   it and opens it (see parsePreviewMessage). The sandbox has no allow-popups, so the frame
 *   can't open a tab itself.
 * - It reports the scroll position, so the next render starts where the reader was.
 */
export function previewLinkScript(scrollY: number): string {
  const y = Number.isFinite(scrollY) && scrollY > 0 ? Math.round(scrollY) : 0;
  return (
    '(function(){' +
    `var y=${y},P=parent,O=${JSON.stringify(PREVIEW_MESSAGE_OPEN_LINK)},S=${JSON.stringify(PREVIEW_MESSAGE_SCROLL)};` +
    'function link(e){var t=e.target;while(t&&t.nodeType!==1)t=t.parentNode;return t&&t.closest?t.closest("a[href]"):null}' +
    'function find(h){var id=h.slice(1);try{id=decodeURIComponent(id)}catch(x){}' +
    'return id?document.getElementById(id)||document.getElementsByName(id)[0]||null:null}' +
    'function go(e){if(e.defaultPrevented||(e.type==="auxclick"&&e.button!==1))return;var a=link(e);if(!a)return;' +
    'var h=a.getAttribute("href")||"";e.preventDefault();' +
    'if(h.charAt(0)==="#"){var t=find(h);if(t)t.scrollIntoView({block:"start"});return}' +
    'P.postMessage({type:O,url:h},"*")}' +
    'document.addEventListener("click",go);document.addEventListener("auxclick",go);' +
    'var q=0;addEventListener("scroll",function(){if(q)return;q=1;requestAnimationFrame(function(){q=0;' +
    'P.postMessage({type:S,y:scrollY},"*")})});' +
    'function back(){if(y)scrollTo(0,y)}' +
    'document.addEventListener("DOMContentLoaded",back);addEventListener("load",back)' +
    '})();'
  );
}

/**
 * The srcdoc for a LaTeX.js document: the theme style and the link script go at the end of its
 * <head>, after LaTeX.js's own styles.
 */
export function previewDocument(html: string, theme: PreviewDisplayTheme, scrollY = 0): string {
  const script = `<script id="${PREVIEW_LINK_SCRIPT_ID}">${previewLinkScript(scrollY)}</script>`;
  return insertAtHeadEnd(withPreviewTheme(html, theme), script);
}

/**
 * The URL to open for an external preview link, or null if we don't open it.
 * Only absolute http, https and mailto URLs pass. Relative links and every other scheme
 * (javascript:, data:, blob:, file: and so on) are dropped.
 */
export function safeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_EXTERNAL_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return EXTERNAL_LINK_PROTOCOLS.has(url.protocol) ? url.href : null;
}

export type PreviewMessage = { kind: 'open'; url: string } | { kind: 'scroll'; y: number };

/**
 * Check a message from the preview frame. It must come from our frame's window. The frame shows
 * documents peers wrote, so what it says is checked again here, as untrusted input.
 */
export function parsePreviewMessage(event: Pick<MessageEvent, 'source' | 'data'>, frameWindow: Window | null): PreviewMessage | null {
  if (!frameWindow || event.source !== frameWindow) return null;
  const data = event.data as { type?: unknown; url?: unknown; y?: unknown } | null;
  if (!data || typeof data !== 'object') return null;
  if (data.type === PREVIEW_MESSAGE_OPEN_LINK) {
    const url = safeExternalUrl(data.url);
    return url ? { kind: 'open', url } : null;
  }
  if (data.type === PREVIEW_MESSAGE_SCROLL && typeof data.y === 'number' && Number.isFinite(data.y) && data.y >= 0) {
    return { kind: 'scroll', y: data.y };
  }
  return null;
}

/** With no user activation API, open at most one preview link this often. */
export const LINK_OPEN_MIN_INTERVAL_MS = 1500;

type UserActivationLike = { isActive: boolean } | undefined;

/**
 * Decides whether a link-open request from the preview frame may go ahead. A click inside the
 * frame also activates the app (HTML spec: activation reaches ancestor frames), so we require
 * transient user activation. That stops script in the frame from opening tabs without a click.
 * Browsers without navigator.userActivation get a rate limit instead.
 */
export function createLinkOpenGate(
  getActivation: () => UserActivationLike = () => (navigator as Navigator & { userActivation?: UserActivationLike }).userActivation,
  now: () => number = () => Date.now(),
): () => boolean {
  let lastOpen = -Infinity;
  return () => {
    const activation = getActivation();
    if (activation) return activation.isActive;
    const t = now();
    if (t - lastOpen < LINK_OPEN_MIN_INTERVAL_MS) return false;
    lastOpen = t;
    return true;
  };
}

export function createPreviewPane(container: HTMLElement, initialTheme: PreviewDisplayTheme = 'light') {
  const root = document.createElement('div');
  root.className = 'preview';

  const content = document.createElement('div');
  content.className = 'preview-content';

  const frame = document.createElement('iframe');
  frame.className = 'preview-html-frame';
  frame.title = 'LaTeX preview';
  frame.setAttribute('sandbox', PREVIEW_SANDBOX);

  const loading = document.createElement('div');
  loading.className = 'preview-loading';
  loading.textContent = 'Updating preview...';

  content.appendChild(frame);
  root.appendChild(content);
  root.appendChild(loading);
  container.appendChild(root);

  let theme = initialTheme;
  let lastHtml: string | null = null;

  // The pane's colors come from the same theme as the document's. And when the frame's
  // color-scheme and its document's differ, browsers paint an opaque backdrop behind the
  // document, so keep the two the same.
  const applyFrameScheme = () => {
    const colors = PREVIEW_COLORS[theme];
    root.dataset.theme = theme;
    root.style.setProperty('--preview-bg', colors.background);
    root.style.setProperty('--preview-text', colors.text);
    root.style.setProperty('--preview-loading-bg', colors.loadingBackground);
    root.style.setProperty('--preview-loading-text', colors.loadingText);
    frame.style.colorScheme = theme;
  };
  applyFrameScheme();

  // The last scroll position the frame reported, so a new render starts there.
  let scrollY = 0;
  const mayOpenLink = createLinkOpenGate();
  window.addEventListener('message', (event) => {
    const message = parsePreviewMessage(event, frame.contentWindow);
    if (!message) {
      if (frame.contentWindow && event.source === frame.contentWindow) console.debug('Preview: dropped a message from the frame', event.data);
      return;
    }
    if (message.kind === 'scroll') {
      scrollY = message.y;
    } else if (!mayOpenLink()) {
      console.debug('Preview: dropped a link open with no recent click', message.url);
    } else {
      // noopener: the new tab gets no handle back to the app.
      window.open(message.url, '_blank', 'noopener,noreferrer');
    }
  });

  return {
    /** Full HTML document from LaTeX.js (styles load from CDN inside iframe). Keeps the scroll position. */
    async renderHtml(html: string) {
      lastHtml = html;
      frame.srcdoc = previewDocument(html, theme, scrollY);
    },
    /**
     * Switch the rendered document between light and dark. The frame has no same-origin access,
     * so we render the last document again with the new colors.
     */
    setTheme(next: PreviewDisplayTheme) {
      if (next === theme) return;
      theme = next;
      applyFrameScheme();
      if (lastHtml !== null) frame.srcdoc = previewDocument(lastHtml, theme, scrollY);
    },
    get theme() {
      return theme;
    },
    setLoading(isLoading: boolean) {
      root.classList.toggle('is-loading', isLoading);
    },
  };
}
