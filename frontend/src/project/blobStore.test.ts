import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { BlobStore, fallbackHash, hashBytes, matchesHash } from './blobStore';
import { resetDbForTests } from '../storage/idb';

describe('BlobStore', () => {
  beforeEach(() => {
    resetDbForTests();
    globalThis.indexedDB = new IDBFactory();
  });

  it('hashes bytes with SHA-256 and checks them', async () => {
    const bytes = new TextEncoder().encode('abc');
    const hash = await hashBytes(bytes);
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await matchesHash(bytes, hash)).toBe(true);
    expect(await matchesHash(new Uint8Array([1]), hash)).toBe(false);
  });

  it('checks the fallback hash pages without crypto.subtle make', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const hash = fallbackHash(bytes);
    expect(hash).toMatch(/^fnv-[0-9a-f]+-3$/);
    expect(await matchesHash(bytes, hash)).toBe(true);
    expect(await matchesHash(new Uint8Array([3, 2, 1]), hash)).toBe(false);
  });

  it('keeps bytes in memory and in IndexedDB, and tells listeners once', async () => {
    const store = new BlobStore();
    const listener = vi.fn();
    store.onAdded(listener);
    const bytes = new Uint8Array([5, 6]);
    const hash = await store.put(bytes);
    await store.put(bytes, hash);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.has(hash)).toBe(true);
    expect(store.peek(hash)).toBe(bytes);

    // A second store (like after a reload) finds it in IndexedDB.
    const fresh = new BlobStore();
    expect(fresh.has(hash)).toBe(false);
    expect(Array.from((await fresh.get(hash))!)).toEqual([5, 6]);
    expect(fresh.has(hash)).toBe(true);
    expect(await fresh.get('missing')).toBeUndefined();
  });

  it('still works from memory when IndexedDB is missing', async () => {
    resetDbForTests();
    const saved = globalThis.indexedDB;
    // @ts-expect-error simulating a browser without IndexedDB
    delete globalThis.indexedDB;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = new BlobStore();
    const hash = await store.put(new Uint8Array([1]));
    expect(await store.get(hash)).toEqual(new Uint8Array([1]));
    expect(await store.get('other')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    globalThis.indexedDB = saved;
  });
});
