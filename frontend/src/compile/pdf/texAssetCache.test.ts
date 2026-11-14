import { FakeCacheStorage } from '../../test/fakeCacheStorage';
import { AssetDownloadError, AssetIntegrityError, CACHE_NAME, TexAssetCache, browserTexAssetCache, sha256Hex } from './texAssetCache';
import { ORIGIN, fakeAssets } from '../../test/texAssets';

async function setup(storage?: { persist: () => Promise<boolean>; persisted?: () => Promise<boolean> }) {
  const assets = await fakeAssets();
  const caches = new FakeCacheStorage();
  const cache = new TexAssetCache({ caches: caches.asCacheStorage(), fetch: assets.fetchFn, origin: ORIGIN, storage: storage as StorageManager | undefined });
  return { ...assets, caches, cache };
}

describe('Compile PDF asset cache (#241)', () => {
  it('hashes bytes as lowercase hex SHA-256', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('downloads missing files once, with progress, then serves them from the cache', async () => {
    const persist = vi.fn(async () => true);
    const t = await setup({ persist, persisted: async () => false });
    const files = t.manifest.files;
    expect(await t.cache.downloadSize(files)).toBe(24);
    const progress: number[] = [];
    const first = await t.cache.ensure(files, ({ loaded }) => progress.push(loaded));
    expect(new TextDecoder().decode(first.get('pdftex.wasm'))).toBe('wasm-bytes');
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(24);
    expect(t.requests).toHaveLength(2);
    expect(persist).toHaveBeenCalledTimes(1);

    const second = await t.cache.ensure(files, () => progress.push(-1));
    expect(new TextDecoder().decode(second.get('basic.data'))).toBe('package-bundle');
    expect(t.requests).toHaveLength(2);
    expect(progress).not.toContain(-1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await t.cache.downloadSize(files)).toBe(0);
    // Keyed by content hash, not by URL.
    const keys = [...t.caches.stores.get(CACHE_NAME)!.entries.keys()];
    expect(keys.every((key) => key.startsWith(`${ORIGIN}/__tex-asset/`))).toBe(true);
  });

  it('refuses a file that fails its checksum, and caches nothing for it', async () => {
    const t = await setup();
    t.bodies.set(t.manifest.files[0].url, new TextEncoder().encode('tampered'));
    await expect(t.cache.ensure(t.manifest.files)).rejects.toBeInstanceOf(AssetIntegrityError);
    expect(await t.cache.missing(t.manifest.files)).toHaveLength(2);
  });

  it('only fetches from our own origin, and says why a download failed', async () => {
    const t = await setup();
    const elsewhere = { ...t.manifest.files[0], url: 'https://texlive.example/pdftex.wasm' };
    await expect(t.cache.ensure([elsewhere])).rejects.toThrow("isn't on this site");
    expect(t.requests).toEqual([]);
    await expect(t.cache.ensure([{ ...t.manifest.files[0], url: `${ORIGIN}/nope` }])).rejects.toThrow('HTTP 404');
    const offline = new TexAssetCache({
      caches: new FakeCacheStorage().asCacheStorage(),
      fetch: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
      origin: ORIGIN,
    });
    await expect(offline.ensure(t.manifest.files)).rejects.toBeInstanceOf(AssetDownloadError);
  });

  it('reads a body without a stream too', async () => {
    const t = await setup();
    const bytes = new TextEncoder().encode('wasm-bytes');
    const noStream = { ok: true, status: 200, body: null, arrayBuffer: async () => bytes.buffer } as unknown as Response;
    const cache = new TexAssetCache({ caches: new FakeCacheStorage().asCacheStorage(), fetch: (async () => noStream) as unknown as typeof fetch, origin: ORIGIN });
    expect(Array.from((await cache.ensure([t.manifest.files[0]])).get('pdftex.wasm')!)).toEqual(Array.from(bytes));
  });

  it('reports usage, prunes old versions, and removes everything', async () => {
    const t = await setup();
    await t.cache.ensure(t.manifest.files);
    expect(await t.cache.usage()).toEqual({ bytes: 24, files: 2 });
    // An entry from an older build and an old storage format.
    const current = await t.caches.open(CACHE_NAME);
    await current.put(`${ORIGIN}/__tex-asset/${'f'.repeat(64)}`, new Response('old!'));
    await (await t.caches.open('tex-assets-v0')).put(`${ORIGIN}/x`, new Response('older'));
    await (await t.caches.open('something-else')).put(`${ORIGIN}/y`, new Response('keep'));
    expect(await t.cache.usage()).toEqual({ bytes: 33, files: 4 });
    expect(await t.cache.prune(t.manifest)).toBe(1);
    expect(await t.caches.keys()).toEqual([CACHE_NAME, 'something-else']);
    expect(await t.cache.usage()).toEqual({ bytes: 24, files: 2 });
    await t.cache.remove();
    expect(await t.caches.keys()).toEqual(['something-else']);
    expect(await t.cache.usage()).toEqual({ bytes: 0, files: 0 });
  });

  it('asks for persistent storage only where it can', async () => {
    expect(await (await setup()).cache.persist()).toBe(false);
    expect(await (await setup({ persist: async () => false, persisted: async () => true })).cache.persist()).toBe(true);
    const throwing = await setup({
      persist: async () => {
        throw new Error('nope');
      },
    });
    expect(await throwing.cache.persist()).toBe(false);
  });

  it('has no browser cache where the Cache API is missing', () => {
    expect(typeof caches).toBe('undefined');
    expect(browserTexAssetCache()).toBeNull();
    vi.stubGlobal('caches', new FakeCacheStorage());
    expect(browserTexAssetCache()).toBeInstanceOf(TexAssetCache);
    vi.unstubAllGlobals();
  });
});
