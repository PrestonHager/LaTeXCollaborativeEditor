/**
 * Draw one page of a PDF figure as a PNG with pdf.js, for the preview. Loaded with a dynamic
 * import, only when a document uses a PDF figure, so pdf.js stays out of the initial load.
 *
 * pdf.js parses the file in its own worker, which Vite bundles into our build (same origin, so
 * `worker-src 'self'` allows it). Only the drawing onto a canvas runs on the main thread.
 */
import { GlobalWorkerOptions, PDFWorker, getDocument } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
import type { PdfCrop, RenderedPdfFigure } from './graphicsOptions';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// One pdf.js worker for every figure, started on first use. Without it, each document would
// start (and stop) a worker of its own.
let sharedWorker: PDFWorker | null = null;

/** The longest side of a drawn figure, in pixels. Enough to stay sharp at 2x on a full-width figure. */
export const MAX_RENDER_SIDE_PX = 2000;
/** Draw at least this many pixels per bp, so small figures stay sharp on high-DPI screens. */
const MIN_SCALE = 2;
const MAX_SCALE = 4;

/** A rectangle in PDF user space, as [x1, y1, x2, y2] with x1 < x2 and y1 < y2. */
type Rect = [number, number, number, number];

/** The part of the page to show, in PDF user space. `view` is the page's own box. */
export function cropRect(view: number[], crop: PdfCrop | null): Rect | null {
  const [x0, y0, x1, y1] = view;
  let rect: Rect = [x0, y0, x1, y1];
  if (crop?.kind === 'trim') {
    const [left, bottom, right, top] = crop.values;
    rect = [x0 + left, y0 + bottom, x1 - right, y1 - top];
  } else if (crop?.kind === 'viewport') {
    const [llx, lly, urx, ury] = crop.values;
    rect = [x0 + llx, y0 + lly, x0 + urx, y0 + ury];
  }
  return rect[2] > rect[0] && rect[3] > rect[1] ? rect : null;
}

/** How much to scale a figure of this size (in bp) up when drawing it. */
export function renderScale(width: number, height: number): number {
  const fit = MAX_RENDER_SIDE_PX / Math.max(width, height, 1);
  return Math.max(Math.min(fit, MAX_SCALE), Math.min(MIN_SCALE, fit));
}

/** Draw `page` (1-based) of a PDF, cropped, as a PNG data: URL with its size in bp. */
export async function renderPdfFigure(bytes: Uint8Array, page: number, crop: PdfCrop | null): Promise<RenderedPdfFigure> {
  // pdf.js takes ownership of the buffer it's given, so hand it a copy and keep the project's bytes intact.
  // No WebAssembly decoders: the CSP doesn't allow compiling it. pdf.js falls back to JavaScript.
  sharedWorker ??= new PDFWorker();
  const task = getDocument({ data: bytes.slice(), useWasm: false, worker: sharedWorker });
  try {
    const pdf = await task.promise;
    if (page > pdf.numPages) return { error: `It has no page ${page} (it has ${pdf.numPages}).` };
    const pdfPage = await pdf.getPage(page);
    const rect = cropRect(pdfPage.view, crop);
    if (!rect) return { error: 'Its trim or viewport leaves nothing to show.' };

    // Where the crop lands at scale 1, after the page's own rotation: that's the size in bp.
    const unit = pdfPage.getViewport({ scale: 1 });
    const [ax, ay] = unit.convertToViewportPoint(rect[0], rect[1]) as number[];
    const [bx, by] = unit.convertToViewportPoint(rect[2], rect[3]) as number[];
    const width = Math.abs(bx - ax);
    const height = Math.abs(by - ay);
    const scale = renderScale(width, height);
    const viewport = pdfPage.getViewport({
      scale,
      offsetX: -Math.min(ax, bx) * scale,
      offsetY: -Math.min(ay, by) * scale,
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    // pdf.js paints a white page first, the paper the figure was drawn for. That keeps black
    // lines readable when the preview is dark.
    await pdfPage.render({ canvas, viewport }).promise;
    const url = canvas.toDataURL('image/png');
    pdfPage.cleanup();
    return { url, width, height };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    await task.destroy();
  }
}
