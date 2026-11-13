// Exporters built from the LaTeX.js preview: a standalone .html file, and a preview-quality PDF
// through the browser's print dialog.
import { isPreviewableImage, mimeType } from '../project/paths';
import { withPreviewTheme } from '../ui/preview';
import { encodeYjsState } from '../state/appSession';
import type { ProjectPreviewResult } from '../compile/latexJsPreview';
import { FigureImages, compileWithFigures } from '../compile/figureImages';
import { mainPath, needsMainFile, notSyncedWarning } from './sourceExporters';
import { safeFileName, throwIfAborted, type ExportRun, type ExportSource, type Exporter } from './types';

/** Bytes as a data: URL. encodeYjsState is the app's plain base64 encoder. */
export const dataUrl = (bytes: Uint8Array, type: string) => `data:${type || 'application/octet-stream'};base64,${encodeYjsState(bytes)}`;

const responseDataUrl = async (response: Response) =>
  dataUrl(new Uint8Array(await response.arrayBuffer()), (response.headers.get('content-type') ?? '').split(';')[0].trim());

/** Typeset the project the way the preview does, with every image we have put in as a data: URL. */
export async function typesetProject(source: ExportSource, { signal, onProgress, services }: ExportRun): Promise<{ html: string; warnings: string[] }> {
  const main = mainPath(source);
  if (!main) throw new Error('The project has no main .tex file.');
  const binaries = source.project.entries().filter((entry) => entry.kind === 'binary');
  const imageUrls = new Map<string, string>();
  const waiting: string[] = [];
  for (const entry of binaries) {
    if (!isPreviewableImage(entry.path)) continue;
    const bytes = entry.hash ? await source.blobs.get(entry.hash) : undefined;
    if (bytes) imageUrls.set(entry.path, dataUrl(bytes, mimeType(entry.path)));
    else waiting.push(entry.path);
    throwIfAborted(signal);
  }
  onProgress(0.2, 'Typesetting with LaTeX.js...');
  // PDF figures are drawn the same way as in the preview, and EPS figures get the same box.
  const figures = new FigureImages((hash) => source.blobs.get(hash));
  const result: ProjectPreviewResult | null = await compileWithFigures(
    figures,
    binaries,
    { mainPath: main, texts: source.project.textFiles(), binaryPaths: binaries.map((entry) => entry.path), imageUrls },
    (input) => services.compile(input, signal),
    () => !signal.aborted,
  );
  if (!result) throw new Error('The export was stopped.');
  throwIfAborted(signal);
  if (!result.html) {
    const first = result.errors[0];
    const where = first ? ` ${first.message} (${first.path} line ${first.line})` : '';
    throw new Error(`The document has errors, so there's nothing to export.${where} Fix it in the editor and try again.`);
  }
  const warnings = waiting.length ? [notSyncedWarning(waiting)] : [];
  if (result.missing.length) warnings.push(`Not found in the project: ${result.missing.join(', ')}.`);
  return { html: result.html, warnings };
}

/**
 * Turn a LaTeX.js preview document into one that stands on its own: no scripts, no <base>
 * pointing at the CDN, no "Preview is approximate" note, light colors, and the project name as title.
 */
export function standaloneDocument(html: string, title: string): Document {
  const doc = new DOMParser().parseFromString(withPreviewTheme(html, 'light'), 'text/html');
  for (const el of Array.from(doc.querySelectorAll('script, base, .lc-preview-note'))) el.remove();
  doc.title = title;
  return doc;
}

export const serializeDocument = (doc: Document) => `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;

const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const CSS_IMPORT = /@import\s+(?:url\(\s*)?(["']?)([^"')\s]+)\1\s*\)?\s*;/g;
const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;

/**
 * Fetch a style sheet and everything it pulls in (@import, fonts and images), and give back
 * one block of CSS with all of it inlined as data: URLs.
 */
export async function inlineStylesheet(url: string, run: ExportRun, cache = new Map<string, Promise<string>>()): Promise<string> {
  const get = async (target: string) => {
    const response = await run.services.fetch(target, run.signal);
    if (!response.ok) throw new Error(`Couldn't download ${target} (HTTP ${response.status}).`);
    return response;
  };
  let css = (await (await get(url)).text()).replace(CSS_COMMENT, '');
  throwIfAborted(run.signal);

  // Imports first, each one inlined in place.
  const imports = [...css.matchAll(CSS_IMPORT)];
  const inlined = await Promise.all(imports.map((match) => inlineStylesheet(new URL(match[2], url).href, run, cache)));
  imports.forEach((match, n) => {
    css = css.replace(match[0], () => inlined[n]);
  });

  // Then fonts and images, fetched once each.
  const urls = new Set([...css.matchAll(CSS_URL)].map((match) => match[2]).filter((ref) => !ref.startsWith('data:') && !ref.startsWith('#')));
  const dataUrls = new Map<string, string>();
  await Promise.all(
    [...urls].map(async (ref) => {
      const absolute = new URL(ref, url).href;
      if (!cache.has(absolute)) cache.set(absolute, get(absolute).then(responseDataUrl));
      dataUrls.set(ref, await cache.get(absolute)!);
    }),
  );
  throwIfAborted(run.signal);
  return css.replace(CSS_URL, (whole, _quote: string, ref: string) => {
    const data = dataUrls.get(ref);
    return data ? `url("${data}")` : whole;
  });
}

