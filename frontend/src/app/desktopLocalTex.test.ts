import * as Y from 'yjs';
import { ProjectDoc } from '../project/projectDoc';
import {
  LOCAL_TEX_KEY,
  createLocalTex,
  decodeOutcome,
  describeTexError,
  encodeFiles,
  firstLogError,
  readLocalTexSettings,
  type LocalTexContext,
} from './desktopLocalTex';

/** What the shell answers: [ok u8][pdf length u32][pdf][log]. */
function outcome(ok: boolean, pdf: string, log: string): ArrayBuffer {
  const pdfBytes = new TextEncoder().encode(pdf);
  const logBytes = new TextEncoder().encode(log);
  const out = new Uint8Array(5 + pdfBytes.length + logBytes.length);
  out[0] = ok ? 1 : 0;
  new DataView(out.buffer).setUint32(1, pdfBytes.length);
  out.set(pdfBytes, 5);
  out.set(logBytes, 5 + pdfBytes.length);
  return out.buffer;
}

function setup(answer: (args: unknown, headers: Record<string, string>) => unknown = () => outcome(true, '%PDF', '')) {
  const project = new ProjectDoc(new Y.Doc());
  project.replaceAll({
    name: 'Paper',
    mainPath: 'main.tex',
    files: [
      { path: 'main.tex', kind: 'text', text: '% !TEX program = xelatex\n\\documentclass{article}' },
      { path: 'fig/a.png', kind: 'binary', hash: 'h1', size: 3 },
      { path: 'fig/late.png', kind: 'binary', hash: 'h2', size: 3 },
      { path: 'empty', kind: 'folder' },
    ],
  });
  const calls: { args: unknown; headers: Record<string, string> }[] = [];
  const invoke = vi.fn(async (_command: string, args?: unknown, options?: { headers: Record<string, string> }) => {
    calls.push({ args, headers: options!.headers });
    return answer(args, options!.headers);
  });
  const ctx = {
    getProject: () => project,
    getBlob: vi.fn(async (hash: string) => (hash === 'h1' ? new Uint8Array([1, 2, 3]) : undefined)),
    confirmDialog: vi.fn(async (): Promise<boolean> => true),
    promptDialog: vi.fn(async (): Promise<string | null> => ''),
    showNotice: vi.fn(),
    setStatus: vi.fn(),
    showPdf: vi.fn(),
    invoke,
  } satisfies LocalTexContext;
  return { project, ctx, calls, invoke, tex: createLocalTex(ctx) };
}

const turnOn = (texDir = '') => localStorage.setItem(LOCAL_TEX_KEY, JSON.stringify({ enabled: true, texDir }));

