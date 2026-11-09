import { HtmlGenerator, parse } from 'latex.js';
import { adaptLatexSourceForLatexJs } from './latexJsAdapt';
import type { EditorDiagnostic } from '../ui/diagnostics';

/** LaTeX.js static assets (CSS, fonts, JS) — same version as the `latex.js` npm dependency. */
export const LATEX_JS_ASSET_BASE = 'https://cdn.jsdelivr.net/npm/latex.js@0.12.6/dist/';

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
    return { html: doc.documentElement.outerHTML, errors: [] };
  } catch (err) {
    return {
      html: null,
      errors: [{ line: errorLine(err, source), severity: 'error', message: String(err) }],
    };
  }
}

/**
 * Get the 1-based line of a LaTeX.js parse error. The adapter keeps line breaks in place,
 * so this line is already the editor line.
 */
function errorLine(err: unknown, source: string): number {
  const line = (err as { location?: { start?: { line?: unknown } } } | null)?.location?.start?.line;
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) return 1;
  // Clamp in case the error points past the end, like a missing \end{document}.
  return Math.min(line, source.split('\n').length);
}
