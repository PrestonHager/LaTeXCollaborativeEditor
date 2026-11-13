import { HtmlGenerator, parse } from 'latex.js';
import { adaptLatexSource } from './latexJsAdapt';
import { expandProjectSource } from './projectSource';
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
 * Add a small note to the top of the preview listing what the adapter removed or rewrote,
 * so people know the preview isn't exact. It's a <details>, so it works without scripts.
 */
export function addChangesNote(doc: Document, changes: string[]): void {
  if (!changes.length) return;
  const note = doc.createElement('details');
  note.className = 'lc-preview-note';
  note.setAttribute(
    'style',
    // Colors come from the preview theme style (src/ui/preview.ts), with light fallbacks.
    'font:12px/1.4 system-ui,sans-serif;color:var(--lc-note-text,#555);background:var(--lc-note-bg,#f6f6f6);border:1px solid var(--lc-note-border,#ddd);border-radius:4px;padding:4px 8px;margin:8px;',
  );
  const summary = doc.createElement('summary');
  summary.setAttribute('style', 'cursor:pointer;');
  summary.textContent = `Preview is approximate: ${changes.length} change${changes.length === 1 ? '' : 's'} made for LaTeX.js.`;
  const list = doc.createElement('ul');
  list.setAttribute('style', 'margin:4px 0;padding-left:20px;');
  for (const change of changes) {
    const item = doc.createElement('li');
    item.textContent = change;
    list.appendChild(item);
  }
  note.append(summary, list);
  // The worker's mini DOM has no prepend, so we insert before the first child instead.
  doc.body.insertBefore(note, doc.body.firstChild);
}

/**
 * Typeset editor LaTeX into a full HTML document (LaTeX.js), using the raw `source` only.
 */
export function latexSourceToPreviewHtml(source: string): { html: string | null; errors: EditorDiagnostic[]; changes: string[] } {
  const { doc, errors, changes } = typeset(source);
  return { html: doc ? doc.documentElement.outerHTML : null, errors, changes };
}

/** Typeset LaTeX into a document, with dangerous URLs stripped and the changes note added. */
function typeset(source: string): { doc: Document | null; errors: EditorDiagnostic[]; changes: string[] } {
  const adapted = adaptLatexSource(source);
  try {
    const generator = parse(adapted.source, {
      generator: new HtmlGenerator({ hyphenate: false, documentClass: 'article' }),
    });
    const doc = generator.htmlDocument(LATEX_JS_ASSET_BASE);
    // Peers can put any URL into \href or \url, so we strip script-capable ones before rendering.
    stripDangerousUrls(doc);
    addChangesNote(doc, adapted.changes);
    return { doc, errors: [], changes: adapted.changes };
  } catch (err) {
    return {
      doc: null,
      errors: [{ line: errorLine(err, source), severity: 'error', message: String(err) }],
      changes: adapted.changes,
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

export type ProjectDiagnostic = EditorDiagnostic & { path: string };

export type ProjectPreviewInput = {
  mainPath: string;
  texts: Map<string, string>;
  binaryPaths: string[];
  /** Data URLs for image files by path. A missing one means its bytes haven't arrived yet. */
  imageUrls: Map<string, string>;
};

export type ProjectPreviewResult = { html: string | null; errors: ProjectDiagnostic[]; missing: string[] };

/**
 * Typeset the whole project, starting at the main file. \input files, images and the
 * bibliography come from the project. Errors say which file and line they belong to.
 */
export function projectToPreviewHtml(input: ProjectPreviewInput): ProjectPreviewResult {
  const expanded = expandProjectSource(input.mainPath, input.texts, input.binaryPaths);
  const { doc, errors: sourceErrors } = typeset(expanded.source);
  const errors = sourceErrors.map((error) => {
    const origin = expanded.lineMap[error.line - 1] ?? { path: input.mainPath, line: 1 };
    return { ...error, path: origin.path, line: origin.line };
  });
  if (!doc) return { html: null, errors, missing: expanded.missing };

  // Images go in after the URL check, since it would strip our data: URLs along with a peer's.
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const image = expanded.images.get(img.getAttribute('src') ?? '');
    if (!image) continue;
    const url = input.imageUrls.get(image.path);
    img.removeAttribute('width');
    img.removeAttribute('height');
    img.setAttribute('alt', image.path);
    img.setAttribute('style', `max-width:100%;${image.widthPercent ? `width:${image.widthPercent}%;` : ''}`);
    if (url) img.setAttribute('src', url);
    else img.removeAttribute('src');
  }
  return { html: doc.documentElement.outerHTML, errors, missing: expanded.missing };
}
