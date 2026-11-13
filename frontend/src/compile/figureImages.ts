/**
 * PDF and EPS figures for the preview, from the main thread. The compile worker can't read
 * project bytes or draw on a canvas, so this side does that and hands the results in:
 * - EPS files: their %%BoundingBox, for a placeholder box of the right size.
 * - PDF files: the pages the document asks for (the compile result's `pdfFigures`), drawn as
 *   images with pdf.js. pdf.js only loads once a document uses a PDF figure.
 * Both are cached by the file's content hash, so a re-compile doesn't redo them.
 */
import { extension } from '../project/paths';
import { parseEpsBoundingBox, type EpsBox } from './epsBoundingBox';
import { pdfImageKey, type PdfCrop, type RenderedPdfFigure } from './graphicsOptions';
import type { PdfFigureRequest, ProjectPreviewInput, ProjectPreviewResult } from './latexJsPreview';

/** A binary project file: its path and content hash (none until it's stored). */
export type FigureFile = { path: string; hash?: string };

export type RenderPdfFigure = (bytes: Uint8Array, page: number, crop: PdfCrop | null) => Promise<RenderedPdfFigure>;

const loadRenderer = async (): Promise<RenderPdfFigure> => (await import('./pdfRender')).renderPdfFigure;

/** Inputs for the compile that hold the figures we already have. */
export type FigureInputs = Pick<ProjectPreviewInput, 'pdfImages' | 'epsBoxes'>;

export class FigureImages {
  private readonly epsBoxes = new Map<string, EpsBox | null>();
  private readonly pdfImages = new Map<string, RenderedPdfFigure>();

  private readonly bytes: (hash: string) => Uint8Array | null | undefined | Promise<Uint8Array | null | undefined>;
  private readonly load: () => Promise<RenderPdfFigure>;

  /**
   * `bytes` gets a file's bytes by content hash, or nothing if they haven't arrived; it can be
   * async. `load` loads the PDF renderer, which by default is pdf.js, lazily.
   */
  constructor(bytes: FigureImages['bytes'], load: () => Promise<RenderPdfFigure> = loadRenderer) {
    this.bytes = bytes;
    this.load = load;
  }

  /** The EPS boxes and drawn PDF pages we have for these files, to pass into a compile. */
  async inputs(files: FigureFile[]): Promise<FigureInputs> {
    const epsBoxes = new Map<string, EpsBox | null>();
    const pdfImages = new Map<string, RenderedPdfFigure>();
    for (const file of files) {
      if (!file.hash) continue;
      const ext = extension(file.path);
      if (ext === 'eps') {
        if (!this.epsBoxes.has(file.hash)) {
          const bytes = await this.bytes(file.hash);
          if (!bytes) continue;
          this.epsBoxes.set(file.hash, parseEpsBoundingBox(bytes));
        }
        epsBoxes.set(file.path, this.epsBoxes.get(file.hash)!);
      } else if (ext === 'pdf') {
        const prefix = `${file.hash}#`;
        for (const [key, image] of this.pdfImages) {
          if (key.startsWith(prefix)) pdfImages.set(pdfImageKey(file.path, key.slice(prefix.length)), image);
        }
      }
    }
    return { epsBoxes, pdfImages };
  }

  /**
   * Draw the PDF pages a compile asked for that we haven't drawn yet. Returns true if it drew
   * anything, so the caller knows to compile again with them.
   */
  async render(requests: PdfFigureRequest[] | undefined, files: FigureFile[]): Promise<boolean> {
    const hashes = new Map(files.map((file) => [file.path, file.hash]));
    let drew = false;
    let render: RenderPdfFigure | null = null;
    for (const request of requests ?? []) {
      const hash = hashes.get(request.path);
      if (!hash) continue;
      const key = `${hash}#${request.renderKey}`;
      if (this.pdfImages.has(key)) continue;
      const bytes = await this.bytes(hash);
      if (!bytes) continue;
      // A file pdf.js can't read comes back as { error }, which is cached like an image. Only a
      // failure to load pdf.js itself (offline, say) throws, and that isn't cached.
      render ??= await this.load();
      this.pdfImages.set(key, await render(bytes, request.page, request.crop));
      drew = true;
    }
    return drew;
  }
}

/**
 * Compile with figures: once with what's cached, then, if the document wants PDF pages we haven't
 * drawn, draw them and compile again. `compile` returns null when a newer compile replaced it.
 */
export async function compileWithFigures(
  figures: FigureImages,
  files: FigureFile[],
  input: ProjectPreviewInput,
  compile: (input: ProjectPreviewInput) => Promise<ProjectPreviewResult | null>,
  isCurrent: () => boolean = () => true,
): Promise<ProjectPreviewResult | null> {
  const first = await compile({ ...input, ...(await figures.inputs(files)) });
  if (!first || !isCurrent() || !first.pdfFigures?.length) return first;
  let drew: boolean;
  try {
    drew = await figures.render(first.pdfFigures, files);
  } catch (error) {
    // Show the document without the PDF figures, and say why.
    return { ...first, changes: [...first.changes, `Couldn't load the PDF renderer, so PDF figures are left out. ${String(error)}`] };
  }
  if (!drew || !isCurrent()) return first;
  return compile({ ...input, ...(await figures.inputs(files)) });
}

/** Compile with figures, keeping one cache across compiles. See compileWithFigures. */
export type FigureCompile = (
  files: FigureFile[],
  input: ProjectPreviewInput,
  compiler: { compile(input: ProjectPreviewInput): Promise<ProjectPreviewResult | null> },
  isCurrent: () => boolean,
) => Promise<ProjectPreviewResult | null>;

/** The preview's figure compiler, reading bytes from the blob store's memory cache. */
export function createFigureCompile(blobs: { peek(hash: string): Uint8Array | null | undefined }, load?: () => Promise<RenderPdfFigure>): FigureCompile {
  const images = new FigureImages((hash) => blobs.peek(hash), load);
  return (files, input, compiler, isCurrent) => compileWithFigures(images, files, input, (next) => compiler.compile(next), isCurrent);
}
