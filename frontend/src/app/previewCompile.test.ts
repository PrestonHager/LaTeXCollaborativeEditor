import * as Y from 'yjs';
import { ProjectDoc, type ProjectContent } from '../project/projectDoc';
import { starterProject } from '../project/projectIo';
import type { ProjectPreviewInput, ProjectPreviewResult } from '../compile/latexJsPreview';
import { COMPILE_DEBOUNCE_MS, COMPILE_MIN_INTERVAL_MS, createPreviewCompile } from './previewCompile';

const ok = (overrides: Partial<ProjectPreviewResult> = {}): ProjectPreviewResult => ({ html: '<p>ok</p>', errors: [], missing: [], changes: [], ...overrides });

type Hooks = Pick<Parameters<typeof createPreviewCompile>[0], 'onDiagnostics' | 'onEmpty' | 'onChanges' | 'onCompiled' | 'onCompileError' | 'missingHint' | 'loadPdfRenderer'>;

function setup(content: ProjectContent = starterProject('Paper'), hooks: Hooks = {}) {
  const project = new ProjectDoc(new Y.Doc());
  project.replaceAll(content);
  const bytes = new Map<string, Uint8Array>();
  const blobs = { has: (hash: string) => bytes.has(hash), peek: (hash: string) => bytes.get(hash) };
  let activeFileId: string | null = project.getMainFileId();
  const preview = { setLoading: vi.fn(), renderHtml: vi.fn(async (_html: string) => {}) };
  const editor = { setDiagnostics: vi.fn() };
  const compileStatusEl = document.createElement('span');
  const diagnosticsEl = document.createElement('span');
  // The worker compiler is tested on its own, so we fake it here.
  const compiler = { compile: vi.fn(async (_input: ProjectPreviewInput): Promise<ProjectPreviewResult | null> => ok()) };
  const compile = createPreviewCompile({
    getProject: () => project,
    getActiveFileId: () => activeFileId,
    blobs,
    preview,
    editor,
    compileStatusEl,
    diagnosticsEl,
    compiler,
    ...hooks,
  });
  return {
    compile,
    compiler,
    project,
    bytes,
    preview,
    editor,
    compileStatusEl,
    diagnosticsEl,
    setActive: (id: string | null) => {
      activeFileId = id;
    },
  };
}

