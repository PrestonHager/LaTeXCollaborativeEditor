import { lazyLoadProblem, lazyModule, preloadOnIntent, whenIdle } from './lazy';

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

describe('lazyLoadProblem', () => {
  it('asks for a reload when a deploy removed the chunk', () => {
    const problem = lazyLoadProblem('Settings', new TypeError('Failed to fetch dynamically imported module: https://x/assets/settingsDialog-abc.js'));
    expect(problem.staleChunk).toBe(true);
    expect(problem.message).toMatch(/^Settings couldn't load because a new version.*Reload to update\.$/);
  });

  it('points at the connection otherwise', () => {
    const problem = lazyLoadProblem('The tour', new Error('boom'));
    expect(problem).toEqual({ message: "The tour couldn't load. Check your connection and try again.", staleChunk: false });
  });
});
