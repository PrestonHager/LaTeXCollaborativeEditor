import { ENGINE_LABELS, type TexEngine } from '../../project/texEngine';
import { isTexEngineGlue, type TexEngineBackend } from './engine';
import { AssetDownloadError, AssetIntegrityError, type AssetProgress } from './texAssetCache';
import { filesForEngine, TexManifestError, type TexAssetFile, type TexAssetManifest } from './texAssetManifest';
import type { TexCompileRequest, TexEngineRequest, TexEngineResponse, TexErrorReason } from './texEngineProtocol';

/** What the worker needs from the outside world. Tests hand in fakes; texEngine.worker.ts the real ones. */
export type TexEngineHostDeps = {
  /** The asset manifest, or null when this site has none (the assets aren't hosted yet). */
  loadManifest(): Promise<TexAssetManifest | null>;
  cache: {
    ensure(files: TexAssetFile[], onProgress?: (progress: AssetProgress) => void): Promise<Map<string, Uint8Array>>;
    downloadSize(files: TexAssetFile[]): Promise<number>;
    prune(manifest: TexAssetManifest): Promise<number>;
  };
  /** Import the engine glue module, from our own origin. */
  importGlue(file: TexAssetFile): Promise<unknown>;
  post(response: TexEngineResponse): void;
};

export const DEFAULT_MAX_PASSES = 3;
/** The most passes anyone can ask for, so a document that never settles can't loop for long. */
export const MAX_PASSES = 5;

export const UNAVAILABLE_MESSAGE = "Compile PDF isn't available on this site yet: the TeX engine files aren't hosted here.";
export const MEMORY_MESSAGE =
  'The TeX engine ran out of memory. Close other tabs and try again, or compile on a computer: phones often have too little memory for it.';

