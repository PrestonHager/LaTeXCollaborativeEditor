// Helpers for code that loads on first use instead of in the initial bundle (see
// scripts/check-bundle-size.mjs for the budget). Each lazy feature preloads when the browser is
// idle or when the pointer or focus reaches its button, so the first click doesn't wait on the network.
import { isStaleChunkError } from './updateCheck';

export type LazyModule<T> = {
  /**
   * The module, loading it on the first call. A failed load is forgotten, so the next call asks the
   * browser again. While offline it fails with OfflineError without asking at all (see whenOnline).
   */
  get(): Promise<T>;
  /** Start loading without waiting. Skipped while offline; failures are left for get() to report. */
  preload(): void;
  /** The module if it has loaded, else null. */
  current(): T | null;
};

/** navigator.onLine. Only false means offline. */
export const browserOnline = (): boolean => navigator.onLine !== false;

/** A chunk load we didn't start because the browser is offline. */
export class OfflineError extends Error {
  constructor() {
    super("You're offline.");
    this.name = 'OfflineError';
  }
}

/**
 * Run `load` (a dynamic import) only while online, else reject with OfflineError. Chrome and
 * Firefox remember a failed module load until the page reloads, even once the network is back, so
 * an import tried offline would keep failing. Not trying keeps it loadable later.
 */
export function whenOnline<T>(load: () => Promise<T>, isOnline: () => boolean = browserOnline): Promise<T> {
  return isOnline() ? load() : Promise.reject(new OfflineError());
}

/** True for an error from loading part of the app: offline, the network, or a deploy that removed the chunk. */
export const isLoadFailure = (error: unknown): boolean => error instanceof OfflineError || isStaleChunkError(error);

export function lazyModule<T>(load: () => Promise<T>, isOnline: () => boolean = browserOnline): LazyModule<T> {
  let promise: Promise<T> | null = null;
  let value: T | null = null;
  const get = (): Promise<T> => {
    if (value !== null) return Promise.resolve(value);
    if (!promise && !isOnline()) return Promise.reject(new OfflineError());
    return (promise ??= load().then(
      (module) => (value = module),
      (error: unknown) => {
        promise = null;
        throw error;
      },
    ));
  };
  return {
    get,
    preload: () => {
      if (isOnline()) void get().catch(() => {});
    },
    current: () => value,
  };
}

type IdleWindow = Pick<Window, 'setTimeout'> & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number };

/** Run once the browser is idle, or after a short delay where requestIdleCallback is missing (Safari). */
export function whenIdle(callback: () => void, timeout = 10_000, win: IdleWindow = window) {
  if (typeof win.requestIdleCallback === 'function') win.requestIdleCallback(callback, { timeout });
  else win.setTimeout(callback, 3000);
}

/** Preload when the pointer or keyboard focus first reaches an element, a moment before the click. */
export function preloadOnIntent(element: Element | null | undefined, preload: () => void) {
  if (!element) return;
  const run = () => {
    for (const type of ['pointerenter', 'focusin', 'touchstart'] as const) element.removeEventListener(type, run);
    preload();
  };
  for (const type of ['pointerenter', 'focusin', 'touchstart'] as const) element.addEventListener(type, run, { passive: true });
}

/**
 * Why a part of the app didn't load:
 * - offline: the browser is offline, so the load wasn't tried (or failed for that). It works once back online.
 * - update: a deploy removed the chunk; version.json names a newer build, and only a reload fixes it.
 * - network: the chunk fetch failed while online and there's no newer build. The browser keeps
 *   that failure until a reload, so that's the advice.
 * - error: something else, like the module throwing as it started.
 */
export type LoadFailureKind = 'offline' | 'update' | 'network' | 'error';

export async function classifyLoadFailure(
  error: unknown,
  /** newerBuildLive resolves false when version.json can't be read (updateCheck.ts never rejects). */
  deps: { isOnline: () => boolean; newerBuildLive: () => Promise<boolean> },
): Promise<LoadFailureKind> {
  if (error instanceof OfflineError || !deps.isOnline()) return 'offline';
  if (!isStaleChunkError(error)) return 'error';
  return (await deps.newerBuildLive()) ? 'update' : 'network';
}

/** What to tell someone. `feature` reads as the start of a sentence, like "Settings". */
export function loadFailureMessage(kind: Exclude<LoadFailureKind, 'update'>, feature: string, willRetry = false): string {
  if (kind === 'offline') {
    return willRetry ? `You're offline. ${feature} will load when you're back online.` : `You're offline. ${feature} will work once you're back online.`;
  }
  if (kind === 'network') return `${feature} couldn't load. Check your connection, then reload the page.`;
  return `${feature} couldn't load. Try again, or reload the page.`;
}

/**
 * Keep what someone tried to open while offline, and run it when the browser says it's back online,
 * as the offline notice promised. One pending action per key; a newer one replaces it.
 * `onOnline` runs on every return, before the retries.
 */
export function createOnlineRetry(onOnline?: () => void, win: Pick<Window, 'addEventListener'> = window) {
  const pending = new Map<string, () => void>();
  win.addEventListener('online', () => {
    const due = [...pending.values()];
    pending.clear();
    onOnline?.();
    for (const run of due) run();
  });
  return { add: (key: string, run: () => void) => void pending.set(key, run) };
}
