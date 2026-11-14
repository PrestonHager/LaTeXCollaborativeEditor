import { FakeCacheStorage } from '../../test/fakeCacheStorage';
import { FakeTexEngine } from '../../test/fakeTexEngine';
import { ORIGIN, fakeAssets } from '../../test/texAssets';
import { TexAssetCache } from './texAssetCache';
import { TexManifestError, type TexAssetManifest } from './texAssetManifest';
import { MEMORY_MESSAGE, UNAVAILABLE_MESSAGE, classifyError, createTexEngineHost, outputStem } from './texEngineHost';
import type { TexEngineResponse } from './texEngineProtocol';

async function setup(options: { manifest?: TexAssetManifest | null; glue?: unknown } = {}) {
  const assets = await fakeAssets();
  const engine = new FakeTexEngine();
  const posts: TexEngineResponse[] = [];
  const cache = new TexAssetCache({ caches: new FakeCacheStorage().asCacheStorage(), fetch: assets.fetchFn, origin: ORIGIN });
  const createTexEngine = vi.fn(async () => engine);
  const importGlue = vi.fn(async () => ('glue' in options ? options.glue : { createTexEngine }));
  const loadManifest = vi.fn(async () => (options.manifest === undefined ? assets.manifest : options.manifest));
  const host = createTexEngineHost({ loadManifest, cache, importGlue, post: (response) => posts.push(response) });
  const compile = (id: number, main: string, extra: Record<string, unknown> = {}) =>
    host.handle({ kind: 'compile', id, engine: 'pdflatex', mainPath: 'main.tex', files: [{ path: 'main.tex', data: main }, { path: 'img/a.png', data: new Uint8Array([1]) }], ...extra });
  const last = () => posts.at(-1)!;
  return { ...assets, engine, posts, host, compile, last, createTexEngine, importGlue, loadManifest };
}

describe('Compile PDF worker host (#241)', () => {
  it('names outputs after the main file', () => {
    expect(outputStem('chapters/Main.TEX')).toBe('chapters/Main');
    expect(outputStem('paper')).toBe('paper');
  });

  it('downloads and starts the engine once, then compiles to a PDF and a log', async () => {
    const t = await setup();
    await t.compile(1, 'Hello');
    expect(t.posts.map((p) => (p.kind === 'progress' ? p.stage : p.kind))).toEqual(['download', 'download', 'download', 'load', 'compile', 'result']);
    expect(t.last()).toMatchObject({ kind: 'result', id: 1, passes: 1, exitCode: 0 });
    const result = t.last() as Extract<TexEngineResponse, { kind: 'result' }>;
    expect(new TextDecoder().decode(result.pdf!)).toBe('%PDF-1.7 fake');
    expect(result.log).toContain('Output written on main.pdf');
    expect(t.engine.loadedWith).toEqual({ assets: ['basic.data', 'pdftex.wasm'], engine: 'pdflatex' });
    expect(t.importGlue).toHaveBeenCalledWith(t.manifest.glue);

    t.posts.length = 0;
    await t.compile(2, 'Again');
    expect(t.posts.map((p) => p.kind)).toEqual(['progress', 'result']);
    expect(t.createTexEngine).toHaveBeenCalledTimes(1);
    expect(t.loadManifest).toHaveBeenCalledTimes(1);
    // Only the second compile's files are in the engine.
    expect(t.engine.files.has('img/a.png')).toBe(true);
  });

  it('reruns while LaTeX asks for it, and stops at the pass limit', async () => {
    const t = await setup();
    await t.compile(1, 'See \\ref{x}');
    expect(t.last()).toMatchObject({ kind: 'result', passes: 2 });
    await t.compile(2, '\\loop');
    expect(t.last()).toMatchObject({ kind: 'result', passes: 3 });
    await t.compile(3, '\\loop', { maxPasses: 99 });
    expect(t.last()).toMatchObject({ kind: 'result', passes: 5 });
    await t.compile(4, '\\loop', { maxPasses: 0 });
    expect(t.last()).toMatchObject({ kind: 'result', passes: 1 });
  });

  it('returns the log and no PDF when TeX stops on an error', async () => {
    const t = await setup();
    await t.compile(1, '\\fail');
    expect(t.last()).toMatchObject({ kind: 'result', exitCode: 1, passes: 1, pdf: null });
    expect((t.last() as { log: string }).log).toContain('Undefined control sequence');
  });

  it('says plainly when the engine runs out of memory, and starts it fresh next time', async () => {
    const t = await setup();
    await t.compile(1, '\\oom');
    expect(t.last()).toEqual({ kind: 'error', id: 1, reason: 'memory', message: MEMORY_MESSAGE });
    await t.compile(2, 'fine');
    expect(t.last()).toMatchObject({ kind: 'result', id: 2 });
    expect(t.createTexEngine).toHaveBeenCalledTimes(2);
  });

  it('is unavailable without a manifest or without the engine, and answers size requests', async () => {
    const none = await setup({ manifest: null });
    await none.compile(1, 'x');
    expect(none.last()).toEqual({ kind: 'error', id: 1, reason: 'unavailable', message: UNAVAILABLE_MESSAGE });
    await none.host.handle({ kind: 'size', id: 2, engine: 'pdflatex' });
    expect(none.last()).toEqual({ kind: 'size', id: 2, bytes: 0, available: false });

    const t = await setup();
    await t.host.handle({ kind: 'size', id: 3, engine: 'pdflatex' });
    expect(t.last()).toEqual({ kind: 'size', id: 3, bytes: 24, available: true });
    await t.host.handle({ kind: 'compile', id: 4, engine: 'lualatex', mainPath: 'main.tex', files: [] });
    expect(t.last()).toMatchObject({ kind: 'error', reason: 'unavailable', message: expect.stringContaining('no LuaLaTeX') });
  });

  it('reports a broken glue module, a download failure, and a manifest error', async () => {
    const badGlue = await setup({ glue: {} });
    await badGlue.compile(1, 'x');
    expect(badGlue.last()).toMatchObject({ kind: 'error', reason: 'engine' });

    const t = await setup();
    t.bodies.clear();
    await t.compile(2, 'x');
    expect(t.last()).toMatchObject({ kind: 'error', reason: 'download', message: expect.stringContaining('HTTP 404') });

    const broken = await setup();
    broken.loadManifest.mockRejectedValueOnce(new TexManifestError('bad'));
    await broken.host.handle({ kind: 'size', id: 5, engine: 'pdflatex' });
    expect(broken.last()).toEqual({ kind: 'size', id: 5, bytes: 0, available: false });
    // A failed manifest load is tried again.
    await broken.host.handle({ kind: 'size', id: 6, engine: 'pdflatex' });
    expect(broken.last()).toMatchObject({ kind: 'size', available: true });

    const network = await setup();
    network.loadManifest.mockRejectedValueOnce(new Error('offline'));
    await network.host.handle({ kind: 'size', id: 7, engine: 'pdflatex' });
    expect(network.last()).toMatchObject({ kind: 'error', reason: 'engine', message: expect.stringContaining('offline') });
  });

  it('sorts errors into reasons', () => {
    expect(classifyError(new RangeError('Array buffer allocation failed')).reason).toBe('memory');
    expect(classifyError('memory access out of bounds').reason).toBe('engine');
    expect(classifyError('Aborted(OOM)').reason).toBe('memory');
    expect(classifyError(new Error('x'.repeat(400))).message.length).toBeLessThan(340);
  });
});
