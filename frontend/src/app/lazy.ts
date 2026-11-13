// Helpers for code that loads on first use instead of in the initial bundle (see
// scripts/check-bundle-size.mjs for the budget). Each lazy feature preloads when the browser is
// idle or when the pointer or focus reaches its button, so the first click doesn't wait on the network.
import { isStaleChunkError } from './updateCheck';

export type LazyModule<T> = {
  /**
   * The module, loading it on the first call. A failed load is forgotten, so the next call asks the
   * browser again. Chrome and Firefox keep a failed module URL failed until the page reloads, so
   * the real fix is the reload the update prompt offers (see lazyLoadProblem).
   */
  get(): Promise<T>;
  /** Start loading without waiting. Failures are left for get() to report. */
  preload(): void;
  /** The module if it has loaded, else null. */
  current(): T | null;
};

export function lazyModule<T>(load: () => Promise<T>): LazyModule<T> {
  let promise: Promise<T> | null = null;
  let value: T | null = null;
  const get = () =>
    (promise ??= load().then(
      (module) => (value = module),
      (error: unknown) => {
        promise = null;
        throw error;
      },
    ));
  return {
    get,
    preload: () => void get().catch(() => {}),
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
 * What to tell someone when a lazy part of the app didn't load. After a deploy the old chunk is
 * gone from the server, and only a reload fixes that, so `staleChunk` is true and the caller
 * should offer the update prompt. Otherwise it's usually the network.
 */
export function lazyLoadProblem(feature: string, error: unknown): { message: string; staleChunk: boolean } {
  if (isStaleChunkError(error)) {
    return { message: `${feature} couldn't load because a new version of the app is live. Reload to update.`, staleChunk: true };
  }
  return { message: `${feature} couldn't load. Check your connection and try again.`, staleChunk: false };
}
