import { NARROW_FRAME_PX, READABLE_TEXT_PX, ZOOM_MAX, ZOOM_MIN, clampZoom, previewZoomCss, zoomAttribute, type PreviewZoom } from './previewZoom';

/** Sandbox flags for the preview iframe. No allow-same-origin, so peer content can't reach the app. */
export const PREVIEW_SANDBOX = 'allow-scripts';

export type PreviewDisplayTheme = 'light' | 'dark';

type PreviewColors = {
  background: string;
  text: string;
  link: string;
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
    loadingBackground: 'rgba(255, 255, 255, 0.82)',
    loadingText: '#222222',
  },
  dark: {
    background: '#1a1a1a',
    text: '#e0e0e0',
    link: '#8ab4ff',
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
    `:root{color-scheme:${theme};background:${c.background};color:${c.text};}` +
    `a:link,a:visited{color:${c.link};}` +
    // LaTeX.js draws pictures with a hard-coded black stroke, and filled shapes and arrow
    // heads with the SVG default fill (black). Draw them in the text color instead.
    `svg{fill:currentColor;}svg[stroke="#000000"],svg [stroke="#000000"]{stroke:currentColor;}svg [fill="#000000"]{fill:currentColor;}` +
    pageBreakCss(c.background)
  );
}

/**
 * How a \newpage, \clearpage or \pagebreak looks: a dashed line with a small "page break" label.
 * It's for the screen only, so a printout or a PDF just starts a new page there, with nothing
 * drawn. The block itself (markPageBreaks in latexJsPreview.ts) does the breaking. The label is
 * CSS content, so it isn't part of the document's text when copied.
 */
