import { OfflineError, browserOnline, classifyLoadFailure, createOnlineRetry, isLoadFailure, lazyModule, loadFailureMessage, preloadOnIntent, whenIdle, whenOnline } from './lazy';

describe('lazyModule', () => {
  it('loads once and remembers the module', async () => {
    const load = vi.fn(async () => ({ value: 1 }));
    const lazy = lazyModule(load);
    expect(lazy.current()).toBeNull();
    const [a, b] = await Promise.all([lazy.get(), lazy.get()]);
    expect(a).toBe(b);
    expect(lazy.current()).toBe(a);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('forgets a failed load so the next get tries again', async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('ok');
    const lazy = lazyModule(load);
    await expect(lazy.get()).rejects.toThrow('offline');
    expect(lazy.current()).toBeNull();
    await expect(lazy.get()).resolves.toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('preload starts the load and swallows failures', async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('offline'));
    const lazy = lazyModule(load);
    lazy.preload();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('whenIdle', () => {
  it('uses requestIdleCallback with the timeout when there is one', () => {
    const requestIdleCallback = vi.fn();
    const setTimeout = vi.fn();
    const callback = () => {};
    whenIdle(callback, 500, { requestIdleCallback, setTimeout } as never);
    expect(requestIdleCallback).toHaveBeenCalledWith(callback, { timeout: 500 });
    expect(setTimeout).not.toHaveBeenCalled();
  });

  it('falls back to a timer', () => {
    const setTimeout = vi.fn();
    const callback = () => {};
    whenIdle(callback, 500, { setTimeout } as never);
    expect(setTimeout).toHaveBeenCalledWith(callback, 3000);
  });

  it('defaults to the real window', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    whenIdle(callback);
    vi.advanceTimersByTime(10_000);
    expect(callback).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('preloadOnIntent', () => {
  it.each(['pointerenter', 'focusin', 'touchstart'])('preloads once on %s', (type) => {
    const button = document.createElement('button');
    const preload = vi.fn();
    preloadOnIntent(button, preload);
    button.dispatchEvent(new Event(type));
    button.dispatchEvent(new Event('pointerenter'));
    button.dispatchEvent(new Event('focusin'));
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it('ignores a missing element', () => {
    expect(() => preloadOnIntent(null, vi.fn())).not.toThrow();
  });
});

describe('loading while offline', () => {
  const chunkError = () => new TypeError('Failed to fetch dynamically imported module: https://x/assets/settingsDialog-abc.js');

  it('does not start a load while offline, so it still works once back online', async () => {
    let online = false;
    const load = vi.fn(async () => 'module');
    const lazy = lazyModule(load, () => online);
    lazy.preload();
    await expect(lazy.get()).rejects.toBeInstanceOf(OfflineError);
    expect(load).not.toHaveBeenCalled();
    online = true;
    await expect(lazy.get()).resolves.toBe('module');
    // Once loaded, going offline again doesn't matter.
    online = false;
    await expect(lazy.get()).resolves.toBe('module');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('preloads only while online', async () => {
    const load = vi.fn(async () => 'module');
    lazyModule(load, () => true).preload();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('whenOnline runs the load only while online', async () => {
    const load = vi.fn(async () => 1);
    await expect(whenOnline(load, () => false)).rejects.toBeInstanceOf(OfflineError);
    expect(load).not.toHaveBeenCalled();
    await expect(whenOnline(load, () => true)).resolves.toBe(1);
    await expect(whenOnline(load)).resolves.toBe(1);
  });

  it('reads navigator.onLine', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(browserOnline()).toBe(false);
    vi.stubGlobal('navigator', { onLine: true });
    expect(browserOnline()).toBe(true);
    vi.unstubAllGlobals();
  });

  it('knows a load failure from other errors', () => {
    expect(isLoadFailure(new OfflineError())).toBe(true);
    expect(isLoadFailure(chunkError())).toBe(true);
    expect(isLoadFailure(new Error('quota exceeded'))).toBe(false);
  });

  it('calls it offline, never an update, while the browser is offline', async () => {
    const newerBuildLive = vi.fn(async () => true);
    await expect(classifyLoadFailure(chunkError(), { isOnline: () => false, newerBuildLive })).resolves.toBe('offline');
    await expect(classifyLoadFailure(new OfflineError(), { isOnline: () => true, newerBuildLive })).resolves.toBe('offline');
    expect(newerBuildLive).not.toHaveBeenCalled();
  });

  it('calls a missing chunk an update only when a newer build is live', async () => {
    await expect(classifyLoadFailure(chunkError(), { isOnline: () => true, newerBuildLive: async () => true })).resolves.toBe('update');
    await expect(classifyLoadFailure(chunkError(), { isOnline: () => true, newerBuildLive: async () => false })).resolves.toBe('network');
    await expect(classifyLoadFailure(new Error('boom'), { isOnline: () => true, newerBuildLive: async () => true })).resolves.toBe('error');
  });

  it('words each case', () => {
    expect(loadFailureMessage('offline', 'Settings', true)).toBe("You're offline. Settings will load when you're back online.");
    expect(loadFailureMessage('offline', 'Import .zip')).toBe("You're offline. Import .zip will work once you're back online.");
    expect(loadFailureMessage('network', 'Export')).toBe("Export couldn't load. Check your connection, then reload the page.");
    expect(loadFailureMessage('error', 'Export')).toBe("Export couldn't load. Try again, or reload the page.");
  });
});

describe('createOnlineRetry', () => {
  it('runs what was asked for while offline once back online, one per key', () => {
    const win = new EventTarget() as unknown as Window;
    const onOnline = vi.fn();
    const retry = createOnlineRetry(onOnline, win);
    const first = vi.fn();
    const second = vi.fn();
    const other = vi.fn();
    retry.add('Settings', first);
    retry.add('Settings', second);
    retry.add('Export', other);
    win.dispatchEvent(new Event('online'));
    expect(onOnline).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event('online'));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('listens on the real window by default', () => {
    const run = vi.fn();
    createOnlineRetry().add('Settings', run);
    window.dispatchEvent(new Event('online'));
    expect(run).toHaveBeenCalled();
  });
});