/** A reason that's only for the person, with a message we've already worded. */
class HostError extends Error {
  readonly reason: TexErrorReason;
  constructor(reason: TexErrorReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

const OOM_PATTERN = /out of memory|cannot enlarge memory|allocation failed|Aborted\(OOM\)|Array buffer allocation/i;

/** Sort an error into a reason and a plain message. */
export function classifyError(error: unknown): { reason: TexErrorReason; message: string } {
  if (error instanceof HostError) return { reason: error.reason, message: error.message };
  if (error instanceof AssetDownloadError || error instanceof AssetIntegrityError) return { reason: 'download', message: error.message };
  if (error instanceof TexManifestError) return { reason: 'unavailable', message: error.message };
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (error instanceof RangeError || OOM_PATTERN.test(text)) return { reason: 'memory', message: MEMORY_MESSAGE };
  return { reason: 'engine', message: `The TeX engine stopped: ${text.slice(0, 300)}` };
}

/** `chapters/main.tex` → `chapters/main`. TeX names its outputs after the main file. */
export function outputStem(mainPath: string): string {
  return mainPath.replace(/\.tex$/i, '');
}

// TeX and LaTeX packages say this when references or labels need another pass.
const RERUN_PATTERN = /Rerun to get|Label\(s\) may have changed|Rerun LaTeX|There were undefined references/;

const sameBytes = (a: Uint8Array | null, b: Uint8Array | null) => {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * The Compile PDF worker's logic (issue #241), apart from the worker itself so it can be tested
 * with a fake engine. It answers one request at a time, keeps each engine loaded between compiles
 * (so only the first one pays for the download and start-up), and reruns TeX until the .aux settles.
 */
export function createTexEngineHost(deps: TexEngineHostDeps) {
  let manifest: Promise<TexAssetManifest | null> | null = null;
  const backends = new Map<TexEngine, Promise<TexEngineBackend>>();
  let queue: Promise<void> = Promise.resolve();
  const decoder = new TextDecoder();

  const getManifest = () => {
    manifest ??= deps.loadManifest().catch((error: unknown) => {
      manifest = null;
      throw error;
    });
    return manifest;
  };

  const engineFiles = async (engine: TexEngine) => {
    const current = await getManifest();
    if (!current) throw new HostError('unavailable', UNAVAILABLE_MESSAGE);
    const files = filesForEngine(current, engine);
    if (!files) throw new HostError('unavailable', `This site's TeX engine build has no ${ENGINE_LABELS[engine]} yet.`);
    return { current, files };
  };

  const startBackend = async (id: number, engine: TexEngine): Promise<TexEngineBackend> => {
    const { current, files } = await engineFiles(engine);
    // The glue is a small script the browser imports itself; the rest goes through the cache.
    const [glueFile, ...assetFiles] = files;
    const assets = await deps.cache.ensure(assetFiles, ({ loaded, total }) => deps.post({ kind: 'progress', id, stage: 'download', loaded, total }));
    // Old asset builds go once the new one is in. A failure here only leaves some bytes behind.
    void deps.cache.prune(current).catch(() => undefined);
    deps.post({ kind: 'progress', id, stage: 'load' });
    const glue = await deps.importGlue(glueFile);
    if (!isTexEngineGlue(glue)) throw new HostError('engine', "The TeX engine files don't include a working engine.");
    const backend = await glue.createTexEngine();
    await backend.load(assets, engine);
    return backend;
  };

  const backendFor = (id: number, engine: TexEngine) => {
    let backend = backends.get(engine);
    if (!backend) {
      backend = startBackend(id, engine);
      backends.set(engine, backend);
      // A failed start can be retried next time.
      backend.catch(() => backends.delete(engine));
    }
    return backend;
  };

  const compile = async (request: TexCompileRequest) => {
    const { id, engine, mainPath } = request;
    const backend = await backendFor(id, engine);
    const stem = outputStem(mainPath);
    const maxPasses = Math.min(Math.max(1, Math.floor(request.maxPasses ?? DEFAULT_MAX_PASSES)), MAX_PASSES);
    try {
      backend.clearProject();
      for (const file of request.files) backend.writeFile(file.path, file.data);
      let passes = 0;
      let exitCode = 0;
      let aux: Uint8Array | null = null;
      for (;;) {
        passes += 1;
        deps.post({ kind: 'progress', id, stage: 'compile', pass: passes });
        ({ exitCode } = await backend.run(engine, mainPath));
        const nextAux = backend.readFile(`${stem}.aux`);
        const log = backend.readFile(`${stem}.log`);
        const wantsRerun = log ? RERUN_PATTERN.test(decoder.decode(log)) : false;
        // Like latexmk: go again while LaTeX asks for it or the .aux is still changing.
        const changed = passes > 1 && !sameBytes(aux, nextAux);
        aux = nextAux;
        if (exitCode !== 0 || passes >= maxPasses || !(wantsRerun || changed)) break;
      }
      const log = backend.readFile(`${stem}.log`);
      deps.post({ kind: 'result', id, pdf: backend.readFile(`${stem}.pdf`), log: log ? decoder.decode(log) : '', passes, exitCode });
    } catch (error) {
      // The engine's state may be broken after a crash, so start it fresh next time.
      backends.delete(engine);
      throw error;
    }
  };

  const size = async (id: number, engine: TexEngine) => {
    try {
      const { files } = await engineFiles(engine);
      deps.post({ kind: 'size', id, bytes: await deps.cache.downloadSize(files.slice(1)), available: true });
    } catch (error) {
      if (classifyError(error).reason !== 'unavailable') throw error;
      deps.post({ kind: 'size', id, bytes: 0, available: false });
    }
  };

  /** Handle one request. Requests run in order, one at a time. */
  function handle(request: TexEngineRequest): Promise<void> {
    const run = async () => {
      try {
        if (request.kind === 'size') await size(request.id, request.engine);
        else await compile(request);
      } catch (error) {
        deps.post({ kind: 'error', id: request.id, ...classifyError(error) });
      }
    };
    queue = queue.then(run);
    return queue;
  }

  return { handle };
}