export function pageBreakCss(background: string): string {
  return (
    '@media screen{.lc-page-break{position:relative;height:0;margin:2em 0;border-top:1px dashed currentColor;opacity:.5;}' +
    `.lc-page-break::after{content:"page break";position:absolute;left:50%;top:0;transform:translate(-50%,-50%);padding:0 .5em;background:${background};` +
    'font:12px/1.4 system-ui,sans-serif;letter-spacing:.04em;}}'
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
/** Both ways: the app sets the zoom ("fit" or a scale), and the frame reports the scale Fit width or a pinch gave. */
export const PREVIEW_MESSAGE_ZOOM = 'lc-preview-zoom';
export const PREVIEW_ZOOM_STYLE_ID = 'lc-preview-zoom';

/** Schemes an external preview link may open with. Everything else is ignored. */
const EXTERNAL_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const MAX_EXTERNAL_URL_LENGTH = 4096;

/**
 * The script we put in the preview document. It's a fixed string from our own code, so the
 * Content Security Policy in index.html can allow it by its hash (the srcdoc frame inherits that
 * policy, which has no 'unsafe-inline' for scripts). Change it and that hash must change too;
 * src/security/cspPolicy.test.ts prints the new one. Nothing in it comes from the document.
 * The scroll position comes from the script tag's data-scroll attribute, not the script text.
 *
 * - Links to `#id` (\ref, \hyperref and so on) scroll inside the frame. LaTeX.js sets <base> to
 *   its CDN, so if the browser followed them, the frame would load the CDN's page instead.
 * - Other links never navigate the frame. The script sends their href to the app, which checks
 *   it and opens it (see parsePreviewMessage). The sandbox has no allow-popups, so the frame
 *   can't open a tab itself.
 * - It reports the scroll position, so the next render starts where the reader was.
 * - It zooms the page (see previewZoom.ts). The starting zoom comes from the data-zoom attribute and later
 *   ones from the app's messages. Fit width works out its scale from the frame's width and the document's
 *   --size, and tells the app. A two-finger pinch, or Ctrl + wheel, zooms around the fingers or the pointer
 *   and tells the app the new scale. The browser's own pinch is off in the frame (touch-action in
 *   previewZoomCss, and Safari's gesture events), so the app itself never zooms from a pinch here.
 */
export const PREVIEW_LINK_SCRIPT =
  '(function(){' +
  'var c=document.currentScript,y=Math.max(0,Math.round(+(c&&c.getAttribute("data-scroll"))||0)),P=parent,' +
  `O=${JSON.stringify(PREVIEW_MESSAGE_OPEN_LINK)},S=${JSON.stringify(PREVIEW_MESSAGE_SCROLL)},Z=${JSON.stringify(PREVIEW_MESSAGE_ZOOM)},` +
  'D=document.documentElement,z=1,f=0,p=null;' +
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
  'document.addEventListener("DOMContentLoaded",back);addEventListener("load",back);' +
  // Zoom. cl: a scale in range, to two decimals. put: show a scale. set: "fit" or a scale.
  `function cl(v){v=+v;return isFinite(v)?Math.round(Math.min(${ZOOM_MAX},Math.max(${ZOOM_MIN},v))*100)/100:1}` +
  'function put(v){z=v;D.style.setProperty("zoom",v===1?"":String(v))}' +
  `function fit(){if(innerWidth>${NARROW_FRAME_PX})return 1;var s=parseFloat(getComputedStyle(D).getPropertyValue("--size"))||${READABLE_TEXT_PX};` +
  `return cl(Math.max(1,${READABLE_TEXT_PX}/s))}` +
  'function set(v){f=v==="fit";put(f?fit():cl(v));if(f)P.postMessage({type:Z,zoom:z,fit:true},"*")}' +
  'set(c&&c.getAttribute("data-zoom")||1);' +
  'addEventListener("resize",function(){if(f)set("fit")});' +
  'addEventListener("message",function(e){var d=e.data;if(e.source===P&&d&&d.type===Z)set(d.zoom)});' +
  // Zoom to v around the point at height h in the frame, keeping that point where it is. True when it changed.
  'function at(v,h){var o=z,t=scrollY;v=cl(v);if(v===o)return false;f=0;put(v);scrollTo(scrollX,Math.max(0,(t+h)*v/o-h));return true}' +
  'function tell(){P.postMessage({type:Z,zoom:z,fit:false},"*")}' +
  'function gap(t){return Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY)||1}' +
  'var no={passive:false};' +
  'addEventListener("touchstart",function(e){if(e.touches.length===2){p={d:gap(e.touches),z:z,m:0};e.preventDefault()}},no);' +
  'addEventListener("touchmove",function(e){var t=e.touches;if(!p||t.length!==2)return;e.preventDefault();' +
  'if(at(p.z*gap(t)/p.d,(t[0].clientY+t[1].clientY)/2))p.m=1},no);' +
  'function end(e){if(p&&e.touches.length<2){if(p.m)tell();p=null}}' +
  'addEventListener("touchend",end);addEventListener("touchcancel",end);' +
  'function stop(e){e.preventDefault()}addEventListener("gesturestart",stop,no);addEventListener("gesturechange",stop,no);' +
  'addEventListener("wheel",function(e){if(!e.ctrlKey)return;e.preventDefault();' +
  'if(at(z*Math.exp(-Math.max(-50,Math.min(50,e.deltaY))/100),e.clientY))tell()},no)' +
  '})();';

/** A scroll position as a whole, non-negative number, for the script's data-scroll attribute. */
export function previewScrollPosition(scrollY: number): number {
  return Number.isFinite(scrollY) && scrollY > 0 ? Math.round(scrollY) : 0;
}

/**
 * The srcdoc for a LaTeX.js document: the theme style, the zoom style and the link script go at the
 * end of its <head>, after LaTeX.js's own styles. The script starts at `zoom` (see previewZoom.ts).
 */
export function previewDocument(html: string, theme: PreviewDisplayTheme, scrollY = 0, zoom: PreviewZoom = 1): string {
  const style = `<style id="${PREVIEW_ZOOM_STYLE_ID}">${previewZoomCss()}</style>`;
  const script = `<script id="${PREVIEW_LINK_SCRIPT_ID}" data-scroll="${previewScrollPosition(scrollY)}" data-zoom="${zoomAttribute(zoom)}">${PREVIEW_LINK_SCRIPT}</script>`;
  return insertAtHeadEnd(withPreviewTheme(html, theme), style + script);
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

export type PreviewMessage = { kind: 'open'; url: string } | { kind: 'scroll'; y: number } | { kind: 'zoom'; scale: number; fit: boolean };

/**
 * Check a message from the preview frame. It must come from our frame's window. The frame shows
 * documents peers wrote, so what it says is checked again here, as untrusted input.
 */
export function parsePreviewMessage(event: Pick<MessageEvent, 'source' | 'data'>, frameWindow: Window | null): PreviewMessage | null {
  if (!frameWindow || event.source !== frameWindow) return null;
  const data = event.data as { type?: unknown; url?: unknown; y?: unknown; zoom?: unknown; fit?: unknown } | null;
  if (!data || typeof data !== 'object') return null;
  if (data.type === PREVIEW_MESSAGE_OPEN_LINK) {
    const url = safeExternalUrl(data.url);
    return url ? { kind: 'open', url } : null;
  }
  if (data.type === PREVIEW_MESSAGE_SCROLL && typeof data.y === 'number' && Number.isFinite(data.y) && data.y >= 0) {
    return { kind: 'scroll', y: data.y };
  }
  if (data.type === PREVIEW_MESSAGE_ZOOM && typeof data.zoom === 'number' && Number.isFinite(data.zoom) && data.zoom > 0 && typeof data.fit === 'boolean') {
    return { kind: 'zoom', scale: clampZoom(data.zoom), fit: data.fit };
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

type PreviewPaneOptions = {
  /** The zoom the first render starts at. */
  zoom?: PreviewZoom;
  /** The frame showed a new scale: the one Fit width worked out to, or one the person pinched to. */
  onZoomReport?: (scale: number, fit: boolean) => void;
};

export function createPreviewPane(container: HTMLElement, initialTheme: PreviewDisplayTheme = 'light', options: PreviewPaneOptions = {}) {
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
  let zoom: PreviewZoom = options.zoom ?? 1;
  const sendZoom = () => frame.contentWindow?.postMessage({ type: PREVIEW_MESSAGE_ZOOM, zoom }, '*');
  // A zoom sent while a new render loads can reach the old document, so say it again once the new one is up.
  // The script also starts from data-zoom, so this only matters for that race.
  frame.addEventListener('load', sendZoom);

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
    } else if (message.kind === 'zoom') {
      // A pinch is the person's zoom now, so the next render starts there too.
      if (!message.fit) zoom = message.scale;
      options.onZoomReport?.(message.scale, message.fit);
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
      frame.srcdoc = previewDocument(html, theme, scrollY, zoom);
    },
    /**
     * Switch the rendered document between light and dark. The frame has no same-origin access,
     * so we render the last document again with the new colors.
     */
    setTheme(next: PreviewDisplayTheme) {
      if (next === theme) return;
      theme = next;
      applyFrameScheme();
      if (lastHtml !== null) frame.srcdoc = previewDocument(lastHtml, theme, scrollY, zoom);
    },
    get theme() {
      return theme;
    },
    /** Zoom the shown document without rendering it again, and start later renders there. */
    setZoom(next: PreviewZoom) {
      zoom = next;
      sendZoom();
    },
    get zoom() {
      return zoom;
    },
    setLoading(isLoading: boolean) {
      root.classList.toggle('is-loading', isLoading);
    },
  };
}
