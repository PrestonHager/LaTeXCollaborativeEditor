import { isTexEngine, type TexEngine } from '../../project/texEngine';

/**
 * The manifest for the Compile PDF engine assets (issue #241, docs/wasm-tex-engine.md).
 *
 * A CI job (the asset-hosting issue) builds the WebAssembly engine and the TeX Live package
 * bundles and publishes them with the site under `tex/`, next to a `manifest.json` that lists
 * each file with its SHA-256 and size. Every file is fetched from our own origin, never from a
 * TeX Live server, and the cache (texAssetCache.ts) keys each one by its hash.
 */

/** Where the assets live, relative to the app's base URL. */
export const TEX_ASSET_DIR = 'tex/';
export const TEX_MANIFEST_FILE = 'manifest.json';

/** One file the engine needs: the WebAssembly, a format file, or a package bundle. */
export type TexAssetFile = {
  /** A short name the engine glue asks for, like `pdftex.wasm` or `texlive-basic.data`. */
  name: string;
  /** Absolute URL, resolved from the manifest and checked to be on our own origin. */
  url: string;
  /** Lowercase hex SHA-256 of the file's bytes. */
  sha256: string;
  /** Size in bytes, for the download size the first-run dialog shows. */
  size: number;
};

export type TexAssetManifest = {
  /** The asset build, like `2026.1-busytex-abc1234`. Shown in Settings and the notices. */
  version: string;
  /** The engine glue module the worker imports. It exports `createTexEngine` (engine.ts). */
  glue: TexAssetFile;
  files: TexAssetFile[];
  /** Which files each engine needs, by name. An engine that's missing isn't built yet. */
  engines: Partial<Record<TexEngine, string[]>>;
};

export class TexManifestError extends Error {
  constructor(message: string) {
    super(`The Compile PDF manifest is broken: ${message}`);
    this.name = 'TexManifestError';
  }
}

const SHA256 = /^[0-9a-f]{64}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** Largest single file we'll take, matching the GitHub Pages file limit. */
export const MAX_ASSET_BYTES = 100 * 1024 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The manifest's URL for this deploy: `tex/manifest.json` under the app's base URL, on our own origin. */
export function texManifestUrl(base: string = import.meta.env.BASE_URL, page: string = globalThis.location.href): string {
  return new URL(`${base}${TEX_ASSET_DIR}${TEX_MANIFEST_FILE}`, page).href;
}

/** Resolve a file's path against the manifest and make sure it stays on our origin. */
function assetFile(raw: unknown, manifestUrl: URL, where: string): TexAssetFile {
  if (!isRecord(raw)) throw new TexManifestError(`${where} isn't an object.`);
  const { name, path, sha256, size } = raw;
  if (typeof name !== 'string' || !NAME.test(name)) throw new TexManifestError(`${where} has a bad name.`);
  if (typeof path !== 'string' || !path) throw new TexManifestError(`${name} has no path.`);
  if (typeof sha256 !== 'string' || !SHA256.test(sha256)) throw new TexManifestError(`${name} has a bad sha256.`);
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0 || size > MAX_ASSET_BYTES) throw new TexManifestError(`${name} has a bad size.`);
  let url: URL;
  try {
    url = new URL(path, manifestUrl);
  } catch {
    throw new TexManifestError(`${name} has a bad path.`);
  }
  // Only ever our own origin: no CDN, no TeX Live server (docs/wasm-tex-engine.md).
  if (url.origin !== manifestUrl.origin) throw new TexManifestError(`${name} isn't on this site.`);
  return { name, url: url.href, sha256, size };
}

/** Check a fetched manifest and resolve its file URLs. Throws TexManifestError on anything off. */
export function parseTexManifest(raw: unknown, manifestUrl: string): TexAssetManifest {
  if (!isRecord(raw)) throw new TexManifestError("it isn't a JSON object.");
  const base = new URL(manifestUrl);
  if (typeof raw.version !== 'string' || !raw.version || raw.version.length > 100) throw new TexManifestError('it has no version.');
  if (!Array.isArray(raw.files)) throw new TexManifestError('it has no file list.');
  const files = raw.files.map((file, index) => assetFile(file, base, `file ${index + 1}`));
  const names = new Set(files.map((file) => file.name));
  if (names.size !== files.length) throw new TexManifestError('two files have the same name.');
  const glue = assetFile(raw.glue, base, 'the glue module');
  if (!isRecord(raw.engines)) throw new TexManifestError('it has no engine list.');
  const engines: TexAssetManifest['engines'] = {};
  for (const [engine, list] of Object.entries(raw.engines)) {
    if (!isTexEngine(engine)) continue;
    if (!Array.isArray(list) || !list.every((name) => typeof name === 'string' && names.has(name))) {
      throw new TexManifestError(`${engine} lists a file that isn't in it.`);
    }
    engines[engine] = [...new Set(list as string[])];
  }
  return { version: raw.version, glue, files, engines };
}

/** The files `engine` needs, glue first. Null when this build has no such engine. */
export function filesForEngine(manifest: TexAssetManifest, engine: TexEngine): TexAssetFile[] | null {
  const names = manifest.engines[engine];
  if (!names) return null;
  const byName = new Map(manifest.files.map((file) => [file.name, file]));
  return [manifest.glue, ...names.map((name) => byName.get(name)!)];
}
