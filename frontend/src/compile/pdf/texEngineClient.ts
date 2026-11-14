import workerUrl from './texEngine.worker?worker&url';
import type { TexEngine } from '../../project/texEngine';
import type { CompileFile, TexEngineRequest, TexEngineResponse, TexErrorReason, TexStage } from './texEngineProtocol';

/** The parts of a Worker we use, so tests can hand in a fake one. */
export type TexWorker = {
  postMessage(message: TexEngineRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<TexEngineResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

export type TexProgress = { stage: TexStage; loaded?: number; total?: number; pass?: number };
export type TexCompileResult = { pdf: Uint8Array | null; log: string; passes: number; exitCode: number };

/** A compile that didn't run, with a message to show as it is. */
export class TexCompileError extends Error {
  readonly reason: TexErrorReason;
  constructor(reason: TexErrorReason, message: string) {
    super(message);
    this.name = 'TexCompileError';
    this.reason = reason;
  }
}

type Waiting = {
  resolve: (response: TexEngineResponse) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: TexProgress) => void;
};

const startWorker = (): TexWorker => new Worker(workerUrl, { type: 'module', name: 'tex-engine' }) as unknown as TexWorker;

/**
 * The page's side of the Compile PDF worker (issue #241). The worker starts on the first request
 * and stays alive between compiles, so the engine is only downloaded and started once per tab.
 * Requests are answered in order. This module is only reached through a dynamic import.
 */
export class TexEngineClient {
  private readonly createWorker: () => TexWorker;
  private worker: TexWorker | null = null;
  private readonly waiting = new Map<number, Waiting>();
  private lastId = 0;

  constructor(createWorker: () => TexWorker = startWorker) {
    this.createWorker = createWorker;
  }

  private ensureWorker(): TexWorker {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = (event) => this.receive(event.data);
    // A worker that dies (a crash, or out of memory while starting) fails what's waiting and starts fresh next time.
    worker.onerror = (event) => {
      event.preventDefault?.();
      const message = event.message || 'The TeX engine stopped unexpectedly.';
      this.failAll(/memory/i.test(message) ? new TexCompileError('memory', message) : new TexCompileError('engine', message));
      this.terminate();
    };
    this.worker = worker;
    return worker;
  }

  private receive(response: TexEngineResponse) {
    const waiting = this.waiting.get(response.id);
    if (!waiting) return;
    if (response.kind === 'progress') {
      waiting.onProgress?.({ stage: response.stage, loaded: response.loaded, total: response.total, pass: response.pass });
      return;
    }
    this.waiting.delete(response.id);
    if (response.kind === 'error') waiting.reject(new TexCompileError(response.reason, response.message));
    else waiting.resolve(response);
  }

  private failAll(error: Error) {
    for (const waiting of this.waiting.values()) waiting.reject(error);
    this.waiting.clear();
  }

  private request(build: (id: number) => TexEngineRequest, onProgress?: (progress: TexProgress) => void): Promise<TexEngineResponse> {
    const worker = this.ensureWorker();
    const id = ++this.lastId;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject, onProgress });
      worker.postMessage(build(id));
    });
  }

  /** How much the first compile with `engine` would download, or null when this site has no engine. */
  async downloadSize(engine: TexEngine): Promise<number | null> {
    const response = await this.request((id) => ({ kind: 'size', id, engine }));
    return response.kind === 'size' && response.available ? response.bytes : null;
  }

  /** Compile the project. Rejects with a TexCompileError when it couldn't run at all. */
  async compile(
    options: { engine: TexEngine; mainPath: string; files: CompileFile[]; maxPasses?: number },
    onProgress?: (progress: TexProgress) => void,
  ): Promise<TexCompileResult> {
    const response = await this.request((id) => ({ kind: 'compile', id, ...options }), onProgress);
    if (response.kind !== 'result') throw new TexCompileError('engine', 'The TeX engine sent back something unexpected.');
    return { pdf: response.pdf, log: response.log, passes: response.passes, exitCode: response.exitCode };
  }

  /** Stop the worker and fail anything waiting. The next request starts a new one. */
  terminate() {
    this.failAll(new TexCompileError('engine', 'The compile was stopped.'));
    this.worker?.terminate();
    this.worker = null;
  }
}
