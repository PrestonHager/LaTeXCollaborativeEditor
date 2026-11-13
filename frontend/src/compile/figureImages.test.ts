import { FigureImages, compileWithFigures, createFigureCompile, type RenderPdfFigure } from './figureImages';
import type { ProjectPreviewInput, ProjectPreviewResult } from './latexJsPreview';

const EPS = new TextEncoder().encode('%!PS\n%%BoundingBox: 0 0 144 72\n');
const PDF = new Uint8Array([37, 80, 68, 70]);

function setup(store: Record<string, Uint8Array> = { eps1: EPS, pdf1: PDF }) {
  const bytes = vi.fn((hash: string) => store[hash] ?? null);
  const render = vi.fn<RenderPdfFigure>(async (_bytes, page) => ({ url: `data:image/png;base64,P${page}`, width: 10, height: 5 }));
  const load = vi.fn(async () => render);
  return { bytes, render, load, figures: new FigureImages(bytes, load) };
}

const input = (): ProjectPreviewInput => ({ mainPath: 'main.tex', texts: new Map(), binaryPaths: [], imageUrls: new Map() });
const result = (overrides: Partial<ProjectPreviewResult> = {}): ProjectPreviewResult => ({ html: '<p></p>', errors: [], missing: [], changes: [], ...overrides });
const request = (page = 1) => ({ path: 'fig/plot.pdf', renderKey: `p${page}`, page, crop: null });

describe('FigureImages', () => {
  it('reads EPS boxes once per hash, and skips files with no hash or bytes', async () => {
    const { figures, bytes } = setup();
    const files = [
      { path: 'a.eps', hash: 'eps1' },
      { path: 'copy.eps', hash: 'eps1' },
      { path: 'waiting.eps', hash: 'missing' },
      { path: 'new.eps' },
      { path: 'x.png', hash: 'png' },
    ];
    const first = await figures.inputs(files);
    expect(first.epsBoxes).toEqual(
      new Map([
        ['a.eps', { width: 144, height: 72 }],
        ['copy.eps', { width: 144, height: 72 }],
      ]),
    );
    await figures.inputs(files);
    expect(bytes.mock.calls.filter(([hash]) => hash === 'eps1')).toHaveLength(1);
  });

  it('draws only the PDF pages it has not drawn, and loads pdf.js only when it must', async () => {
    const { figures, render, load } = setup();
    const files = [{ path: 'fig/plot.pdf', hash: 'pdf1' }, { path: 'later.pdf' }];
    expect(await figures.render([], files)).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(await figures.render([request(1), request(2), { ...request(1), path: 'later.pdf' }, { ...request(1), path: 'gone.pdf' }], files)).toBe(true);
    expect(render.mock.calls.map(([, page]) => page)).toEqual([1, 2]);
    expect(await figures.render([request(2)], files)).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
    // A moved file with the same bytes reuses the drawing.
    const moved = await figures.inputs([{ path: 'moved.pdf', hash: 'pdf1' }]);
    expect([...moved.pdfImages!.keys()]).toEqual(['moved.pdf#p1', 'moved.pdf#p2']);
  });

  it('skips a PDF whose bytes have not arrived', async () => {
    const { figures, render } = setup({});
    expect(await figures.render([request()], [{ path: 'fig/plot.pdf', hash: 'pdf1' }])).toBe(false);
    expect(render).not.toHaveBeenCalled();
  });
});

describe('compileWithFigures', () => {
  const files = [{ path: 'fig/plot.pdf', hash: 'pdf1' }];

  it('compiles once when there are no PDF figures', async () => {
    const { figures } = setup();
    const compile = vi.fn(async () => result());
    await compileWithFigures(figures, files, input(), compile);
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('draws the pages the first compile asks for, then compiles again with them', async () => {
    const { figures } = setup();
    const compile = vi.fn(async (_input: ProjectPreviewInput) => result({ pdfFigures: [request()] }));
    await compileWithFigures(figures, files, input(), compile);
    expect(compile).toHaveBeenCalledTimes(2);
    expect(compile.mock.calls[0][0].pdfImages).toEqual(new Map());
    expect(compile.mock.calls[1][0].pdfImages).toEqual(new Map([['fig/plot.pdf#p1', { url: 'data:image/png;base64,P1', width: 10, height: 5 }]]));
    // Next time the drawing is passed in from the start, so one compile is enough.
    compile.mockClear();
    await compileWithFigures(figures, files, input(), compile);
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('stops when a newer compile took over, or the first one was replaced', async () => {
    const { figures, load } = setup();
    const compile = vi.fn(async () => result({ pdfFigures: [request()] }));
    await compileWithFigures(figures, files, input(), compile, () => false);
    expect(load).not.toHaveBeenCalled();
    let current = true;
    const stale = vi.fn(async () => {
      const out = result({ pdfFigures: [request()] });
      current = false;
      return out;
    });
    await compileWithFigures(figures, files, input(), stale, () => current);
    expect(stale).toHaveBeenCalledTimes(1);
    expect(await compileWithFigures(figures, files, input(), async () => null)).toBeNull();
  });

  it('shows the document without PDF figures, and says why, when pdf.js fails to load', async () => {
    const figures = new FigureImages(() => PDF, async () => {
      throw new Error('offline');
    });
    const compile = vi.fn(async () => result({ pdfFigures: [request()] }));
    const out = await compileWithFigures(figures, files, input(), compile);
    expect(compile).toHaveBeenCalledTimes(1);
    expect(out!.changes).toEqual(["Couldn't load the PDF renderer, so PDF figures are left out. Error: offline"]);
  });
});

describe('createFigureCompile', () => {
  it('keeps one cache and reads bytes from the blob store', async () => {
    const render = vi.fn<RenderPdfFigure>(async () => ({ url: 'data:,', width: 1, height: 1 }));
    const run = createFigureCompile({ peek: (hash) => (hash === 'pdf1' ? PDF : undefined) }, async () => render);
    const compiler = { compile: vi.fn(async () => result({ pdfFigures: [request()] })) };
    await run([{ path: 'fig/plot.pdf', hash: 'pdf1' }], input(), compiler, () => true);
    await run([{ path: 'fig/plot.pdf', hash: 'pdf1' }], input(), compiler, () => true);
    expect(render).toHaveBeenCalledTimes(1);
    expect(compiler.compile).toHaveBeenCalledTimes(3);
  });
});
