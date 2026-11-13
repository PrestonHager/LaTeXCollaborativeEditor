import {
  createLinkOpenGate,
  createPreviewPane,
  LINK_OPEN_MIN_INTERVAL_MS,
  parsePreviewMessage,
  PREVIEW_COLORS,
  PREVIEW_LINK_SCRIPT_ID,
  PREVIEW_MESSAGE_OPEN_LINK,
  PREVIEW_MESSAGE_SCROLL,
  PREVIEW_SANDBOX,
  PREVIEW_THEME_STYLE_ID,
  previewDocument,
  PREVIEW_LINK_SCRIPT,
  previewScrollPosition,
  previewThemeCss,
  safeExternalUrl,
  withPreviewTheme,
} from './preview';

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
    expect(frame.srcdoc).toBe(previewDocument('<p>hi</p>', 'light'));
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
    expect(frame.srcdoc).toBe(previewDocument(html, 'dark'));
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

describe('safeExternalUrl', () => {
  it('allows absolute http, https and mailto URLs', () => {
    expect(safeExternalUrl('https://example.com/a?b#c')).toBe('https://example.com/a?b#c');
    expect(safeExternalUrl('http://example.com')).toBe('http://example.com/');
    expect(safeExternalUrl('HTTPS://Example.com')).toBe('https://example.com/');
    expect(safeExternalUrl('mailto:someone@example.com')).toBe('mailto:someone@example.com');
  });

  it.each([
    'javascript:alert(1)',
    ' JaVa\tScRipt:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox',
    'blob:https://example.com/x',
    'file:///etc/passwd',
    'ftp://example.com',
    'about:blank',
    '#sec-1',
    '/relative',
    'example.com',
    '',
  ])('rejects %j', (url) => {
    expect(safeExternalUrl(url)).toBeNull();
  });

  it('rejects things that are not strings, and very long URLs', () => {
    expect(safeExternalUrl(undefined)).toBeNull();
    expect(safeExternalUrl({ toString: () => 'https://example.com' })).toBeNull();
    expect(safeExternalUrl(`https://example.com/${'a'.repeat(5000)}`)).toBeNull();
  });
});

describe('createLinkOpenGate', () => {
  it('follows user activation when the browser has it', () => {
    let isActive = false;
    const gate = createLinkOpenGate(() => ({ isActive }));
    expect(gate()).toBe(false);
    isActive = true;
    expect(gate()).toBe(true);
    expect(gate()).toBe(true);
  });

  it('falls back to at most one open per interval without it', () => {
    let t = 10_000;
    const gate = createLinkOpenGate(() => undefined, () => t);
    expect(gate()).toBe(true);
    t += LINK_OPEN_MIN_INTERVAL_MS - 1;
    expect(gate()).toBe(false);
    t += 1;
    expect(gate()).toBe(true);
    expect(gate()).toBe(false);
  });

  it('reads navigator.userActivation by default', () => {
    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: false } });
    try {
      expect(createLinkOpenGate()()).toBe(false);
    } finally {
      delete (navigator as unknown as Record<string, unknown>).userActivation;
    }
    expect(createLinkOpenGate()()).toBe(true);
  });
});

