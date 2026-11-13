import { HtmlGenerator, parse } from 'latex.js';
import { PAGE_BREAK_TOKEN, adaptLatexSource } from './latexJsAdapt';
import { expandProjectSource, type ProjectDiagnostic } from './projectSource';
import { addKatexFontFallbacks } from './katexFonts';
import { extractVerbatim, insertVerbatimBlocks, type VerbatimBlock } from './verbatimBlocks';
import type { EditorDiagnostic } from '../ui/diagnostics';

import { LATEX_JS_ASSET_BASE } from './latexJsAssets';

export { LATEX_JS_ASSET_BASE };

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
 * LaTeX.js turns a \ref to a label that doesn't exist into `<a href="#">??</a>`.
 * Drop the href so `??` is plain text, not a link that goes nowhere.
 */
export function unlinkMissingRefs(doc: Document): void {
  for (const a of Array.from(doc.querySelectorAll('a'))) {
    if (a.getAttribute('href')?.trim() === '#') a.removeAttribute('href');
  }
}

/** Class of the empty block a \newpage becomes. It breaks the page in print; on screen, pageBreakCss in ui/preview.ts draws it as a dashed line. */
export const PAGE_BREAK_CLASS = 'lc-page-break';

/**
 * Swap the marker paragraphs the adapter puts in for \newpage, \clearpage and \pagebreak
 * for an empty block that starts a new page when the document is printed.
 */
export function markPageBreaks(doc: Document): void {
  for (const span of Array.from(doc.querySelectorAll('span'))) {
    if (span.className !== 'tt' || span.textContent !== PAGE_BREAK_TOKEN) continue;
    const paragraph = span.parentElement;
    const target = paragraph && paragraph.tagName.toLowerCase() === 'p' && paragraph.textContent === PAGE_BREAK_TOKEN ? paragraph : span;
    const block = doc.createElement('div');
    block.className = PAGE_BREAK_CLASS;
    block.setAttribute('style', 'break-after:page;');
    target.replaceWith(block);
  }
}

/**
 * Typeset editor LaTeX into a full HTML document (LaTeX.js), using the raw `source` only.
 */
export function latexSourceToPreviewHtml(source: string): { html: string | null; errors: EditorDiagnostic[]; changes: string[] } {
  const path = 'main.tex';
  const verbatim = extractVerbatim(path, new Map([[path, source]]));
  const { doc, errors, changes } = typeset(verbatim.texts.get(path)!, verbatim.blocks, verbatim.changes);
  return { html: doc ? doc.documentElement.outerHTML : null, errors, changes };
}

/**
 * Typeset LaTeX into a document, with dangerous URLs stripped. `changes` lists what the adapter
 * removed or rewrote; the preview pane shows it next to the preview, not inside the document.
 */
function typeset(
  source: string,
  blocks: VerbatimBlock[] = [],
  verbatimChanges: string[] = [],
): { doc: Document | null; errors: EditorDiagnostic[]; changes: string[] } {
  const adapted = adaptLatexSource(source);
  const changes = [...verbatimChanges, ...adapted.changes];
  try {
    const generator = parse(adapted.source, {
      generator: new HtmlGenerator({ hyphenate: false, documentClass: 'article' }),
    });
    const doc = generator.htmlDocument(LATEX_JS_ASSET_BASE);
    // Peers can put any URL into \href or \url, so we strip script-capable ones before rendering.
    stripDangerousUrls(doc);
    unlinkMissingRefs(doc);
    markPageBreaks(doc);
    addKatexFontFallbacks(doc);
    insertVerbatimBlocks(doc, blocks);
    return { doc, errors: [], changes };
  } catch (err) {
    return {
      doc: null,
      errors: [{ line: errorLine(err, source), severity: 'error', message: String(err) }],
      changes,
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

export type { ProjectDiagnostic };

export type ProjectPreviewInput = {
  mainPath: string;
  texts: Map<string, string>;
  binaryPaths: string[];
  /** Data URLs for image files by path. A missing one means its bytes haven't arrived yet. */
  imageUrls: Map<string, string>;
};

export type ProjectPreviewResult = {
  html: string | null;
  errors: ProjectDiagnostic[];
  missing: string[];
  /** What the preview removed or rewrote for LaTeX.js, as plain text. It can quote the document. */
  changes: string[];
};

/**
 * Typeset the whole project, starting at the main file. \input files, images and the
 * bibliography come from the project. Errors say which file and line they belong to.
 */
export function projectToPreviewHtml(input: ProjectPreviewInput): ProjectPreviewResult {
  // Verbatim text comes out first, so nothing after this (\input, \cite, the adapter) can touch it.
  const verbatim = extractVerbatim(input.mainPath, input.texts);
  const expanded = expandProjectSource(input.mainPath, verbatim.texts, input.binaryPaths);
  expanded.missing.push(...verbatim.missing.filter((name) => !expanded.missing.includes(name)));
  const { doc, errors: sourceErrors, changes } = typeset(expanded.source, verbatim.blocks, verbatim.changes);
  // LaTeX.js errors come first, since they stop the preview. Bibliography notes follow.
  const errors: ProjectDiagnostic[] = [
    ...sourceErrors.map((error) => {
      const origin = expanded.lineMap[error.line - 1] ?? { path: input.mainPath, line: 1 };
      return { ...error, path: origin.path, line: origin.line };
    }),
    ...expanded.diagnostics,
  ];
  if (!doc) return { html: null, errors, missing: expanded.missing, changes };

  // Images go in after the URL check, since it would strip our data: URLs along with a peer's.
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const image = expanded.images.get(img.getAttribute('src') ?? '');
    if (!image) continue;
    const url = input.imageUrls.get(image.path);
    img.removeAttribute('width');
    img.removeAttribute('height');
    img.setAttribute('alt', image.path);
    img.setAttribute('style', image.style);
    if (url) img.setAttribute('src', url);
    else img.removeAttribute('src');
  }
  return { html: doc.documentElement.outerHTML, errors, missing: expanded.missing, changes };
}
