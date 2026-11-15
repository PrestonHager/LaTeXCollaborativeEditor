import * as Y from 'yjs';
import { ProjectDoc } from '../project/projectDoc';
import { lastCompiledPdf, setLastCompiledPdf } from '../compile/pdf/lastCompiledPdf';
import { TexCompileError, type TexEngineClient } from '../compile/pdf/texEngineClient';
import type { RunDialog } from '../ui/compilePdfDialog';
import { NOT_AVAILABLE_TITLE, browserCompilePdfDeps, createCompilePdf, pdfFileName, progressText, type CompilePdfDeps } from './compilePdf';

function fakeDialog(answer = true) {
  const calls: string[] = [];
  let closed = false;
  let cancel: (() => void) | null = null;
  const dialog = {
    dialog: document.createElement('dialog'),
    get closed() {
      return closed;
    },
    onCancel: (callback: () => void) => {
      cancel = callback;
    },
    progress: vi.fn((text: string) => calls.push(`progress ${text}`)),
    askDownload: vi.fn(async (options: { bytes: number; memoryNote?: string }) => {
      calls.push(`ask ${options.bytes}${options.memoryNote ? ' low-memory' : ''}`);
      return answer;
    }),
    fail: vi.fn((heading: string, ..._rest: unknown[]) => calls.push(`fail ${heading}`)),
    close: vi.fn(() => {
      closed = true;
      cancel?.();
    }),
    userCloses() {
      closed = true;
      cancel?.();
    },
  };
  return { dialog, calls };
}

function setup(over: Partial<CompilePdfDeps> = {}, client: Partial<TexEngineClient> = {}, answer = true) {
  const project = new ProjectDoc(new Y.Doc());
  const main = project.createTextFile('main.tex', '\\documentclass{article}\\begin{document}Hi\\end{document}');
  project.putBinaryFile('img/a.png', 'hash-a', 1);
  project.putBinaryFile('img/b.png', 'hash-b', 1);
  const { dialog, calls } = fakeDialog(answer);
  const fakeClient = {
    downloadSize: vi.fn(async () => 1000),
    compile: vi.fn(async (_options: unknown, onProgress?: (p: { stage: 'download' | 'compile'; loaded?: number; total?: number; pass?: number }) => void) => {
      onProgress?.({ stage: 'download', loaded: 500, total: 1000 });
      onProgress?.({ stage: 'compile', pass: 2 });
      return { pdf: new Uint8Array([37, 80, 68, 70]), log: '(./main.tex\nLaTeX Warning: Something on input line 1.\n)', passes: 2, exitCode: 0 };
    }),
    terminate: vi.fn(),
    ...client,
  };
  const deps: CompilePdfDeps = {
    enabled: true,
    getProject: () => project,
    blobs: { get: async (hash: string) => (hash === 'hash-a' ? new Uint8Array([1]) : undefined) },
    deviceMemory: () => undefined,
    createClient: () => fakeClient as unknown as TexEngineClient,
    openDialog: () => dialog as unknown as RunDialog,
    openPdfView: vi.fn(() => ({ dialog: document.createElement('dialog'), close: () => {}, done: Promise.resolve(1) })),
    drawPages: vi.fn(() => async () => 1),
    notice: vi.fn(),
    setDiagnostics: vi.fn(),
    openAt: vi.fn(),
    download: vi.fn(),
    setStatus: vi.fn(),
    ...over,
  };
  return { project, main, deps, dialog, calls, client: fakeClient, compilePdf: createCompilePdf(deps) };
}

