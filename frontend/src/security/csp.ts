/**
 * Helpers for the Content-Security-Policy <meta> tag in index.html.
 * The build uses `addConnectSources` to allow custom trackers from VITE_P2P_RENDEZVOUS,
 * and the tests use the rest to check the policy against the URLs the app really loads.
 * Nothing here runs in the browser.
 */

export type CspDirectives = Record<string, string[]>;

const CSP_META = /<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=(["'])([\s\S]*?)\1\s*\/?>/i;

/** Get the policy from the CSP <meta> tag in an HTML page, or null if it has none. */
export function cspFromHtml(html: string): string | null {
  return CSP_META.exec(html)?.[2] ?? null;
}

/** Split a policy into directives. Names are lowercased; the first copy of a directive wins, as in browsers. */
export function parseCsp(policy: string): CspDirectives {
  const directives: CspDirectives = {};
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean);
    if (!name) continue;
    const key = name.toLowerCase();
    if (!(key in directives)) directives[key] = sources;
  }
  return directives;
}

/** Turn directives back into a one-line policy. */
export function serializeCsp(directives: CspDirectives): string {
  return Object.entries(directives)
    .map(([name, sources]) => [name, ...sources].join(' '))
    .join('; ');
}

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443' };

/**
 * Check one host-source or scheme-source (like `https://cdn.example/npm/` or `blob:`) against a URL,
 * following CSP Level 3 matching: scheme upgrades (http to https, ws to wss), `*.` hosts,
 * default ports, and path prefixes for sources ending in `/`. Keywords never match here.
 */
export function sourceMatchesUrl(source: string, url: string): boolean {
  if (source.startsWith("'")) return false;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  const schemeOnly = /^([a-z][a-z0-9+.-]*:)$/i.exec(source);
  if (schemeOnly) return schemeMatches(schemeOnly[1].toLowerCase(), target.protocol);

  const match = /^(?:([a-z][a-z0-9+.-]*:)\/\/)?(\*|(?:\*\.)?[^/:]+)(?::(\d+|\*))?(\/.*)?$/i.exec(source);
  if (!match) return false;
  const [, scheme, host, port, path] = match;
  if (scheme && !schemeMatches(scheme.toLowerCase(), target.protocol)) return false;
  if (!scheme && !['http:', 'https:', 'ws:', 'wss:'].includes(target.protocol)) return false;

  const hostname = target.hostname.toLowerCase();
  const sourceHost = host.toLowerCase();
  if (sourceHost.startsWith('*.')) {
    if (!hostname.endsWith(sourceHost.slice(1))) return false;
  } else if (sourceHost !== '*' && sourceHost !== hostname) {
    return false;
  }

  const targetPort = target.port || DEFAULT_PORTS[target.protocol] || '';
  if (port && port !== '*' && port !== targetPort) return false;
  if (!port) {
    // No port in the source: the source scheme's default port, or the URL scheme's own default.
    const sourceDefault = DEFAULT_PORTS[(scheme ?? target.protocol).toLowerCase()];
    if (targetPort !== sourceDefault && targetPort !== DEFAULT_PORTS[target.protocol]) return false;
  }

  if (path && path !== '/') {
    const targetPath = decodeURIComponent(target.pathname);
    if (path.endsWith('/') ? !targetPath.startsWith(path) : targetPath !== path) return false;
  }
  return true;
}

function schemeMatches(sourceScheme: string, targetScheme: string): boolean {
  if (sourceScheme === targetScheme) return true;
  // CSP Level 3 scheme-part matching: secure upgrades are allowed, and ws(s) covers http(s).
  return (
    (sourceScheme === 'http:' && targetScheme === 'https:') ||
    (sourceScheme === 'ws:' && ['wss:', 'http:', 'https:'].includes(targetScheme)) ||
    (sourceScheme === 'wss:' && targetScheme === 'https:')
  );
}

/**
 * Check whether a directive (falling back to `default-src`) lets the page load `url`.
 * `selfOrigin` is the page's origin, used for `'self'`.
 */
export function cspAllows(directives: CspDirectives, directive: string, url: string, selfOrigin?: string): boolean {
  const sources = directives[directive] ?? directives['default-src'];
  if (!sources) return true;
  if (sources.includes("'none'")) return false;
  if (selfOrigin && sources.includes("'self'")) {
    const self = new URL(selfOrigin);
    const target = new URL(url, selfOrigin);
    // Same host, and either the same scheme, a secure one, or ws: from an http: page.
    // That covers same-host WebSockets too, like Vite's dev server HMR socket.
    if (
      target.host === self.host &&
      (target.protocol === self.protocol ||
        ['https:', 'wss:'].includes(target.protocol) ||
        (self.protocol === 'http:' && target.protocol === 'ws:'))
    ) {
      return true;
    }
  }
  return sources.some((source) => sourceMatchesUrl(source, url));
}

/**
 * Add the origins of `urls` to the policy's `connect-src` in the page's CSP <meta> tag,
 * skipping any it already allows. Used by the build so custom trackers in
 * VITE_P2P_RENDEZVOUS aren't blocked. Pages without a CSP tag come back unchanged.
 */
export function addConnectSources(html: string, urls: string[]): string {
  const policy = cspFromHtml(html);
  if (policy === null) return html;
  const directives = parseCsp(policy);
  const connect = [...(directives['connect-src'] ?? directives['default-src'] ?? [])];
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (cspAllows({ 'connect-src': connect }, 'connect-src', url.href)) continue;
    connect.push(`${url.protocol}//${url.host}`);
  }
  directives['connect-src'] = connect;
  return html.replace(CSP_META, (tag) => tag.replace(policy, serializeCsp(directives)));
}

/**
 * Remove the CSP <meta> tag from a page. The build does this when VITE_DISABLE_CSP=1,
 * as a rollback switch if the policy blocks something in production.
 */
export function removeCspMeta(html: string): string {
  return html.replace(new RegExp(`[ \\t]*${CSP_META.source}[ \\t]*\\r?\\n?`, 'i'), '');
}
