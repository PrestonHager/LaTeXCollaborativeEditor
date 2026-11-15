import type { TexAssetFile, TexAssetManifest } from './texAssetManifest';

/**
 * The Compile PDF asset cache (issue #241): the engine's WebAssembly and package bundles, kept in
 * the Cache API so they download once. Entries are keyed by the file's SHA-256, not its URL, so a
 * new asset build only downloads the files that really changed, and a file is checked against its
 * hash before it's stored. Only files from our own origin are fetched.
 *
 * Bump the number in CACHE_NAME only if the way entries are stored changes. Old asset builds are
 * cleaned up by `prune`, which drops every entry the current manifest doesn't list.
 */
export const CACHE_PREFIX = 'tex-assets-';
export const CACHE_NAME = `${CACHE_PREFIX}v1`;
/** Synthetic same-origin path the entries are stored under. Nothing is ever fetched from it. */
const KEY_PATH = '/__tex-asset/';

/** Download progress in bytes, over the files that weren't cached yet. */
export type AssetProgress = { loaded: number; total: number };

export type AssetCacheDeps = {
  caches: CacheStorage;
  fetch: typeof fetch;
  /** The page's origin. Files anywhere else are refused, whatever the manifest says. */
  origin: string;
  /** Lowercase hex SHA-256. Defaults to crypto.subtle. */
  digest?: (bytes: Uint8Array) => Promise<string>;
  /** navigator.storage, for persist(). */
  storage?: Pick<StorageManager, 'persist' | 'persisted'>;
};

export class AssetIntegrityError extends Error {
  constructor(name: string) {
    super(`${name} didn't match its checksum, so it wasn't used. Try again later.`);
    this.name = 'AssetIntegrityError';
  }
}

export class AssetDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetDownloadError';
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Read a response body, counting bytes as they arrive. */
async function readBody(response: Response, onBytes: (count: number) => void): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onBytes(bytes.length);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
    onBytes(value.length);
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export class TexAssetCache {
  private readonly deps: AssetCacheDeps;
  private readonly digest: (bytes: Uint8Array) => Promise<string>;

  constructor(deps: AssetCacheDeps) {
    this.deps = deps;
    this.digest = deps.digest ?? sha256Hex;
  }

  private key(file: Pick<TexAssetFile, 'sha256'>): string {
    return new URL(`${KEY_PATH}${file.sha256}`, this.deps.origin).href;
  }

  private open(): Promise<Cache> {
    return this.deps.caches.open(CACHE_NAME);
  }

  /** The files that still need downloading. */
  async missing(files: TexAssetFile[]): Promise<TexAssetFile[]> {
    const cache = await this.open();
    const out: TexAssetFile[] = [];
    for (const file of files) if (!(await cache.match(this.key(file)))) out.push(file);
    return out;
  }

  /** How many bytes a compile with these files would download first. 0 when all are cached. */
  async downloadSize(files: TexAssetFile[]): Promise<number> {
    return (await this.missing(files)).reduce((sum, file) => sum + file.size, 0);
  }

  /**
   * Every file's bytes, by name, downloading the missing ones from our origin and checking each
   * against its hash before it's cached. Asks the browser to keep the cache once anything was downloaded.
   */
  async ensure(files: TexAssetFile[], onProgress?: (progress: AssetProgress) => void): Promise<Map<string, Uint8Array>> {
    const cache = await this.open();
    const out = new Map<string, Uint8Array>();
    const toFetch: TexAssetFile[] = [];
    for (const file of files) {
      const hit = await cache.match(this.key(file));
      if (hit) out.set(file.name, new Uint8Array(await hit.arrayBuffer()));
      else toFetch.push(file);
    }
    const progress: AssetProgress = { loaded: 0, total: toFetch.reduce((sum, file) => sum + file.size, 0) };
    if (toFetch.length) onProgress?.({ ...progress });
    for (const file of toFetch) {
      if (new URL(file.url).origin !== this.deps.origin) throw new AssetDownloadError(`${file.name} isn't on this site, so it wasn't downloaded.`);
      let response: Response;
      try {
        response = await this.deps.fetch(file.url, { credentials: 'same-origin' });
      } catch {
        throw new AssetDownloadError(`Couldn't download ${file.name}. Check your connection and try again.`);
      }
      if (!response.ok) throw new AssetDownloadError(`Couldn't download ${file.name} (HTTP ${response.status}).`);
      const bytes = await readBody(response, (count) => {
        progress.loaded += count;
        onProgress?.({ ...progress });
      });
      if ((await this.digest(bytes)) !== file.sha256) throw new AssetIntegrityError(file.name);
      await cache.put(
        this.key(file),
        new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length), 'x-tex-asset-name': file.name } }),
      );
      out.set(file.name, bytes);
    }
    if (toFetch.length) await this.persist();
    return out;
  }

  /** Ask the browser not to evict the cache. Safari drops unpersisted storage after a week away. */
  async persist(): Promise<boolean> {
    const storage = this.deps.storage;
    if (!storage?.persist) return false;
    try {
      if (await storage.persisted?.()) return true;
      return await storage.persist();
    } catch {
      return false;
    }
  }

  /** What's stored, for Settings: total bytes and file count, across every cache version. */
  async usage(): Promise<{ bytes: number; files: number }> {
    let bytes = 0;
    let files = 0;
    for (const name of await this.deps.caches.keys()) {
      if (!name.startsWith(CACHE_PREFIX)) continue;
      const cache = await this.deps.caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (!response) continue;
        files += 1;
        const length = Number(response.headers.get('content-length'));
        bytes += Number.isFinite(length) && length > 0 ? length : (await response.clone().arrayBuffer()).byteLength;
      }
    }
    return { bytes, files };
  }

  /** Remove everything Compile PDF downloaded. The next Compile PDF asks again first. */
  async remove(): Promise<void> {
    for (const name of await this.deps.caches.keys()) if (name.startsWith(CACHE_PREFIX)) await this.deps.caches.delete(name);
  }

  /**
   * Clean up old versions: caches in an older storage format, and entries the current manifest
   * doesn't list. Returns how many entries went.
   */
  async prune(manifest: TexAssetManifest): Promise<number> {
    for (const name of await this.deps.caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await this.deps.caches.delete(name);
    }
    const keep = new Set([manifest.glue, ...manifest.files].map((file) => this.key(file)));
    const cache = await this.open();
    let removed = 0;
    for (const request of await cache.keys()) {
      if (keep.has(request.url)) continue;
      await cache.delete(request);
      removed += 1;
    }
    return removed;
  }
}

/** The cache for this page, or null where the Cache API isn't available (an insecure origin, an old browser). */
export function browserTexAssetCache(): TexAssetCache | null {
  if (typeof caches === 'undefined' || typeof location === 'undefined') return null;
  return new TexAssetCache({ caches, fetch: (input, init) => fetch(input, init), origin: location.origin, storage: navigator.storage });
}