describe('parsePreviewMessage', () => {
  const frameWindow = {} as Window;
  const open = (url: unknown) => ({ type: PREVIEW_MESSAGE_OPEN_LINK, url });

  it('accepts an http(s) or mailto link from our frame', () => {
    expect(parsePreviewMessage({ source: frameWindow, data: open('https://example.com') }, frameWindow)).toEqual({
      kind: 'open',
      url: 'https://example.com/',
    });
    expect(parsePreviewMessage({ source: frameWindow, data: open('mailto:a@b.example') }, frameWindow)).toEqual({
      kind: 'open',
      url: 'mailto:a@b.example',
    });
  });

  it('ignores messages from any other window', () => {
    expect(parsePreviewMessage({ source: window, data: open('https://example.com') }, frameWindow)).toBeNull();
    expect(parsePreviewMessage({ source: null, data: open('https://example.com') }, frameWindow)).toBeNull();
    expect(parsePreviewMessage({ source: frameWindow, data: open('https://example.com') }, null)).toBeNull();
  });

  it('ignores javascript:, data: and other schemes, even from our frame', () => {
    expect(parsePreviewMessage({ source: frameWindow, data: open('javascript:alert(1)') }, frameWindow)).toBeNull();
    expect(parsePreviewMessage({ source: frameWindow, data: open('data:text/html,hi') }, frameWindow)).toBeNull();
    expect(parsePreviewMessage({ source: frameWindow, data: open('file:///x') }, frameWindow)).toBeNull();
    expect(parsePreviewMessage({ source: frameWindow, data: open(42) }, frameWindow)).toBeNull();
  });

  it('reads scroll positions and ignores bad ones', () => {
    const scroll = (y: unknown) => parsePreviewMessage({ source: frameWindow, data: { type: PREVIEW_MESSAGE_SCROLL, y } }, frameWindow);
    expect(scroll(120)).toEqual({ kind: 'scroll', y: 120 });
    expect(scroll(-1)).toBeNull();
    expect(scroll(Number.NaN)).toBeNull();
    expect(scroll(Infinity)).toBeNull();
    expect(scroll('120')).toBeNull();
  });

  it('ignores unknown and malformed messages', () => {
    for (const data of [null, 'hi', 7, {}, { type: 'other', url: 'https://example.com' }]) {
      expect(parsePreviewMessage({ source: frameWindow, data }, frameWindow)).toBeNull();
    }
  });
});

describe('preview link handling in the pane', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function postFromFrame(frame: HTMLIFrameElement, data: unknown, source: unknown = frame.contentWindow) {
    window.dispatchEvent(new MessageEvent('message', { data, source: source as Window }));
  }

  it('opens a checked external link in a new tab without an opener', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    createPreviewPane(document.body);
    const frame = document.querySelector('iframe')!;
    postFromFrame(frame, { type: PREVIEW_MESSAGE_OPEN_LINK, url: 'https://example.com/x' });
    expect(openSpy).toHaveBeenCalledWith('https://example.com/x', '_blank', 'noopener,noreferrer');
  });

  it('does not open links from another window or with an unsafe scheme', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    createPreviewPane(document.body);
    const frame = document.querySelector('iframe')!;
    postFromFrame(frame, { type: PREVIEW_MESSAGE_OPEN_LINK, url: 'https://example.com' }, window);
    postFromFrame(frame, { type: PREVIEW_MESSAGE_OPEN_LINK, url: 'javascript:alert(1)' });
    postFromFrame(frame, { type: PREVIEW_MESSAGE_OPEN_LINK, url: 'data:text/html,hi' });
    expect(openSpy).not.toHaveBeenCalled();
  });

  describe('with navigator.userActivation', () => {
    let isActive = false;
    beforeEach(() => {
      Object.defineProperty(navigator, 'userActivation', { configurable: true, get: () => ({ isActive }) });
    });
    afterEach(() => {
      delete (navigator as unknown as Record<string, unknown>).userActivation;
    });

    it('does not open a link with no user activation, and logs it', () => {
      isActive = false;
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
      const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
      createPreviewPane(document.body);
      const frame = document.querySelector('iframe')!;
      postFromFrame(frame, { type: PREVIEW_MESSAGE_OPEN_LINK, url: 'https://example.com/' });
      expect(openSpy).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalled();
    });

    it('opens a link while the user activation is active, every time', () => {
      isActive = true;
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
      createPreviewPane(document.body);
      const frame = document.querySelector('iframe')!;
      postFromFrame(frame, { type: PREVIEW_MESSAGE_OPEN_LINK, url: 'https://example.com/a' });
      postFromFrame(frame, { type: PREVIEW_MESSAGE_OPEN_LINK, url: 'https://example.com/b' });
      expect(openSpy).toHaveBeenCalledTimes(2);
    });
  });

  it('logs and drops a bad message from the frame, but ignores other windows quietly', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    createPreviewPane(document.body);
    const frame = document.querySelector('iframe')!;
    postFromFrame(frame, { type: 'whatever' }, window);
    expect(debug).not.toHaveBeenCalled();
    postFromFrame(frame, { type: PREVIEW_MESSAGE_OPEN_LINK, url: 'javascript:alert(1)' });
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('starts the next render at the last scroll position the frame reported', async () => {
    const pane = createPreviewPane(document.body);
    const frame = document.querySelector('iframe')!;
    await pane.renderHtml('<p>hi</p>');
    expect(frame.srcdoc).toContain('data-scroll="0"');
    postFromFrame(frame, { type: PREVIEW_MESSAGE_SCROLL, y: 345.6 });
    await pane.renderHtml('<p>hi again</p>');
    expect(frame.srcdoc).toBe(previewDocument('<p>hi again</p>', 'light', 345.6));
    expect(frame.srcdoc).toContain('data-scroll="346"');
    pane.setTheme('dark');
    expect(frame.srcdoc).toContain('data-scroll="346"');
  });
});

