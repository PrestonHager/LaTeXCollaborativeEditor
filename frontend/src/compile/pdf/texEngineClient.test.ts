import { FakeCacheStorage } from '../../test/fakeCacheStorage';
import { FakeTexEngine } from '../../test/fakeTexEngine';
import { ORIGIN, fakeAssets } from '../../test/texAssets';
import { TexAssetCache } from './texAssetCache';
import { createTexEngineHost } from './texEngineHost';
import { TexCompileError, TexEngineClient, type TexWorker } from './texEngineClient';
import type { TexEngineRequest, TexEngineResponse } from './texEngineProtocol';

/** A worker that runs the real host in this thread, with the fake engine. */
async function fakeWorkerFactory() {
  const assets = await fakeAssets();
  const workers: (TexWorker & { requests: TexEngineRequest[]; terminated: boolean })[] = [];
  const create = () => {
    const worker = {
      onmessage: null as TexWorker['onmessage'],
      onerror: null as TexWorker['onerror'],
      requests: [] as TexEngineRequest[],
      terminated: false,
      host: createTexEngineHost({
        loadManifest: async () => assets.manifest,
        cache: new TexAssetCache({ caches: new FakeCacheStorage().asCacheStorage(), fetch: assets.fetchFn, origin: ORIGIN }),
        importGlue: async () => ({ createTexEngine: async () => new FakeTexEngine() }),
        post: (response: TexEngineResponse) => worker.onmessage?.({ data: response } as MessageEvent<TexEngineResponse>),
      }),
      postMessage(message: TexEngineRequest) {
        worker.requests.push(message);
        void worker.host.handle(message);
      },
      terminate() {
        worker.terminated = true;
      },
    };
    workers.push(worker);
    return worker;
  };
  return { create, workers };
}

describe('Compile PDF client (#241)', () => {
  it('starts one worker, keeps it between compiles, and passes progress on', async () => {
    const { create, workers } = await fakeWorkerFactory();
    const client = new TexEngineClient(create);
    expect(await client.downloadSize('pdflatex')).toBe(24);
    expect(await client.downloadSize('lualatex')).toBeNull();
    const stages: string[] = [];
    const result = await client.compile({ engine: 'pdflatex', mainPath: 'main.tex', files: [{ path: 'main.tex', data: 'hi' }] }, (p) => stages.push(p.stage));
    expect(result).toMatchObject({ passes: 1, exitCode: 0 });
    expect(stages).toEqual(['download', 'download', 'download', 'load', 'compile']);
    await client.compile({ engine: 'pdflatex', mainPath: 'main.tex', files: [{ path: 'main.tex', data: 'again' }] });
    expect(workers).toHaveLength(1);
  });

  it('rejects with the reason the worker gave', async () => {
    const { create } = await fakeWorkerFactory();
    const client = new TexEngineClient(create);
    const error = await client.compile({ engine: 'pdflatex', mainPath: 'main.tex', files: [{ path: 'main.tex', data: '\\oom' }] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TexCompileError);
    expect((error as TexCompileError).reason).toBe('memory');
  });

  it('fails what is waiting when the worker dies or is stopped, then starts a new one', async () => {
    const worker = { onmessage: null, onerror: null, postMessage: vi.fn(), terminate: vi.fn() } as unknown as TexWorker;
    const create = vi.fn(() => worker);
    const client = new TexEngineClient(create);
    const pending = client.compile({ engine: 'pdflatex', mainPath: 'm.tex', files: [] });
    worker.onerror!({ message: 'Out of memory', preventDefault: vi.fn() } as unknown as ErrorEvent);
    await expect(pending).rejects.toMatchObject({ reason: 'memory' });
    expect(worker.terminate).toHaveBeenCalled();

    const second = client.compile({ engine: 'pdflatex', mainPath: 'm.tex', files: [] });
    worker.onerror!({ message: '' } as ErrorEvent);
    await expect(second).rejects.toMatchObject({ reason: 'engine', message: 'The TeX engine stopped unexpectedly.' });

    const third = client.compile({ engine: 'pdflatex', mainPath: 'm.tex', files: [] });
    client.terminate();
    await expect(third).rejects.toThrow('stopped');
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('ignores answers for requests it is not waiting on, and odd answers', async () => {
    const worker = { onmessage: null, onerror: null, postMessage: vi.fn(), terminate: vi.fn() } as unknown as TexWorker;
    const client = new TexEngineClient(() => worker);
    const pending = client.compile({ engine: 'pdflatex', mainPath: 'm.tex', files: [] });
    worker.onmessage!({ data: { kind: 'result', id: 99, pdf: null, log: '', passes: 1, exitCode: 0 } } as MessageEvent<TexEngineResponse>);
    worker.onmessage!({ data: { kind: 'size', id: 1, bytes: 0, available: true } } as MessageEvent<TexEngineResponse>);
    await expect(pending).rejects.toThrow('something unexpected');
    const size = client.downloadSize('pdflatex');
    worker.onmessage!({ data: { kind: 'result', id: 2, pdf: null, log: '', passes: 1, exitCode: 0 } } as MessageEvent<TexEngineResponse>);
    expect(await size).toBeNull();
  });
});
