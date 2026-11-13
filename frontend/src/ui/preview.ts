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
  const style = `<style id="${PREVIEW_THEME_STYLE_ID}">${previewThemeCss(theme)}</style>`;
  const headEnd = html.search(/<\/head\s*>/i);
  if (headEnd !== -1) return html.slice(0, headEnd) + style + html.slice(headEnd);
  return style + html;
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

  return {
    /** Full HTML document from LaTeX.js (styles load from CDN inside iframe). */
    async renderHtml(html: string) {
      lastHtml = html;
      frame.srcdoc = withPreviewTheme(html, theme);
    },
    /**
     * Switch the rendered document between light and dark. The frame has no same-origin access,
     * so we render the last document again with the new colors.
     */
    setTheme(next: PreviewDisplayTheme) {
      if (next === theme) return;
      theme = next;
      applyFrameScheme();
      if (lastHtml !== null) frame.srcdoc = withPreviewTheme(lastHtml, theme);
    },
    get theme() {
      return theme;
    },
    setLoading(isLoading: boolean) {
      root.classList.toggle('is-loading', isLoading);
    },
  };
}
