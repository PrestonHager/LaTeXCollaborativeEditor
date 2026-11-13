import { BLOBS_STORE, requestToPromise, withTransaction } from '../storage/idb';

/** Hash bytes to a hex string. Binary files are stored and requested by this hash. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return fallbackHash(bytes);
  const digest = await subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Two FNV passes, for pages without crypto.subtle (plain http). Fine for telling files apart.
 * The prefix lets peers know which kind of hash it is.
 */
export function fallbackHash(bytes: Uint8Array): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const byte of bytes) {
    a = Math.imul(a ^ byte, 0x01000193) >>> 0;
    b = Math.imul(b ^ byte, 0x811c9dc5) >>> 0;
  }
  return `fnv-${a.toString(16)}${b.toString(16)}-${bytes.length}`;
}

/** Check bytes against a hash made by hashBytes on any peer. */
export async function matchesHash(bytes: Uint8Array, hash: string): Promise<boolean> {
  if (hash.startsWith('fnv-')) return fallbackHash(bytes) === hash;
  // NOTE: without crypto.subtle we can't check a SHA-256 hash, so we trust the peer.
  if (!globalThis.crypto?.subtle) return true;
  return (await hashBytes(bytes)) === hash;
}

type BlobListener = (hash: string) => void;

/**
 * Binary file contents by hash. Keeps them in memory and in IndexedDB, so a reload or a
 * second visit doesn't have to ask peers or storage again.
 */
export class BlobStore {
  private readonly memory = new Map<string, Uint8Array>();
  private readonly listeners = new Set<BlobListener>();
  // How many undo steps still need each blob, so deleted binary files can come back (fileHistory.ts).
  private readonly pins = new Map<string, number>();

  has(hash: string) {
    return this.memory.has(hash);
  }

  /** Get bytes we already have in memory, without waiting. */
  peek(hash: string) {
    return this.memory.get(hash);
  }

  async get(hash: string): Promise<Uint8Array | undefined> {
    const cached = this.memory.get(hash);
    if (cached) return cached;
    try {
      const row = await withTransaction([BLOBS_STORE], 'readonly', (tx) =>
        requestToPromise(tx.objectStore(BLOBS_STORE).get(hash) as IDBRequest<{ hash: string; data: Uint8Array } | undefined>),
      );
      if (row?.data) {
        const bytes = new Uint8Array(row.data);
        this.memory.set(hash, bytes);
        // Tell listeners, since the viewer and preview wait on bytes that come back from the cache too.
        this.listeners.forEach((listener) => listener(hash));
        return bytes;
      }
    } catch (error) {
      console.warn('Could not read a file from browser storage', error);
    }
    return undefined;
  }

  /** Keep bytes and return their hash. Pass the hash when you already know it. */
  async put(bytes: Uint8Array, knownHash?: string): Promise<string> {
    const hash = knownHash ?? (await hashBytes(bytes));
    if (!this.memory.has(hash)) {
      this.memory.set(hash, bytes);
      this.listeners.forEach((listener) => listener(hash));
      try {
        await withTransaction([BLOBS_STORE], 'readwrite', (tx) => {
          tx.objectStore(BLOBS_STORE).put({ hash, data: bytes });
        });
      } catch (error) {
        // The memory copy still works for this visit, so only warn.
        console.warn('Could not cache a file in browser storage', error);
      }
    }
    return hash;
  }

  /** Keep these bytes in memory until release, even when no file uses them. */
  retain(hash: string) {
    this.pins.set(hash, (this.pins.get(hash) ?? 0) + 1);
  }

  release(hash: string) {
    const count = (this.pins.get(hash) ?? 0) - 1;
    if (count > 0) this.pins.set(hash, count);
    else this.pins.delete(hash);
  }

  isRetained(hash: string) {
    return this.pins.has(hash);
  }

  /**
   * Drop bytes from memory once nothing needs them. Retained ones stay. The browser storage copy
   * stays too: it's a cache shared by every project, and get() can still read it.
   */
  forget(hash: string) {
    if (!this.pins.has(hash)) this.memory.delete(hash);
  }

  /** Run the callback whenever new content arrives, like a file from a peer. */
  onAdded(listener: BlobListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
