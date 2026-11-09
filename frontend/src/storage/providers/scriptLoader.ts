const scriptPromises = new Map<string, Promise<void>>();

/**
 * Load an external script once and wait for it to finish.
 * We cache the promise per URL, so a second caller waits on the same load
 * instead of returning early while the first tag is still downloading.
 */
export function loadScript(src: string, label = src): Promise<void> {
  const cached = scriptPromises.get(src);
  if (cached) return cached;

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Drop the cache entry so the user can retry after fixing their network or blocker.
      scriptPromises.delete(src);
      script.remove();
      reject(new Error(`Could not load ${label}. Check your connection or any ad/script blockers.`));
    };
    document.head.appendChild(script);
  });
  scriptPromises.set(src, promise);
  return promise;
}

/** Clear the cache, used by tests. */
export function resetScriptLoader() {
  scriptPromises.clear();
}
