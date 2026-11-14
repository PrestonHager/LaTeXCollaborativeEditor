import { FakeCacheStorage } from '../../test/fakeCacheStorage';
import { MANIFEST_URL, fakeAssets } from '../../test/texAssets';
import { fetchManifest, importGlueModule, serveTexEngine } from './texEngine.worker';
import type { TexEngineResponse } from './texEngineProtocol';

describe('Compile PDF worker entry (#241)', () => {
  it('treats a missing manifest as no engine, and checks the one it gets', async () => {
    const { raw } = await fakeAssets();
    const respond = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await fetchManifest(MANIFEST_URL, respond({}, 404))).toBeNull();
    await expect(fetchManifest(MANIFEST_URL, respond({}, 500))).rejects.toThrow('HTTP 500');
    expect((await fetchManifest(MANIFEST_URL, respond(raw)))!.version).toBe('2026.1-test');
    await expect(fetchManifest(MANIFEST_URL, respond({ version: 'x' }))).rejects.toThrow('broken');
  });

  it('imports the glue from its URL', async () => {
    await expect(importGlueModule({ name: 'glue.js', url: 'data:text/javascript,export const createTexEngine = 1', sha256: '', size: 0 })).resolves.toMatchObject({
      createTexEngine: 1,
    });
  });

  it('answers requests on the worker scope, from our own origin only', async () => {
    vi.stubGlobal('caches', new FakeCacheStorage());
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const posts: TexEngineResponse[] = [];
    const scope = { onmessage: null as unknown, postMessage: (r: TexEngineResponse) => posts.push(r), location: new URL('https://latex.example/app/') as unknown as Location };
    serveTexEngine(scope, '/app/');
    await (scope.onmessage as (event: { data: unknown }) => Promise<void>)({ data: { kind: 'size', id: 1, engine: 'pdflatex' } });
    await vi.waitFor(() => expect(posts).toEqual([{ kind: 'size', id: 1, bytes: 0, available: false }]));
    expect(fetchMock).toHaveBeenCalledWith(MANIFEST_URL, expect.objectContaining({ credentials: 'same-origin' }));
    vi.unstubAllGlobals();
  });
});
