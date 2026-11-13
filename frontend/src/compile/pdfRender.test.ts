const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
  PDFWorker: vi.fn(function PDFWorker(this: { name: string }) {
    this.name = 'shared';
  }),
}));
vi.mock('pdfjs-dist', () => pdfjs);
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker&url', () => ({ default: '/assets/pdf.worker.js' }));

import { MAX_RENDER_SIDE_PX, cropRect, renderPdfFigure, renderScale } from './pdfRender';

type FakeViewportOptions = { scale: number; offsetX?: number; offsetY?: number };

/** A page like pdf.js's: a view box, unrotated, where viewport y grows downward. */
function fakePage(view: number[]) {
  const height = view[3] - view[1];
  return {
    view,
    getViewport: vi.fn(({ scale, offsetX = 0, offsetY = 0 }: FakeViewportOptions) => ({
      scale,
      offsetX,
      offsetY,
      convertToViewportPoint: (x: number, y: number) => [(x - view[0]) * scale + offsetX, (height - (y - view[1])) * scale + offsetY],
    })),
    render: vi.fn((_params: { canvas: HTMLCanvasElement }) => ({ promise: Promise.resolve() })),
    cleanup: vi.fn(),
  };
}

function fakeDocument(pages: ReturnType<typeof fakePage>[]) {
  const destroy = vi.fn(async () => {});
  pdfjs.getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: pages.length, getPage: async (n: number) => pages[n - 1] }),
    destroy,
  });
  return destroy;
}

beforeEach(() => {
  pdfjs.getDocument.mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cropRect', () => {
  const view = [0, 0, 200, 100];

  it('keeps the whole page with no crop', () => {
    expect(cropRect(view, null)).toEqual([0, 0, 200, 100]);
  });

  it('cuts trim from each edge, and keeps a viewport box from the corner', () => {
    expect(cropRect(view, { kind: 'trim', values: [10, 20, 30, 40] })).toEqual([10, 20, 170, 60]);
    expect(cropRect([5, 5, 205, 105], { kind: 'viewport', values: [10, 20, 30, 40] })).toEqual([15, 25, 35, 45]);
  });

  it('gives null when nothing is left', () => {
    expect(cropRect(view, { kind: 'trim', values: [100, 0, 100, 0] })).toBeNull();
  });
});

describe('renderScale', () => {
  it('draws small figures at up to 4x, and keeps big ones under the pixel cap', () => {
    expect(renderScale(100, 50)).toBe(4);
    expect(renderScale(612, 792)).toBeCloseTo(MAX_RENDER_SIDE_PX / 792);
    expect(renderScale(20000, 10)).toBeCloseTo(MAX_RENDER_SIDE_PX / 20000);
  });
});

describe('renderPdfFigure', () => {
  it('uses the bundled worker, and draws a page with its size in bp', async () => {
    const page = fakePage([0, 0, 144, 96]);
    const destroy = fakeDocument([page]);
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await renderPdfFigure(bytes, 1, null);
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe('/assets/pdf.worker.js');
    expect(result).toEqual({ url: 'data:image/png;base64,AAAA', width: 144, height: 96 });
    const options = pdfjs.getDocument.mock.calls[0][0];
    expect(options.useWasm).toBe(false);
    expect(options.worker).toEqual({ name: 'shared' });
    // A copy, so pdf.js can't detach the project's own buffer.
    expect(options.data).toEqual(bytes);
    expect(options.data).not.toBe(bytes);
    const { canvas } = page.render.mock.calls[0][0];
    expect([canvas.width, canvas.height]).toEqual([144 * 4, 96 * 4]);
    expect(page.cleanup).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });

  it('shifts the page so the crop lands at the canvas corner', async () => {
    const page = fakePage([0, 0, 200, 100]);
    fakeDocument([page]);
    const result = await renderPdfFigure(new Uint8Array(), 1, { kind: 'trim', values: [100, 10, 50, 40] });
    expect(result).toEqual({ url: 'data:image/png;base64,AAAA', width: 50, height: 50 });
    // The crop's top-left at scale 1 is (100, 40), so at scale 4 the page moves by (-400, -160).
    expect(page.getViewport).toHaveBeenLastCalledWith({ scale: 4, offsetX: -400, offsetY: -160 });
  });

  it('explains a missing page, an empty crop and a broken file', async () => {
    fakeDocument([fakePage([0, 0, 10, 10])]);
    expect(await renderPdfFigure(new Uint8Array(), 3, null)).toEqual({ error: 'It has no page 3 (it has 1).' });
    fakeDocument([fakePage([0, 0, 10, 10])]);
    expect(await renderPdfFigure(new Uint8Array(), 1, { kind: 'viewport', values: [5, 5, 5, 9] })).toEqual({
      error: 'Its trim or viewport leaves nothing to show.',
    });
    pdfjs.getDocument.mockReturnValue({ promise: Promise.reject(new Error('Invalid PDF structure.')), destroy: async () => {} });
    expect(await renderPdfFigure(new Uint8Array(), 1, null)).toEqual({ error: 'Invalid PDF structure.' });
    pdfjs.getDocument.mockReturnValue({ promise: Promise.reject('odd'), destroy: async () => {} });
    expect(await renderPdfFigure(new Uint8Array(), 1, null)).toEqual({ error: 'odd' });
    // Every document shares the one pdf.js worker.
    expect(pdfjs.PDFWorker).toHaveBeenCalledTimes(1);
  });
});