describe('local TeX Live in the desktop app (#264)', () => {
  beforeEach(() => localStorage.clear());

  it('is off until the person turns it on, and runs nothing then', async () => {
    const { tex, ctx, invoke } = setup();
    expect(readLocalTexSettings()).toEqual({ enabled: false, texDir: '' });
    await tex.compile();
    expect(invoke).not.toHaveBeenCalled();
    expect(ctx.showNotice).toHaveBeenCalledWith(expect.stringMatching(/Local TeX is off/));
  });

  it('turns on with an optional TeX folder, and off again', async () => {
    const { tex, ctx } = setup();
    ctx.promptDialog.mockResolvedValueOnce(' /usr/local/texlive/2025/bin/x86_64-linux ');
    await tex.setUp();
    expect(readLocalTexSettings()).toEqual({ enabled: true, texDir: '/usr/local/texlive/2025/bin/x86_64-linux' });
    const validate = (ctx.promptDialog.mock.calls[0] as unknown as [{ validate(v: string): string | null }])[0].validate;
    expect(validate('relative/bin')).toMatch(/full path/);
    expect(validate('C:\\texlive\\bin')).toBeNull();
    expect(validate('')).toBeNull();
    await tex.setUp();
    expect(readLocalTexSettings().enabled).toBe(false);
    expect(ctx.setStatus).toHaveBeenLastCalledWith('Local TeX: Off');
  });

  it('leaves it off when either step is canceled', async () => {
    const { tex, ctx } = setup();
    ctx.confirmDialog.mockResolvedValueOnce(false);
    await tex.setUp();
    ctx.promptDialog.mockResolvedValueOnce(null);
    await tex.setUp();
    expect(readLocalTexSettings().enabled).toBe(false);
    turnOn();
    ctx.confirmDialog.mockResolvedValueOnce(false);
    await tex.setUp();
    expect(readLocalTexSettings().enabled).toBe(true);
  });

  it('sends the project and the engine from the magic comment, and shows the PDF', async () => {
    turnOn('/opt/tex/bin');
    const { tex, ctx, calls } = setup();
    await tex.compile();
    expect(calls[0].headers).toEqual({ 'x-tex-program': 'latexmk', 'x-tex-engine': 'xelatex', 'x-tex-main': 'main.tex', 'x-tex-dir': '%2Fopt%2Ftex%2Fbin' });
    const body = calls[0].args as Uint8Array;
    const text = new TextDecoder().decode(body);
    expect(text).toContain('main.tex');
    expect(text).toContain('fig/a.png');
    expect(text).not.toContain('late.png');
    expect(ctx.showPdf.mock.calls[0][0]).toBe('main.pdf');
    expect(new TextDecoder().decode(ctx.showPdf.mock.calls[0][1] as Uint8Array)).toBe('%PDF');
    expect(ctx.setStatus).toHaveBeenLastCalledWith('Compiled main.pdf with latexmk');
    expect(ctx.showNotice).toHaveBeenCalledWith(expect.stringMatching(/1 file\(s\) still arriving from peers: fig\/late.png/));
  });

  it('falls back to the engine itself without latexmk', async () => {
    turnOn();
    const { tex, calls, ctx } = setup((_args, headers) => {
      if (headers['x-tex-program'] === 'latexmk') throw 'not_found: latexmk';
      return outcome(true, '%PDF', '');
    });
    await tex.compile();
    expect(calls.map((c) => c.headers['x-tex-program'])).toEqual(['latexmk', 'xelatex']);
    expect(ctx.setStatus).toHaveBeenLastCalledWith('Compiled main.pdf with xelatex');
  });

  it('shows the first LaTeX error, and a partial PDF when there is one', async () => {
    turnOn();
    const { tex, ctx } = setup(() => outcome(false, '%PDF-part', 'This is XeTeX\n./main.tex:2: Undefined control sequence.\nl.2 \\foo\n'));
    await tex.compile();
    expect(ctx.showNotice).toHaveBeenCalledWith('LaTeX error in main.tex line 2: Undefined control sequence.', true);
    expect(ctx.showPdf).toHaveBeenCalled();
    const empty = setup(() => outcome(false, '', 'nothing useful'));
    await empty.tex.compile();
    expect(empty.ctx.showNotice).toHaveBeenCalledWith(expect.stringMatching(/failed without a PDF/), true);
    expect(empty.ctx.showPdf).not.toHaveBeenCalled();
  });

  it('explains shell errors in words', async () => {
    turnOn();
    const { tex, ctx } = setup(() => {
      throw 'timed_out';
    });
    await tex.compile();
    expect(ctx.showNotice).toHaveBeenCalledWith('TeX took too long (over 3 minutes) and was stopped.', true);
    const off = { enabled: true, texDir: '' };
    expect(describeTexError('not_found: xelatex', off)).toMatch(/xelatex isn't installed on this computer’s PATH/);
    expect(describeTexError('not_found: xelatex', { enabled: true, texDir: '/opt/tex' })).toMatch(/in \/opt\/tex/);
    expect(describeTexError('too_large: the project is over 200 MB', off)).toBe("Couldn't compile: the project is over 200 MB.");
    expect(describeTexError('bad_request: the main file must be a .tex file', off)).toMatch(/^Couldn't compile: the main file/);
    expect(describeTexError(new Error('io: permission denied'), off)).toBe("Couldn't run TeX: permission denied");
    expect(describeTexError('runnable: tools/pdflatex.bat', off)).toMatch(/has tools\/pdflatex.bat, a file a program could run instead of TeX/);
  });

  it('needs a main file, and the desktop shell', async () => {
    turnOn();
    const { tex, project, ctx } = setup();
    // A project with no .tex file has no main file to compile.
    project.replaceAll({ name: 'Images', files: [{ path: 'a.png', kind: 'binary', hash: 'h1', size: 3 }] });
    await tex.compile();
    expect(ctx.showNotice).toHaveBeenCalledWith(expect.stringMatching(/Set a main file/), true);
    const noShell = createLocalTex({ ...setup().ctx, invoke: undefined });
    const shown = vi.fn();
    await createLocalTex({ ...setup().ctx, invoke: undefined, showNotice: shown }).compile();
    expect(shown).toHaveBeenCalledWith(expect.stringMatching(/isn’t the desktop app/), true);
    expect(noShell).toBeTruthy();
  });

  it('survives broken or blocked storage, staying off', () => {
    localStorage.setItem(LOCAL_TEX_KEY, '{nope');
    expect(readLocalTexSettings()).toEqual({ enabled: false, texDir: '' });
    localStorage.setItem(LOCAL_TEX_KEY, JSON.stringify({ enabled: 'yes', texDir: 3 }));
    expect(readLocalTexSettings()).toEqual({ enabled: false, texDir: '' });
  });

  it('frames files and reads the answer like the shell', () => {
    const body = encodeFiles([{ path: 'a.tex', data: new Uint8Array([7]) }]);
    expect([...body]).toEqual([0, 0, 0, 5, 97, 46, 116, 101, 120, 0, 0, 0, 1, 7]);
    const decoded = decodeOutcome(outcome(true, 'P', 'L'));
    expect({ ...decoded, pdf: [...decoded.pdf!] }).toEqual({ ok: true, pdf: [80], log: 'L' });
    expect(decodeOutcome([0, 0, 0, 0, 0, 120])).toEqual({ ok: false, pdf: null, log: 'x' });
    expect(decodeOutcome(new Uint8Array([1]))).toEqual({ ok: false, pdf: null, log: '' });
    expect(firstLogError('! LaTeX Error: File `x.sty` not found.')).toBe('LaTeX Error: File `x.sty` not found.');
    expect(firstLogError('chapters/one.tex:12: Missing $ inserted.')).toBe('chapters/one.tex line 12: Missing $ inserted.');
    expect(firstLogError('all good')).toBeNull();
  });
});