/** Replace every linked style sheet in the document with an inline <style> that has its fonts in it. */
export async function bundleStyles(doc: Document, run: ExportRun): Promise<void> {
  const links = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'));
  const cache = new Map<string, Promise<string>>();
  let done = 0;
  await Promise.all(
    links.map(async (link) => {
      const css = await inlineStylesheet(link.getAttribute('href')!, run, cache);
      const style = doc.createElement('style');
      style.textContent = css;
      link.replaceWith(style);
      done += 1;
      run.onProgress(0.6 + (0.35 * done) / links.length, 'Bundling styles and fonts...');
    }),
  );
}

export const htmlExporter: Exporter = {
  id: 'html',
  label: 'HTML',
  description: 'The preview as a single .html file, with its images inside. Looks like the preview, not like a TeX PDF.',
  icon: 'file-code',
  fileExtension: '.html',
  quality: 'preview',
  available: needsMainFile,
  options: () => [
    {
      id: 'offline',
      kind: 'checkbox',
      label: 'Work offline',
      description: 'Put the styles and fonts inside the file (about 5 MB) so it opens without the internet.',
      default: true,
    },
  ],
  async run(source, options, run) {
    const { html, warnings } = await typesetProject(source, run);
    const doc = standaloneDocument(html, source.name);
    if (options.offline) {
      run.onProgress(0.6, 'Bundling styles and fonts...');
      try {
        await bundleStyles(doc, run);
      } catch (error) {
        throwIfAborted(run.signal);
        console.warn('Export: bundling styles failed', error);
        warnings.push("Couldn't download the styles and fonts, so the file loads them from the internet when it opens.");
      }
    }
    return { files: [{ name: safeFileName(source.name, '.html'), data: new Blob([serializeDocument(doc)], { type: 'text/html;charset=utf-8' }) }], warnings };
  },
};

export type PaperSize = 'A4' | 'letter';

/**
 * Print styles for the preview. LaTeX.js leaves wide side margins for margin notes, which
 * on paper would only squeeze the text, so the page margins do that job instead.
 */
export function printCss(paper: PaperSize): string {
  return (
    `@page{size:${paper};margin:25mm 20mm;}` +
    '@media print{html{--textwidth:100%!important;--marginleftwidth:0%!important;--marginrightwidth:0%!important;' +
    'background:#fff!important;color:#000!important;}body{margin:0!important;}' +
    '.body{margin:0!important;}.lc-page-break:last-child{break-after:auto!important;}' +
    'h1,h2,h3,h4{break-after:avoid;}img,svg,figure,table,pre{break-inside:avoid;}a{color:inherit!important;}}'
  );
}

export const previewPdfExporter: Exporter = {
  id: 'pdf-preview',
  label: 'PDF',
  description:
    'Opens the print dialog with the preview, so you can choose "Save as PDF". The layout follows the preview, not real LaTeX.',
  icon: 'printer',
  fileExtension: '.pdf',
  quality: 'preview',
  printsOnly: true,
  available: needsMainFile,
  options: () => [
    {
      id: 'paper',
      kind: 'select',
      label: 'Paper size',
      choices: [
        { value: 'A4', label: 'A4' },
        { value: 'letter', label: 'US Letter' },
      ],
      default: 'A4',
    },
  ],
  async run(source, options, run) {
    const { html, warnings } = await typesetProject(source, run);
    const doc = standaloneDocument(html, source.name);
    const style = doc.createElement('style');
    style.id = 'lc-print';
    style.textContent = printCss(options.paper === 'letter' ? 'letter' : 'A4');
    doc.head.appendChild(style);
    run.onProgress(0.8, 'Opening the print dialog...');
    await run.services.print(serializeDocument(doc), run.signal);
    return { files: [], warnings, message: 'Opened the print dialog. Choose "Save as PDF" as the printer to save the file.' };
  },
};
