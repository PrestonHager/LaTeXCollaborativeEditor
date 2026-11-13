import { createPreviewPane, PREVIEW_COLORS, PREVIEW_SANDBOX, PREVIEW_THEME_STYLE_ID, previewThemeCss, withPreviewTheme } from './preview';

describe('createPreviewPane', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('sandboxes the iframe without allow-same-origin', () => {
    createPreviewPane(document.body);
    const frame = document.querySelector('iframe')!;
    const flags = (frame.getAttribute('sandbox') ?? '').split(/\s+/);
    expect(frame.hasAttribute('sandbox')).toBe(true);
    expect(flags).not.toContain('allow-same-origin');
    expect(flags).toContain('allow-scripts');
    expect(frame.getAttribute('sandbox')).toBe(PREVIEW_SANDBOX);
  });

  it('renders html through srcdoc and toggles loading', async () => {
    const pane = createPreviewPane(document.body);
    const frame = document.querySelector('iframe')!;
    await pane.renderHtml('<p>hi</p>');
    expect(frame.srcdoc).toBe(withPreviewTheme('<p>hi</p>', 'light'));
    expect(frame.srcdoc).toContain('<p>hi</p>');

    const root = document.querySelector('.preview')!;
    pane.setLoading(true);
    expect(root.classList.contains('is-loading')).toBe(true);
    pane.setLoading(false);
    expect(root.classList.contains('is-loading')).toBe(false);
  });

  it('starts on the theme it is given and puts it on the frame', () => {
    const pane = createPreviewPane(document.body, 'dark');
    const frame = document.querySelector('iframe')!;
    expect(pane.theme).toBe('dark');
    // A frame whose color-scheme differs from its document's gets an opaque backdrop, so they must match.
    expect(frame.style.colorScheme).toBe('dark');
    expect((document.querySelector('.preview') as HTMLElement).dataset.theme).toBe('dark');
  });

  it('renders the document again in the new colors when the theme changes', async () => {
    const pane = createPreviewPane(document.body, 'light');
    const frame = document.querySelector('iframe')!;
    const html = '<html><head><title>t</title></head><body><p>hi</p></body></html>';
    await pane.renderHtml(html);
    expect(frame.srcdoc).toContain(`background:${PREVIEW_COLORS.light.background}`);

    pane.setTheme('dark');
    expect(pane.theme).toBe('dark');
    expect(frame.style.colorScheme).toBe('dark');
    expect((document.querySelector('.preview') as HTMLElement).style.getPropertyValue('--preview-bg')).toBe(PREVIEW_COLORS.dark.background);
    expect(frame.srcdoc).toBe(withPreviewTheme(html, 'dark'));
    expect(frame.srcdoc).toContain(`color:${PREVIEW_COLORS.dark.text}`);

    // The same theme again leaves the frame alone, so it doesn't reload.
    frame.srcdoc = 'untouched';
    pane.setTheme('dark');
    expect(frame.srcdoc).toBe('untouched');
  });

  it('switches theme before anything has rendered without touching the frame', () => {
    const pane = createPreviewPane(document.body);
    const frame = document.querySelector('iframe')!;
    pane.setTheme('dark');
    expect(frame.hasAttribute('srcdoc')).toBe(false);
    expect(frame.style.colorScheme).toBe('dark');
  });
});

describe('preview theme style', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it.each(['light', 'dark'] as const)('sets matching background, text and color-scheme for %s', (theme) => {
    const css = previewThemeCss(theme);
    const colors = PREVIEW_COLORS[theme];
    expect(css).toContain(`color-scheme:${theme}`);
    expect(css).toContain(`background:${colors.background}`);
    expect(css).toContain(`color:${colors.text}`);
    expect(css).toContain(`--lc-note-bg:${colors.noteBackground}`);
  });

  it('keeps text readable on its own background in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const { background, text, link, noteText, noteBackground } = PREVIEW_COLORS[theme];
      expect(contrast(text, background)).toBeGreaterThanOrEqual(7);
      expect(contrast(link, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(noteText, noteBackground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(['light', 'dark'] as const)('gives the pane the same %s colors as the document', (theme) => {
    createPreviewPane(document.body, theme);
    const root = document.querySelector('.preview') as HTMLElement;
    const colors = PREVIEW_COLORS[theme];
    expect(root.style.getPropertyValue('--preview-bg')).toBe(colors.background);
    expect(root.style.getPropertyValue('--preview-text')).toBe(colors.text);
    expect(root.style.getPropertyValue('--preview-loading-bg')).toBe(colors.loadingBackground);
    expect(root.style.getPropertyValue('--preview-loading-text')).toBe(colors.loadingText);
  });

  it('turns the black strokes and default fills LaTeX.js uses for pictures into the text color', () => {
    const css = previewThemeCss('dark');
    expect(css).toContain('svg{fill:currentColor;}');
    expect(css).toContain('svg[stroke="#000000"],svg [stroke="#000000"]{stroke:currentColor;}');
  });

  it('goes at the end of the head, after the LaTeX.js stylesheets', () => {
    const html = '<html><HEAD><link rel="stylesheet" href="base.css"></HEAD><body></body></html>';
    const themed = withPreviewTheme(html, 'dark');
    expect(themed.indexOf(`<style id="${PREVIEW_THEME_STYLE_ID}">`)).toBeGreaterThan(themed.indexOf('base.css'));
    expect(themed.indexOf(`id="${PREVIEW_THEME_STYLE_ID}"`)).toBeLessThan(themed.indexOf('</HEAD>'));
    const doc = new DOMParser().parseFromString(themed, 'text/html');
    expect(doc.head.lastElementChild?.id).toBe(PREVIEW_THEME_STYLE_ID);
  });

  it('goes first when the document has no head', () => {
    expect(withPreviewTheme('<p>hi</p>', 'light')).toMatch(new RegExp(`^<style id="${PREVIEW_THEME_STYLE_ID}">.*</style><p>hi</p>$`));
  });
});

/** WCAG contrast ratio between two #rrggbb colors. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
