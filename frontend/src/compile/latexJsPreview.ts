import { HtmlGenerator, parse } from 'latex.js';
import type { EditorDiagnostic } from '../ui/diagnostics';

/** LaTeX.js static assets (CSS, fonts, JS) — same version as the `latex.js` npm dependency. */
export const LATEX_JS_ASSET_BASE = 'https://cdn.jsdelivr.net/npm/latex.js@0.12.6/dist/';

/**
 * Typeset editor LaTeX into a full HTML document (LaTeX.js), using the raw `source` only.
 */
export function latexSourceToPreviewHtml(source: string): { html: string | null; errors: EditorDiagnostic[] } {
  try {
    const generator = parse(source, {
      generator: new HtmlGenerator({ hyphenate: false, documentClass: 'article' }),
    });
    const doc = generator.htmlDocument(LATEX_JS_ASSET_BASE);
    return { html: doc.documentElement.outerHTML, errors: [] };
  } catch (err) {
    return {
      html: null,
      errors: [{ line: 1, severity: 'error', message: String(err) }],
    };
  }
}
