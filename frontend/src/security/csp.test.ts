import { addConnectSources, cspAllows, cspFromHtml, parseCsp, serializeCsp, sourceMatchesUrl } from './csp';

const page = (policy: string) =>
  `<html><head><meta http-equiv="Content-Security-Policy" content="${policy}" /><title>x</title></head></html>`;

describe('cspFromHtml', () => {
  it('reads the policy from the meta tag', () => {
    expect(cspFromHtml(page("default-src 'self'"))).toBe("default-src 'self'");
    expect(cspFromHtml(`<meta\n  http-equiv='Content-Security-Policy'\n  content="img-src data:">`)).toBe('img-src data:');
  });

  it('returns null without one', () => {
    expect(cspFromHtml('<html><head></head></html>')).toBeNull();
  });
});

describe('parseCsp and serializeCsp', () => {
  it('splits directives and keeps the first duplicate', () => {
    const csp = parseCsp("  Default-Src 'self' ; img-src data: blob:;; img-src https:; upgrade-insecure-requests");
    expect(csp).toEqual({ 'default-src': ["'self'"], 'img-src': ['data:', 'blob:'], 'upgrade-insecure-requests': [] });
    expect(serializeCsp(csp)).toBe("default-src 'self'; img-src data: blob:; upgrade-insecure-requests");
  });
});

describe('sourceMatchesUrl', () => {
  it.each([
    ['https://cdn.example', 'https://cdn.example/a.js'],
    ['https://cdn.example/npm/pkg@1/', 'https://cdn.example/npm/pkg@1/dist/a.js'],
    ['https://cdn.example/gsi/client', 'https://cdn.example/gsi/client'],
    ['https://*.example', 'https://a.b.example/x'],
    ['cdn.example', 'https://cdn.example/x'],
    ['http://cdn.example', 'https://cdn.example/x'],
    ['ws://t.example', 'wss://t.example/'],
    ['ws://t.example', 'https://t.example/'],
    ['wss://t.example', 'https://t.example/'],
    ['wss://t.example:7073', 'wss://t.example:7073/announce'],
    ['wss://t.example:*', 'wss://t.example:9000/'],
    ['https://cdn.example/', 'https://cdn.example/anything'],
    ['data:', 'data:image/png;base64,AA=='],
    ['blob:', 'blob:https://app.example/123'],
  ])('%s allows %s', (source, url) => {
    expect(sourceMatchesUrl(source, url)).toBe(true);
  });

  it.each([
    ["'self'", 'https://app.example/'],
    ['https://cdn.example', 'https://evil.example/'],
    ['https://cdn.example/npm/pkg@1/', 'https://cdn.example/npm/other/a.js'],
    ['https://cdn.example/gsi/client', 'https://cdn.example/gsi/client2'],
    ['https://*.example', 'https://notexample/'],
    ['https://cdn.example', 'http://cdn.example/'],
    ['wss://t.example', 'wss://t.example:7073/'],
    ['wss://t.example:7073', 'wss://t.example/'],
    ['https://t.example', 'wss://t.example/'],
    ['cdn.example', 'data:text/plain,hi'],
    ['data:', 'https://cdn.example/'],
    ['https://cdn.example', 'not a url'],
    ['https://bad host', 'https://cdn.example/'],
  ])('%s blocks %s', (source, url) => {
    expect(sourceMatchesUrl(source, url)).toBe(false);
  });
});

describe('cspAllows', () => {
  const csp = parseCsp("default-src 'self'; script-src 'self' https://cdn.example; object-src 'none'");

  it('falls back to default-src', () => {
    expect(cspAllows(csp, 'img-src', 'https://app.example/a.png', 'https://app.example')).toBe(true);
    expect(cspAllows(csp, 'img-src', 'https://cdn.example/a.png', 'https://app.example')).toBe(false);
  });

  it("matches 'self' with secure upgrades and same-host WebSockets", () => {
    expect(cspAllows(csp, 'connect-src', 'wss://app.example/', 'https://app.example')).toBe(true);
    expect(cspAllows(csp, 'connect-src', 'ws://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(cspAllows(csp, 'connect-src', 'https://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(cspAllows(csp, 'connect-src', 'ws://app.example/', 'https://app.example')).toBe(false);
    expect(cspAllows(csp, 'connect-src', 'https://other.example/', 'https://app.example')).toBe(false);
  });

  it('checks the directive sources and honors none', () => {
    expect(cspAllows(csp, 'script-src', 'https://cdn.example/a.js')).toBe(true);
    expect(cspAllows(csp, 'object-src', 'https://app.example/a.pdf', 'https://app.example')).toBe(false);
  });

  it('allows everything without a matching directive or default-src', () => {
    expect(cspAllows(parseCsp('img-src data:'), 'connect-src', 'https://any.example/')).toBe(true);
  });
});

describe('addConnectSources', () => {
  const html = page("default-src 'self'; connect-src 'self' wss://t1.example");

  it('adds origins it does not already allow', () => {
    const out = addConnectSources(html, ['wss://t1.example', 'wss://t2.example:7073/announce', 'nonsense']);
    expect(cspFromHtml(out)).toBe("default-src 'self'; connect-src 'self' wss://t1.example wss://t2.example:7073");
    expect(out).toContain('<title>x</title>');
  });

  it('starts from default-src when connect-src is missing', () => {
    const out = addConnectSources(page("default-src 'self'"), ['wss://t.example']);
    expect(parseCsp(cspFromHtml(out)!)['connect-src']).toEqual(["'self'", 'wss://t.example']);
  });

  it('starts empty with neither directive', () => {
    const out = addConnectSources(page('img-src data:'), ['wss://t.example']);
    expect(parseCsp(cspFromHtml(out)!)['connect-src']).toEqual(['wss://t.example']);
  });

  it('leaves pages without a CSP alone', () => {
    expect(addConnectSources('<html></html>', ['wss://t.example'])).toBe('<html></html>');
  });
});
