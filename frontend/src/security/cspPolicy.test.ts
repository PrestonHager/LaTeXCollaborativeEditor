import indexHtml from '../../index.html?raw';
import privacyHtml from '../../privacy.html?raw';
import tosHtml from '../../tos.html?raw';
import { cspAllows, cspFromHtml, parseCsp, sourceMatchesUrl } from './csp';
import { LATEX_JS_ASSET_BASE } from '../compile/latexJsPreview';
import { getBootstrapConfig } from '../net/bootstrapConfig';
import { PREVIEW_LINK_SCRIPT } from '../ui/preview';

const APP_ORIGIN = 'https://latex.prestonhager.com';
const policy = cspFromHtml(indexHtml);
const csp = parseCsp(policy ?? '');

// Every production source file, as text, to find the URLs the app uses.
const sources = import.meta.glob<string>(['../**/*.ts', '!../**/*.test.ts', '!../dev/**', '!../test/**', '!./csp.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * URLs in src/ that the page never fetches itself, so the CSP doesn't need to allow them.
 * Add new ones here with the reason, or allow them in the policy in index.html.
 */
const NOT_FETCHED: Record<string, string> = {
  'http://www.w3.org/1999/xhtml': 'XML namespace',
  'http://127.0.0.1:8000/': 'docs link (navigation) for MkDocs serve',
  'https://github.com/PrestonHager/LaTeXCollaborativeEditor': 'issue and security links (navigation)',
  'https://www.googleapis.com/auth/drive.file': 'OAuth scope name, not a request',
};

const FETCH_DIRECTIVES = ['script-src', 'style-src', 'connect-src', 'frame-src', 'img-src', 'font-src'];

/**
 * Hosts in the policy that no URL in src/ names, because Google's own scripts load them at
 * runtime: Google Identity Services (gsi/client) pulls its stylesheet and iframes, and the gapi
 * loader and Picker pull scripts, styles, images and frames from gstatic, googleusercontent,
 * drive.google.com and content.googleapis.com. We can't test those against real Google from CI,
 * so they're allowed up front to avoid breaking Drive in production. Keep anything else out.
 */
const GOOGLE_RUNTIME_SOURCES: Record<string, string[]> = {
  'script-src': ['https://www.gstatic.com', 'https://ssl.gstatic.com'],
  'style-src': ['https://accounts.google.com/gsi/style', 'https://www.gstatic.com', 'https://ssl.gstatic.com'],
  'img-src': ['https://*.gstatic.com', 'https://*.googleusercontent.com'],
  'frame-src': ['https://accounts.google.com/gsi/', 'https://docs.google.com', 'https://drive.google.com', 'https://content.googleapis.com'],
  'connect-src': ['https://accounts.google.com/gsi/', 'https://content.googleapis.com'],
};

function externalUrls(): Map<string, string> {
  const found = new Map<string, string>();
  for (const [file, text] of Object.entries(sources)) {
    for (const match of text.matchAll(/\b(?:https?|wss?):\/\/[^\s'"`<>)\\]+/g)) {
      // Drop template parts and query strings, which CSP ignores anyway.
      const url = match[0].split('${')[0].split('?')[0];
      if (!found.has(url)) found.set(url, file);
    }
  }
  return found;
}

describe('Content-Security-Policy in index.html', () => {
  it('is a meta tag in <head>, before any script', () => {
    expect(policy).not.toBeNull();
    const head = indexHtml.slice(0, indexHtml.indexOf('</head>'));
    expect(cspFromHtml(head)).toBe(policy);
    expect(indexHtml.indexOf('Content-Security-Policy')).toBeLessThan(indexHtml.indexOf('<script'));
  });

  it('sets the required directives', () => {
    expect(csp['default-src']).toEqual(["'self'"]);
    for (const directive of [...FETCH_DIRECTIVES, 'worker-src', 'object-src', 'base-uri', 'form-action']) {
      expect(csp[directive], directive).toBeDefined();
    }
    expect(csp['worker-src']).toEqual(["'self'"]);
    expect(csp['form-action']).toEqual(["'none'"]);
  });

  it('never allows eval or inline scripts', () => {
    for (const [directive, list] of Object.entries(csp)) {
      expect(list, directive).not.toContain("'unsafe-eval'");
      expect(list, directive).not.toContain("'wasm-unsafe-eval'");
      expect(list, directive).not.toContain('*');
    }
    expect(csp['script-src']).not.toContain("'unsafe-inline'");
    expect(csp['script-src']).not.toContain('data:');
    expect(csp['script-src']).not.toContain('blob:');
    expect(csp['script-src']).not.toContain('https:');
  });

  it('leaves out directives a meta tag ignores', () => {
    for (const directive of ['frame-ancestors', 'report-uri', 'report-to', 'sandbox']) expect(csp[directive], directive).toBeUndefined();
    // upgrade-insecure-requests would break the http://localhost dev server and vite preview.
    expect(csp['upgrade-insecure-requests']).toBeUndefined();
  });

  it('lets the sandboxed preview load LaTeX.js from the CDN', () => {
    expect(cspAllows(csp, 'script-src', `${LATEX_JS_ASSET_BASE}js/base.js`, APP_ORIGIN)).toBe(true);
    expect(cspAllows(csp, 'style-src', `${LATEX_JS_ASSET_BASE}css/katex.css`, APP_ORIGIN)).toBe(true);
    expect(cspAllows(csp, 'style-src', `${LATEX_JS_ASSET_BASE}css/article.css`, APP_ORIGIN)).toBe(true);
    expect(cspAllows(csp, 'font-src', `${LATEX_JS_ASSET_BASE}fonts/cmun-serif.woff`, APP_ORIGIN)).toBe(true);
    expect(cspAllows(csp, 'base-uri', LATEX_JS_ASSET_BASE, APP_ORIGIN)).toBe(true);
    // Our theme and KaTeX font styles are inline <style> tags, and LaTeX.js uses style attributes.
    expect(csp['style-src']).toContain("'unsafe-inline'");
    // Project images reach the preview as data: URLs, and the file viewer uses blob: URLs.
    expect(csp['img-src']).toEqual(expect.arrayContaining(['data:', 'blob:']));
    expect(csp['frame-src']).toContain('blob:');
  });

  it('only allows the LaTeX.js package from jsDelivr, not every npm package', () => {
    expect(cspAllows(csp, 'script-src', 'https://cdn.jsdelivr.net/npm/some-other-package/index.js', APP_ORIGIN)).toBe(false);
    expect(cspAllows(csp, 'script-src', 'https://cdn.jsdelivr.net/npm/latex.js@0.0.1/dist/js/base.js', APP_ORIGIN)).toBe(false);
  });

  it('allows Google sign-in, the Picker and the Drive API', () => {
    expect(cspAllows(csp, 'script-src', 'https://accounts.google.com/gsi/client', APP_ORIGIN)).toBe(true);
    expect(cspAllows(csp, 'script-src', 'https://apis.google.com/js/api.js', APP_ORIGIN)).toBe(true);
    expect(cspAllows(csp, 'style-src', 'https://accounts.google.com/gsi/style', APP_ORIGIN)).toBe(true);
    expect(cspAllows(csp, 'frame-src', 'https://accounts.google.com/gsi/iframe/select', APP_ORIGIN)).toBe(true);
    expect(cspAllows(csp, 'frame-src', 'https://docs.google.com/picker', APP_ORIGIN)).toBe(true);
    expect(cspAllows(csp, 'connect-src', 'https://www.googleapis.com/drive/v3/files', APP_ORIGIN)).toBe(true);
    expect(cspAllows(csp, 'connect-src', 'https://www.googleapis.com/upload/drive/v3/files', APP_ORIGIN)).toBe(true);
  });

  it('allows the default WebTorrent trackers', () => {
    vi.stubEnv('VITE_P2P_RENDEZVOUS', '');
    try {
      for (const tracker of getBootstrapConfig(APP_ORIGIN).rendezvous) {
        expect(cspAllows(csp, 'connect-src', tracker, APP_ORIGIN), tracker).toBe(true);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('allows the app itself, including the Vite dev server socket', () => {
    expect(cspAllows(csp, 'script-src', `${APP_ORIGIN}/assets/index.js`, APP_ORIGIN)).toBe(true);
    expect(cspAllows(csp, 'worker-src', `${APP_ORIGIN}/assets/compile.worker.js`, APP_ORIGIN)).toBe(true);
    expect(cspAllows(csp, 'connect-src', 'ws://localhost:5173/', 'http://localhost:5173')).toBe(true);
  });

  it('allows every external URL in src/', () => {
    const urls = externalUrls();
    expect(urls.size).toBeGreaterThan(5);
    const blocked: string[] = [];
    for (const [url, file] of urls) {
      if (url in NOT_FETCHED) continue;
      const allowed = FETCH_DIRECTIVES.some((directive) => cspAllows(csp, directive, url, APP_ORIGIN));
      if (!allowed) blocked.push(`${url} (${file})`);
    }
    expect(blocked).toEqual([]);
  });

  it('still lists every URL it exempts, so the exemptions stay current', () => {
    const urls = externalUrls();
    for (const url of Object.keys(NOT_FETCHED)) expect(urls.has(url), url).toBe(true);
  });

  it("allows the preview's link script by its hash, and no other inline script", async () => {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(PREVIEW_LINK_SCRIPT)));
    const hash = `'sha256-${btoa(String.fromCharCode(...digest))}'`;
    // If this fails after editing PREVIEW_LINK_SCRIPT, put this hash in script-src in index.html.
    expect(csp['script-src'], `script-src needs ${hash}`).toContain(hash);
    expect(csp['script-src'].filter((source) => source.startsWith("'sha"))).toEqual([hash]);
  });

  it('pre-allows the hosts Google loads at runtime', () => {
    for (const [directive, list] of Object.entries(GOOGLE_RUNTIME_SOURCES)) {
      for (const source of list) expect(csp[directive], `${directive} ${source}`).toContain(source);
    }
    expect(cspAllows(csp, 'img-src', 'https://lh3.googleusercontent.com/a/photo', APP_ORIGIN)).toBe(true);
    expect(cspAllows(csp, 'img-src', 'https://ssl.gstatic.com/docs/picker/images/x.png', APP_ORIGIN)).toBe(true);
    expect(cspAllows(csp, 'script-src', 'https://www.gstatic.com/_/js/k=x', APP_ORIGIN)).toBe(true);
    expect(cspAllows(csp, 'frame-src', 'https://drive.google.com/picker', APP_ORIGIN)).toBe(true);
    expect(cspAllows(csp, 'connect-src', 'https://content.googleapis.com/drive/v3/files', APP_ORIGIN)).toBe(true);
    // Still tight: no wildcard script hosts, and no googleusercontent outside images.
    expect(cspAllows(csp, 'script-src', 'https://evil.gstatic.com/x.js', APP_ORIGIN)).toBe(false);
    expect(cspAllows(csp, 'script-src', 'https://lh3.googleusercontent.com/x.js', APP_ORIGIN)).toBe(false);
    expect(cspAllows(csp, 'connect-src', 'https://lh3.googleusercontent.com/x', APP_ORIGIN)).toBe(false);
  });

  it('has no external host that is neither used in src/ nor a listed Google runtime host', () => {
    const urls = [...externalUrls().keys()];
    const unexplained: string[] = [];
    for (const directive of [...FETCH_DIRECTIVES, 'base-uri']) {
      for (const source of csp[directive] ?? []) {
        if (source.startsWith("'") || /^[a-z]+:$/.test(source)) continue;
        if (GOOGLE_RUNTIME_SOURCES[directive]?.includes(source)) continue;
        if (urls.some((url) => sourceMatchesUrl(source, url))) continue;
        unexplained.push(`${directive} ${source}`);
      }
    }
    expect(unexplained).toEqual([]);
  });
});

describe.each([
  ['privacy.html', privacyHtml],
  ['tos.html', tosHtml],
])('Content-Security-Policy in %s', (_name, html) => {
  const pageCsp = parseCsp(cspFromHtml(html) ?? '');

  it('is a tight policy for a static page', () => {
    expect(pageCsp['default-src']).toEqual(["'none'"]);
    expect(pageCsp['style-src']).toEqual(["'unsafe-inline'"]);
    expect(pageCsp['img-src']).toEqual(["'self'"]);
    expect(pageCsp['base-uri']).toEqual(["'none'"]);
    expect(pageCsp['form-action']).toEqual(["'none'"]);
    expect(pageCsp['script-src']).toBeUndefined();
  });

  it('has no scripts or external resources for the policy to block', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link[^>]+href=["']https?:/i);
    expect(html).not.toMatch(/<img/i);
  });
});
