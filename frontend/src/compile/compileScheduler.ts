import compileWorkerUrl from './compile.worker?worker&url';
import { isPreviewableImage } from '../project/paths';
import { MAIN_THREAD_COMPILE_KEY, type CompileFn, type CompileRequest, type CompileResponse } from './compileProtocol';
import type { ProjectPreviewInput, ProjectPreviewResult } from './latexJsPreview';

/** The parts of a Worker we use, so tests can hand in a fake one. */
export type CompileWorker = {
  postMessage(message: CompileRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<CompileResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

export type CompileSchedulerOptions = {
  /** Start a compile worker. Return null (or throw) to compile on the main thread instead. */
  createWorker?: () => CompileWorker | null;
  /** Compile on the main thread, for when there is no worker. */
  runLocal?: (input: ProjectPreviewInput) => ProjectPreviewResult | Promise<ProjectPreviewResult>;
};

type Pending = {
  id: number;
  input: ProjectPreviewInput;
  resolve: (result: ProjectPreviewResult | null) => void;
  reject: (error: Error) => void;
};

/**
 * Look up data URLs for the project's images up front, since a worker can't call back for them.
 * Other binary files are skipped, as the preview can't show them anyway.
 */
export function collectImageUrls(paths: Iterable<string>, imageUrl: (path: string) => string | null): Map<string, string> {
  const urls = new Map<string, string>();
  for (const path of paths) {
    if (!isPreviewableImage(path)) continue;
    const url = imageUrl(path);
    if (url) urls.set(path, url);
  }
  return urls;
}

/**
 * Check if the project draws a picture. LaTeX.js sizes picture elements with getBBox,
 * which needs real layout, so those compiles have to stay on the main thread.
 */
export function needsMainThread(input: ProjectPreviewInput): boolean {
  for (const text of input.texts.values()) if (/\\begin\s*\{picture\}/.test(text)) return true;
  return false;
}

const startWorker = (): CompileWorker | null => (typeof Worker === 'undefined' ? null : new Worker(compileWorkerUrl, { type: 'module' }));

/**
 * Compile on the main thread with the worker's own bundle, so LaTeX.js is only built into
 * the app once. Loading it leaves the compiler on globalThis.
 */
export async function compileOnMainThread(input: ProjectPreviewInput, url: string = compileWorkerUrl): Promise<ProjectPreviewResult> {
  const scope = globalThis as Record<string, unknown>;
  if (!scope[MAIN_THREAD_COMPILE_KEY]) await import(/* @vite-ignore */ url);
  return (scope[MAIN_THREAD_COMPILE_KEY] as CompileFn)(input);
}

/**
 * Run preview compiles in a worker, one at a time. A new compile cancels the one in flight
 * by killing its worker, since LaTeX.js can't be interrupted. Falls back to the main thread
 * when a worker can't start.
 */
export class CompileScheduler {
  private readonly createWorker: () => CompileWorker | null;
  private readonly runLocal: (input: ProjectPreviewInput) => ProjectPreviewResult | Promise<ProjectPreviewResult>;
  private worker: CompileWorker | null = null;
  private useLocal = false;
  private pending: Pending | null = null;
  private lastId = 0;

  constructor(options: CompileSchedulerOptions = {}) {
    this.createWorker = options.createWorker ?? startWorker;
    this.runLocal = options.runLocal ?? ((input) => compileOnMainThread(input));
  }

  /** Compile the project. Resolves to null when a newer compile replaced this one. */
  compile(input: ProjectPreviewInput): Promise<ProjectPreviewResult | null> {
    this.cancel();
    const id = ++this.lastId;
    const worker = needsMainThread(input) ? null : this.ensureWorker();
    if (!worker) return this.compileLocally(id, input);
    return new Promise((resolve, reject) => {
      this.pending = { id, input, resolve, reject };
      worker.postMessage({ id, input });
    });
  }

  /** Stop the compile in flight, if there is one. */
  cancel(): void {
    if (!this.pending) return;
    this.pending.resolve(null);
    this.pending = null;
    // The worker is stuck on the old compile, so we throw it away and start fresh next time.
    this.dropWorker();
  }

  /** Stop everything and shut the worker down. */
  dispose(): void {
    this.cancel();
    this.dropWorker();
  }

  private ensureWorker(): CompileWorker | null {
    if (this.useLocal) return null;
    if (this.worker) return this.worker;
    try {
      this.worker = this.createWorker();
    } catch {
      this.worker = null;
    }
    if (!this.worker) {
      this.useLocal = true;
      return null;
    }
    this.worker.onmessage = (event) => this.handleResponse(event.data);
    this.worker.onerror = (event) => this.handleWorkerError(event);
    return this.worker;
  }

  private handleResponse(response: CompileResponse): void {
    const pending = this.pending;
    if (!pending || pending.id !== response.id) return;
    this.pending = null;
    if ('error' in response) pending.reject(new Error(response.error));
    else pending.resolve(response.result);
  }

  private handleWorkerError(event: ErrorEvent): void {
    // An error event means the worker itself broke (it failed to load, say), since compile
    // errors come back as messages. So we stop using workers and finish the job here.
    event.preventDefault();
    this.dropWorker();
    this.useLocal = true;
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.compileLocally(pending.id, pending.input).then(pending.resolve, pending.reject);
  }

  private async compileLocally(id: number, input: ProjectPreviewInput): Promise<ProjectPreviewResult | null> {
    const result = await this.runLocal(input);
    // A main thread compile can't be stopped part way, so we just drop a stale result.
    return id === this.lastId ? result : null;
  }

  private dropWorker(): void {
    if (!this.worker) return;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.worker = null;
  }
}
