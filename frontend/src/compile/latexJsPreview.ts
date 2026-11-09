import { HtmlGenerator, parse } from 'latex.js';
import { adaptLatexSourceForLatexJs } from './latexJsAdapt';
import type { EditorDiagnostic } from '../ui/diagnostics';

/** LaTeX.js static assets (CSS, fonts, JS) — same version as the `latex.js` npm dependency. */
export const LATEX_JS_ASSET_BASE = 'https://cdn.jsdelivr.net/npm/latex.js@0.12.6/dist/';

const URL_ATTRIBUTES = ['href', 'src', 'xlink:href', 'action', 'formaction'];
const DANGEROUS_URL_SCHEMES = ['javascript:', 'vbscript:', 'data:'];

/**
 * Check if a URL uses a scheme that can run script or smuggle content (javascript:, vbscript:, data:).
 */
export function isDangerousUrl(url: string): boolean {
  // Browsers ignore control chars and whitespace inside the scheme, so we drop them before checking.
  const normalized = url.replace(/[\u0000- \u007f]/g, '').toLowerCase();
  return DANGEROUS_URL_SCHEMES.some((scheme) => normalized.startsWith(scheme));
}

/**
 * Remove URL attributes with dangerous schemes from a generated preview document.
 */
export function stripDangerousUrls(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const attr of URL_ATTRIBUTES) {
      const value = el.getAttribute(attr);
      if (value !== null && isDangerousUrl(value)) {
        el.removeAttribute(attr);
      }
    }
  }
}

/**
 * Typeset editor LaTeX into a full HTML document (LaTeX.js), using the raw `source` only.
 */
export function latexSourceToPreviewHtml(source: string): { html: string | null; errors: EditorDiagnostic[] } {
  try {
    const adapted = adaptLatexSourceForLatexJs(source);
    const generator = parse(adapted, {
      generator: new HtmlGenerator({ hyphenate: false, documentClass: 'article' }),
    });
    const doc = generator.htmlDocument(LATEX_JS_ASSET_BASE);
    // Peers can put any URL into \href or \url, so we strip script-capable ones before rendering.
    stripDangerousUrls(doc);
    return { html: doc.documentElement.outerHTML, errors: [] };
  } catch (err) {
    return {
      html: null,
      errors: [{ line: 1, severity: 'error', message: String(err) }],
    };
  }
}