describe('preview compile', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for typing to stop, then compiles', async () => {
    const { compile, compiler, preview, compileStatusEl } = setup();
    compile.scheduleCompile();
    compile.scheduleCompile();
    expect(compileStatusEl.textContent).toBe('Waiting');
    await vi.advanceTimersByTimeAsync(COMPILE_DEBOUNCE_MS);
    expect(compiler.compile).toHaveBeenCalledTimes(1);
    expect(compiler.compile).toHaveBeenCalledWith(expect.objectContaining({ mainPath: 'main.tex' }));
    expect(preview.renderHtml).toHaveBeenCalledWith('<p>ok</p>');
    expect(preview.setLoading).toHaveBeenLastCalledWith(false);
    expect(compileStatusEl.textContent).toBe('Compiled');
  });

  it('skips a compile when nothing changed', async () => {
    const { compile, compiler } = setup();
    await compile.runCompile();
    await compile.runCompile();
    expect(compiler.compile).toHaveBeenCalledTimes(1);
    compile.invalidate();
    await compile.runCompile();
    expect(compiler.compile).toHaveBeenCalledTimes(2);
  });

  it('keeps compiles at least the minimum interval apart', async () => {
    const { compile, compiler } = setup();
    await compile.runCompile();
    compile.compileNow();
    compile.compileNow();
    expect(compiler.compile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(COMPILE_MIN_INTERVAL_MS);
    expect(compiler.compile).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(COMPILE_MIN_INTERVAL_MS);
    compile.compileNow();
    expect(compiler.compile).toHaveBeenCalledTimes(3);
  });

  it('drops a pending debounce when compiling now', async () => {
    const { compile, compiler } = setup();
    compile.scheduleCompile();
    compile.compileNow();
    await vi.advanceTimersByTimeAsync(COMPILE_DEBOUNCE_MS + COMPILE_MIN_INTERVAL_MS);
    expect(compiler.compile).toHaveBeenCalledTimes(1);
  });

  it('says why it has nothing to compile', async () => {
    const empty = setup({ name: '', files: [] });
    await empty.compile.runCompile();
    expect(empty.compileStatusEl.textContent).toBe('Idle');
    const noMain = setup({ name: 'Paper', files: [{ path: 'notes.txt', kind: 'text', text: 'hi' }] });
    await noMain.compile.runCompile();
    expect(noMain.compileStatusEl.textContent).toBe('No main file');
    expect(empty.compiler.compile).not.toHaveBeenCalled();
    expect(noMain.compiler.compile).not.toHaveBeenCalled();
  });

  it('shows errors, and only the open file gets them in the editor', async () => {
    const { compile, compiler, editor, diagnosticsEl, project, setActive } = setup();
    const chapter = project.createTextFile('chapter.tex', 'x');
    compiler.compile.mockResolvedValue(
      ok({
        errors: [
          { path: 'main.tex', line: 2, severity: 'error', message: 'Bad' },
          { path: 'chapter.tex', line: 1, severity: 'error', message: 'Worse' },
        ],
      }),
    );
    setActive(chapter);
    await compile.runCompile();
    expect(diagnosticsEl.textContent).toBe('2 diagnostic(s). Bad (main.tex line 2)');
    expect(editor.setDiagnostics).toHaveBeenCalledWith([expect.objectContaining({ message: 'Worse' })]);
  });

  it('lists files the document asked for that are not in the project', async () => {
    const { compile, compiler, diagnosticsEl } = setup();
    compiler.compile.mockResolvedValue(ok({ missing: ['fig.png'] }));
    await compile.runCompile();
    expect(diagnosticsEl.textContent).toBe('Not found in the project: fig.png');
  });

  it('adds a hint after missing files when there is one', async () => {
    let hint = 'Look in Drive.';
    const { compile, compiler, diagnosticsEl } = setup(starterProject('Paper'), { missingHint: () => hint });
    compiler.compile.mockResolvedValue(ok({ missing: ['fig.png'] }));
    await compile.runCompile();
    expect(diagnosticsEl.textContent).toBe('Not found in the project: fig.png. Look in Drive.');
    hint = '';
    compile.invalidate();
    await compile.runCompile();
    expect(diagnosticsEl.textContent).toBe('Not found in the project: fig.png');
  });

  it('reports a compile that fails', async () => {
    const { compile, compiler, editor, compileStatusEl, diagnosticsEl } = setup();
    compiler.compile.mockRejectedValue(new Error('boom'));
    await compile.runCompile();
    expect(compileStatusEl.textContent).toBe('Compile Error');
    expect(diagnosticsEl.textContent).toBe('Error: boom');
    expect(editor.setDiagnostics).toHaveBeenCalledWith([{ line: 1, severity: 'error', message: 'Error: boom' }]);
  });

  it('ignores a compile the worker superseded', async () => {
    const { compile, compiler, preview, compileStatusEl } = setup();
    compiler.compile.mockResolvedValue(null);
    await compile.runCompile();
    expect(preview.renderHtml).not.toHaveBeenCalled();
    expect(compileStatusEl.textContent).toBe('Compiling');
    // It never finished, so the next run compiles again.
    compiler.compile.mockResolvedValue(ok());
    await compile.runCompile();
    expect(compiler.compile).toHaveBeenCalledTimes(2);
  });

  it('leaves the loading state to the newest compile', async () => {
    const { compile, compiler, preview, project } = setup();
    let finishFirst: (result: ProjectPreviewResult) => void = () => undefined;
    compiler.compile.mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)));
    const first = compile.runCompile();
    project.createTextFile('more.tex', 'y');
    await compile.runCompile();
    preview.setLoading.mockClear();
    preview.renderHtml.mockClear();
    finishFirst(ok());
    await first;
    expect(preview.setLoading).not.toHaveBeenCalled();
    expect(preview.renderHtml).not.toHaveBeenCalled();
  });

  it('hands images to the compiler as cached data URLs', async () => {
    const { compile, compiler, project, bytes } = setup();
    project.putBinaryFile('fig.png', 'h1', 3);
    project.putBinaryFile('gone.png', 'h2', 3);
    project.putBinaryFile('data.bin', 'h3', 3);
    bytes.set('h1', new Uint8Array([1, 2, 3]));
    bytes.set('h3', new Uint8Array([1, 2, 3]));
    await compile.runCompile();
    const { imageUrls, binaryPaths } = compiler.compile.mock.calls[0][0];
    expect(binaryPaths).toEqual(expect.arrayContaining(['fig.png', 'gone.png', 'data.bin']));
    expect([...imageUrls]).toEqual([['fig.png', 'data:image/png;base64,AQID']]);
    // The bytes are gone now, but the URL was cached by hash.
    bytes.delete('h1');
    compile.invalidate();
    await compile.runCompile();
    expect(compiler.compile.mock.calls[1][0].imageUrls.get('fig.png')).toBe('data:image/png;base64,AQID');
  });

  it('passes EPS boxes in, and draws PDF figures before showing the document', async () => {
    const render = vi.fn(async () => ({ url: 'data:image/png;base64,PDF', width: 20, height: 10 }));
    const loadPdfRenderer = vi.fn(async () => render);
    const { compile, compiler, project, bytes, preview } = setup(starterProject('Paper'), { loadPdfRenderer });
    project.putBinaryFile('plot.pdf', 'pdf', 4);
    project.putBinaryFile('wave.eps', 'eps', 30);
    bytes.set('pdf', new Uint8Array([37, 80, 68, 70]));
    bytes.set('eps', new TextEncoder().encode('%!PS\n%%BoundingBox: 0 0 40 20\n'));
    const request = { path: 'plot.pdf', renderKey: 'p1', page: 1, crop: null };
    compiler.compile.mockResolvedValueOnce(ok({ html: '<p>first</p>', pdfFigures: [request] }));
    compiler.compile.mockResolvedValueOnce(ok({ html: '<p>with figure</p>', pdfFigures: [request] }));
    await compile.runCompile();
    expect(compiler.compile).toHaveBeenCalledTimes(2);
    expect(compiler.compile.mock.calls[0][0].epsBoxes).toEqual(new Map([['wave.eps', { width: 40, height: 20 }]]));
    expect(compiler.compile.mock.calls[1][0].pdfImages).toEqual(new Map([['plot.pdf#p1', { url: 'data:image/png;base64,PDF', width: 20, height: 10 }]]));
    expect(preview.renderHtml).toHaveBeenCalledTimes(1);
    expect(preview.renderHtml).toHaveBeenCalledWith('<p>with figure</p>');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("doesn't load the figure code for a project with no PDF or EPS files", async () => {
    const loadPdfRenderer = vi.fn();
    const { compile, compiler } = setup(starterProject('Paper'), { loadPdfRenderer });
    await compile.runCompile();
    expect(compiler.compile.mock.calls[0][0].epsBoxes).toBeUndefined();
    expect(loadPdfRenderer).not.toHaveBeenCalled();
  });

  it('tells the page about diagnostics, an empty project, and each compile outcome', async () => {
    const hooks = { onDiagnostics: vi.fn(), onEmpty: vi.fn(), onCompiled: vi.fn(), onCompileError: vi.fn() };
    const { compile, compiler, project } = setup(starterProject('Paper'), hooks);
    compiler.compile.mockResolvedValueOnce(ok({ errors: [{ path: 'main.tex', line: 2, severity: 'error', message: 'oops' }] }));
    await compile.runCompile();
    expect(hooks.onEmpty).toHaveBeenLastCalledWith(false);
    expect(hooks.onCompiled).toHaveBeenCalledTimes(1);
    expect(hooks.onDiagnostics).toHaveBeenLastCalledWith('1 diagnostic(s). oops (main.tex line 2)', 'diagnostics');

    compiler.compile.mockRejectedValueOnce(new Error('broken'));
    compile.invalidate();
    await compile.runCompile();
    expect(hooks.onCompileError).toHaveBeenCalledTimes(1);
    expect(hooks.onDiagnostics).toHaveBeenLastCalledWith('Error: broken', 'previewErrors');

    project.replaceAll({ name: 'Empty', files: [] });
    await compile.runCompile();
    expect(hooks.onEmpty).toHaveBeenLastCalledWith(true);
    expect(hooks.onDiagnostics).toHaveBeenLastCalledWith('', 'diagnostics');
  });

  it('passes the changes on with each rendered document, and clears them with no main file', async () => {
    const hooks = { onChanges: vi.fn() };
    const { compile, compiler } = setup(starterProject('Paper'), hooks);
    compiler.compile.mockResolvedValueOnce(ok({ changes: ['Removed \\vspace.', 'Footnotes show inline.'] }));
    await compile.runCompile();
    expect(hooks.onChanges).toHaveBeenLastCalledWith(['Removed \\vspace.', 'Footnotes show inline.']);

    // A failed parse keeps the last document up, so its list stays as well.
    compiler.compile.mockResolvedValueOnce(ok({ html: null, changes: ['Something else.'] }));
    compile.invalidate();
    await compile.runCompile();
    expect(hooks.onChanges).toHaveBeenCalledTimes(1);

    compiler.compile.mockResolvedValueOnce(ok());
    compile.invalidate();
    await compile.runCompile();
    expect(hooks.onChanges).toHaveBeenLastCalledWith([]);

    expect(hooks.onChanges).toHaveBeenCalledTimes(2);

    const noMainHooks = { onChanges: vi.fn() };
    const noMain = setup({ name: 'Paper', files: [{ path: 'notes.txt', kind: 'text', text: 'hi' }] }, noMainHooks);
    await noMain.compile.runCompile();
    expect(noMainHooks.onChanges).toHaveBeenCalledWith([]);
  });
});