describe('preview link script', () => {
  it('goes in the head after the theme style and has nothing from the document in it', () => {
    const html = '<html><head><title>t</title></head><body><a href="#x">x</a></body></html>';
    const out = previewDocument(html, 'light', 10);
    const doc = new DOMParser().parseFromString(out, 'text/html');
    const script = doc.getElementById(PREVIEW_LINK_SCRIPT_ID)!;
    expect(script.parentElement).toBe(doc.head);
    expect(doc.head.lastElementChild).toBe(script);
    expect(script.previousElementSibling?.id).toBe(PREVIEW_THEME_STYLE_ID);
    expect(script.textContent).toBe(PREVIEW_LINK_SCRIPT);
    expect(script.getAttribute('data-scroll')).toBe('10');
    expect(PREVIEW_LINK_SCRIPT).not.toContain('</');
  });

  it('only puts a whole, non-negative number in for the scroll position', () => {
    expect(previewScrollPosition(12.4)).toBe(12);
    expect(previewScrollPosition(-5)).toBe(0);
    expect(previewScrollPosition(Number.NaN)).toBe(0);
    expect(previewScrollPosition(Infinity)).toBe(0);
    expect(previewDocument('<p>x</p>', 'light', 12.4)).toContain('data-scroll="12"');
  });

  describe('running in a page', () => {
    // The script adds listeners to this test document, so it runs once for the whole block.
    let postMessage: ReturnType<typeof vi.spyOn>;
    beforeAll(() => {
      new Function(PREVIEW_LINK_SCRIPT)();
    });
    beforeEach(() => {
      postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
      document.body.innerHTML =
        '<a id="internal" href="#sec-2"><span>2</span></a><a id="named" href="#n%20x">n</a>' +
        '<a id="external" href="https://example.com/">e</a><a id="missing">??</a>' +
        '<h2 id="sec-2">Results</h2><a name="n x"></a>';
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    function click(id: string, init: MouseEventInit = {}, type = 'click') {
      const target = document.getElementById(id)!;
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
      (target.firstElementChild ?? target).dispatchEvent(event);
      return event;
    }

    it('scrolls to the target of an in-page link instead of navigating', () => {
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      const event = click('internal');
      expect(event.defaultPrevented).toBe(true);
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.contexts[0]).toBe(document.getElementById('sec-2'));
      click('named');
      expect(scroll.mock.contexts[1]).toBe(document.getElementsByName('n x')[0]);
      expect(postMessage).not.toHaveBeenCalled();
    });

    it('sends an external link to the app instead of navigating the frame', () => {
      const event = click('external');
      expect(event.defaultPrevented).toBe(true);
      expect(postMessage).toHaveBeenCalledWith({ type: PREVIEW_MESSAGE_OPEN_LINK, url: 'https://example.com/' }, '*');
    });

    it('handles middle clicks but leaves other buttons and links without an href alone', () => {
      click('external', { button: 1 }, 'auxclick');
      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(click('external', { button: 2 }, 'auxclick').defaultPrevented).toBe(false);
      expect(click('missing').defaultPrevented).toBe(false);
      expect(postMessage).toHaveBeenCalledTimes(1);
    });
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