describe('Compile PDF (#242)', () => {
  afterEach(() => setLastCompiledPdf(null));

  it('words progress and names the PDF after the main file', () => {
    expect(progressText({ stage: 'download', loaded: 1_500_000, total: 3_000_000 }, 'XeLaTeX')).toEqual({ text: 'Downloading the TeX engine: 1.5 MB of 3.0 MB', fraction: 0.5 });
    expect(progressText({ stage: 'download' }, 'XeLaTeX').text).toBe('Downloading the TeX engine');
    expect(progressText({ stage: 'load' }, 'XeLaTeX').text).toBe('Starting the TeX engine');
    expect(progressText({ stage: 'compile', pass: 1 }, 'XeLaTeX').text).toBe('Compiling with XeLaTeX');
    expect(progressText({ stage: 'compile', pass: 3 }, 'XeLaTeX').text).toBe('Compiling with XeLaTeX, pass 3');
    expect(pdfFileName('chapters/Thesis.TEX')).toBe('Thesis.pdf');
    expect(pdfFileName('.tex')).toBe('document.pdf');
  });

  it('says it is not available while the flag is off, without loading anything', async () => {
    const t = setup({ enabled: false });
    await t.compilePdf.run();
    expect(t.deps.notice).toHaveBeenCalledWith(NOT_AVAILABLE_TITLE, expect.stringContaining("doesn't host the engine files"));
    expect(t.calls).toEqual([]);
  });

  it('refuses on too little memory, and needs a main file', async () => {
    const low = setup({ deviceMemory: () => 1 });
    await low.compilePdf.run();
    expect(low.deps.notice).toHaveBeenCalledWith('Not enough memory for Compile PDF', expect.stringContaining('about 1 GB'));
    const empty = setup();
    empty.project.replaceAll({ name: 'x', files: [] });
    await empty.compilePdf.run();
    expect(empty.deps.notice).toHaveBeenCalledWith('No main file', expect.any(String));
  });

  it('asks before the first download, compiles, and opens the PDF view', async () => {
    const t = setup({ deviceMemory: () => 3 });
    t.project.setEngine('xelatex');
    await t.compilePdf.run();
    expect(t.calls).toEqual([
      'progress Checking the TeX engine',
      'ask 1000 low-memory',
      'progress Downloading the TeX engine: 500 B of 1.0 kB',
      'progress Compiling with XeLaTeX, pass 2',
    ]);
    const request = vi.mocked(t.client.compile).mock.calls[0][0] as { engine: string; files: { path: string }[] };
    expect(request.engine).toBe('xelatex');
    expect(request.files.map((f) => f.path)).toEqual(['img/a.png', 'main.tex']);
    // img/b.png hasn't arrived, so it's left out with a warning first.
    const diagnostics = vi.mocked(t.deps.setDiagnostics).mock.calls[0][0];
    expect(diagnostics.map((d) => d.severity)).toEqual(['warning', 'warning']);
    expect(diagnostics[0].message).toContain('img/b.png');
    expect(t.dialog.close).toHaveBeenCalled();
    // A normal close after success doesn't stop the warm worker.
    expect(t.client.terminate).not.toHaveBeenCalled();
    expect(t.deps.setStatus).toHaveBeenCalledWith('Compiled main.pdf with XeLaTeX');
    expect(lastCompiledPdf()).toMatchObject({ mainPath: 'main.tex', engine: 'xelatex' });
    const view = vi.mocked(t.deps.openPdfView).mock.calls[0][0];
    expect(view.title).toBe('main.pdf');
    view.onDownload();
    expect(t.deps.download).toHaveBeenCalledWith(lastCompiledPdf()!.bytes, 'main.pdf');
    view.onPickDiagnostic(diagnostics[1]);
    expect(t.deps.openAt).toHaveBeenCalledWith('main.tex', 1);
  });

  it('skips the question once the engine is cached, and stops when it is declined', async () => {
    const cached = setup({}, { downloadSize: vi.fn(async () => 0) });
    await cached.compilePdf.run();
    expect(cached.calls.some((c) => c.startsWith('ask'))).toBe(false);
    expect(cached.client.compile).toHaveBeenCalled();

    const declined = setup({}, {}, false);
    await declined.compilePdf.run();
    expect(declined.client.compile).not.toHaveBeenCalled();
  });

  it('shows the TeX errors when there is no PDF', async () => {
    const t = setup({}, { compile: vi.fn(async () => ({ pdf: null, log: '(./main.tex\n! Undefined control sequence.\nl.1 \\foo\n)', passes: 1, exitCode: 1 })) });
    await t.compilePdf.run();
    expect(t.calls.at(-1)).toBe('fail TeX stopped without a PDF');
    const [, text, diagnostics, pick] = t.dialog.fail.mock.calls[0] as unknown as [string, string, { line: number }[], (d: unknown) => void];
    expect(text).toContain('1 error');
    pick(diagnostics[0]);
    expect(t.deps.openAt).toHaveBeenCalledWith('main.tex', 1);
    expect(lastCompiledPdf()).toBeNull();

    const noErrors = setup({}, { compile: vi.fn(async () => ({ pdf: null, log: '', passes: 1, exitCode: 1 })) });
    await noErrors.compilePdf.run();
    expect(noErrors.dialog.fail.mock.calls[0][1]).toContain("didn't make a PDF");
  });

  it('says plainly when the site has no engine, memory runs out, or something else breaks', async () => {
    const none = setup({}, { downloadSize: vi.fn(async () => null) });
    await none.compilePdf.run();
    expect(none.calls.at(-1)).toBe(`fail ${NOT_AVAILABLE_TITLE}`);

    const oom = setup({}, { compile: vi.fn(async () => Promise.reject(new TexCompileError('memory', 'x'))) });
    await oom.compilePdf.run();
    expect(oom.calls.at(-1)).toBe('fail Out of memory');
    expect(oom.dialog.fail.mock.calls[0][1]).toContain('ran out of memory');

    const download = setup({}, { compile: vi.fn(async () => Promise.reject(new TexCompileError('download', 'HTTP 404'))) });
    await download.compilePdf.run();
    expect(download.dialog.fail).toHaveBeenCalledWith("Couldn't compile the PDF", 'HTTP 404');

    const unavailable = setup({}, { compile: vi.fn(async () => Promise.reject(new TexCompileError('unavailable', 'no'))) });
    await unavailable.compilePdf.run();
    expect(unavailable.calls.at(-1)).toBe(`fail ${NOT_AVAILABLE_TITLE}`);

    const other = setup({}, { compile: vi.fn(async () => Promise.reject(new Error('boom'))) });
    await other.compilePdf.run();
    expect(other.dialog.fail).toHaveBeenCalledWith("Couldn't compile the PDF", 'boom');
  });

  it('stops the worker when the dialog is closed mid-way, and ignores what comes back', async () => {
    let finish!: (value: unknown) => void;
    const t = setup({}, { compile: vi.fn(() => new Promise((resolve) => (finish = resolve))) as unknown as TexEngineClient['compile'] });
    const running = t.compilePdf.run();
    await vi.waitFor(() => expect(t.client.compile).toHaveBeenCalled());
    // A second run while one is going does nothing.
    await t.compilePdf.run();
    expect(t.client.compile).toHaveBeenCalledTimes(1);
    t.dialog.userCloses();
    expect(t.client.terminate).toHaveBeenCalled();
    finish({ pdf: new Uint8Array([1]), log: '', passes: 1, exitCode: 0 });
    await running;
    expect(t.deps.openPdfView).not.toHaveBeenCalled();

    const sizeThenClose = setup({}, { downloadSize: vi.fn(async () => (sizeThenClose.dialog.userCloses(), 5)) });
    await sizeThenClose.compilePdf.run();
    expect(sizeThenClose.client.compile).not.toHaveBeenCalled();

    const errorThenClose = setup({}, { compile: vi.fn(async () => (errorThenClose.dialog.userCloses(), Promise.reject(new Error('x')))) });
    await errorThenClose.compilePdf.run();
    expect(errorThenClose.dialog.fail).not.toHaveBeenCalled();
  });

  it('builds the browser dependencies', async () => {
    const deps = browserCompilePdfDeps({ getProject: vi.fn(), blobs: { get: vi.fn() }, notice: vi.fn(), setDiagnostics: vi.fn(), openAt: vi.fn(), download: vi.fn(), setStatus: vi.fn() });
    expect(deps.enabled).toBe(true);
    expect(deps.deviceMemory()).toBeUndefined();
    expect(typeof deps.drawPages(new Uint8Array())).toBe('function');
  });
});
