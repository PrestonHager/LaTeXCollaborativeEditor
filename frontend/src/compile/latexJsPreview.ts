import { HtmlGenerator, parse } from 'latex.js';
import { PAGE_BREAK_TOKEN, adaptLatexSource } from './latexJsAdapt';
import { expandProjectSource, type ProjectDiagnostic, type ProjectImage } from './projectSource';
import { pdfImageKey, pdfRenderKey, type PdfCrop, type RenderedPdfFigure } from './graphicsOptions';
import type { EpsBox } from './epsBoundingBox';
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
  /**
   * PDF figures already drawn as images, by pdfImageKey(path, renderKey). A missing one hasn't
   * been drawn yet; the result's `pdfFigures` says which ones the document wants.
   */
  pdfImages?: Map<string, RenderedPdfFigure>;
  /** The %%BoundingBox of each EPS file by path, or null when it has none. Missing: no bytes yet. */
  epsBoxes?: Map<string, EpsBox | null>;
};

/** A PDF page the document shows as a figure, for the main thread to draw (see figureImages.ts). */
export type PdfFigureRequest = { path: string; renderKey: string; page: number; crop: PdfCrop | null };

export type ProjectPreviewResult = {
  html: string | null;
  errors: ProjectDiagnostic[];
  missing: string[];
  /** What the preview removed or rewrote for LaTeX.js, as plain text. It can quote the document. */
  changes: string[];
  /** Every PDF page the document uses as a figure, drawn or not. */
  pdfFigures?: PdfFigureRequest[];
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
  const figures = placeFigures(doc, expanded.images, input);
  return {
    html: doc.documentElement.outerHTML,
    errors,
    missing: expanded.missing,
    changes: [...changes, ...figures.changes],
    pdfFigures: figures.pdfFigures,
  };
}

/** Class of the box that stands in for a figure the preview can't draw. */
export const FIGURE_PLACEHOLDER_CLASS = 'lc-figure-placeholder';

// The box is sized like the figure and drawn in the text color, so it works in light and dark.
const PLACEHOLDER_STYLE =
  'display:inline-flex;flex-direction:column;justify-content:center;align-items:center;gap:.25em;box-sizing:border-box;' +
  'border:1px dashed currentColor;padding:.5em;overflow:hidden;vertical-align:bottom;text-align:center;' +
  'font:12px/1.35 system-ui,sans-serif;text-indent:0;overflow-wrap:anywhere;';

// A placeholder with no %%BoundingBox gets the size of a typical figure: 4 by 3 inches.
const DEFAULT_BOX: EpsBox = { width: 288, height: 216 };

const hasProperty = (style: string, property: string) => new RegExp(`(^|;)${property}:`).test(style);

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Add a natural size, in bp, to a figure's option style. A width or height from the options
 * wins; with neither, the figure shows at its own size, the way LaTeX would.
 */
export function naturalSizeStyle(optionStyle: string, width: number, height: number): string {
  if (hasProperty(optionStyle, 'width') || hasProperty(optionStyle, 'height')) return optionStyle;
  return `${optionStyle}width:${round2(width)}pt;aspect-ratio:${round2(width)}/${round2(height)};`;
}

/** The style for a placeholder box: the figure's size, keeping its shape when only one side is set. */
function placeholderStyle(optionStyle: string, box: EpsBox | null): string {
  const { width, height } = box ?? DEFAULT_BOX;
  const sized = naturalSizeStyle(optionStyle.replace(/object-fit:[^;]*;/, ''), width, height);
  const shaped = hasProperty(sized, 'aspect-ratio') ? sized : `${sized}aspect-ratio:${round2(width)}/${round2(height)};`;
  return PLACEHOLDER_STYLE + shaped;
}

/** A framed box in place of a figure, with its file name and why it isn't shown. */
function placeholder(doc: Document, image: ProjectImage, box: EpsBox | null, message: string): Element {
  const span = doc.createElement('span');
  span.setAttribute('class', FIGURE_PLACEHOLDER_CLASS);
  span.setAttribute('role', 'img');
  span.setAttribute('aria-label', `${image.path}. ${message}`);
  span.setAttribute('style', placeholderStyle(image.style, box));
  const name = doc.createElement('strong');
  name.textContent = image.path;
  const note = doc.createElement('span');
  note.setAttribute('style', 'opacity:.75;');
  note.textContent = message;
  span.appendChild(name);
  span.appendChild(note);
  return span;
}

export const EPS_PLACEHOLDER_MESSAGE = "EPS can't be previewed; convert it to PDF.";

/**
 * Put the project's figures back in place of LaTeX.js's image tokens: images as data: URLs,
 * PDF pages as the images the main thread drew, and EPS files as placeholder boxes.
 */
function placeFigures(
  doc: Document,
  images: Map<string, ProjectImage>,
  input: ProjectPreviewInput,
): { changes: string[]; pdfFigures: PdfFigureRequest[] } {
  const pdfFigures = new Map<string, PdfFigureRequest>();
  let eps = false;
  let clipped = false;
  const failed = new Set<string>();

  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const image = images.get(img.getAttribute('src') ?? '');
    if (!image) continue;
    img.removeAttribute('width');
    img.removeAttribute('height');
    img.setAttribute('alt', image.path);
    img.setAttribute('style', image.style);
    img.removeAttribute('src');

    if (image.kind === 'eps') {
      const box = input.epsBoxes?.get(image.path);
      // No entry means its bytes haven't arrived, so it stays an empty image until they do.
      if (box === undefined) continue;
      eps = true;
      img.replaceWith(placeholder(doc, image, box, EPS_PLACEHOLDER_MESSAGE));
    } else if (image.kind === 'pdf') {
      const renderKey = pdfRenderKey(image.pdf);
      const key = pdfImageKey(image.path, renderKey);
      pdfFigures.set(key, { path: image.path, renderKey, page: image.pdf.page, crop: image.pdf.crop });
      if (image.pdf.crop && !image.pdf.clip) clipped = true;
      const rendered = input.pdfImages?.get(key);
      if (!rendered) continue;
      if ('error' in rendered) {
        failed.add(`${image.path}: ${rendered.error}`);
        img.replaceWith(placeholder(doc, image, null, `This PDF figure couldn't be drawn. ${rendered.error}`));
        continue;
      }
      img.setAttribute('style', naturalSizeStyle(image.style, rendered.width, rendered.height));
      img.setAttribute('src', rendered.url);
    } else {
      const url = input.imageUrls.get(image.path);
      if (url) img.setAttribute('src', url);
    }
  }

  const changes: string[] = [];
  if (eps) changes.push("Showed EPS figures as empty boxes of the same size, since the preview can't draw PostScript. Convert them to PDF to see them.");
  if (clipped) changes.push('Cut PDF figures off at their trim or viewport, as if clip were set.');
  for (const reason of failed) changes.push(`Couldn't draw the PDF figure ${reason}`);
  return { changes, pdfFigures: [...pdfFigures.values()] };
}
