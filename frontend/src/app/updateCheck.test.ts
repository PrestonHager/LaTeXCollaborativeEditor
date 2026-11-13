import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_MIN_GAP_MS,
  createUpdateChecker,
  flushBeforeReload,
  isStaleChunkError,
  updatePromptText,
  versionJsonUrl,
} from './updateCheck';
import type { BuildInfo } from './buildInfo';

const current: BuildInfo = { version: '0.1.0', commit: 'abc1234', builtAt: '2026-11-13T10:00:00.000Z' };
const newer: BuildInfo = { version: '0.1.0', commit: 'def5678', builtAt: '2026-11-14T10:00:00.000Z' };

const respond = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function setup(fetchImpl: ReturnType<typeof vi.fn>, extra: Partial<Parameters<typeof createUpdateChecker>[0]> = {}) {
  const win = new EventTarget() as unknown as Window;
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState }) as unknown as Document;
  const onUpdate = vi.fn();
  const checker = createUpdateChecker({
    current,
    baseUrl: 'https://example.com/app/index.html',
    onUpdate,
    fetch: fetchImpl as unknown as Parameters<typeof createUpdateChecker>[0]['fetch'],
    win,
    doc,
    isOnline: () => true,
    ...extra,
  });
  return { checker, onUpdate, win, doc };
}

describe('versionJsonUrl', () => {
  it('resolves next to the page and adds a cache-busting query', () => {
    expect(versionJsonUrl('https://example.com/app/index.html?room=x', 42)).toBe('https://example.com/app/version.json?t=42');
    expect(versionJsonUrl('https://example.com/', 1)).toBe('https://example.com/version.json?t=1');
  });
});

describe('createUpdateChecker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fetches version.json without the cache and stays quiet for the same build', async () => {
    const fetchImpl = vi.fn(async () => respond(current));
    const { checker, onUpdate } = setup(fetchImpl);
    expect(await checker.check()).toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/example\.com\/app\/version\.json\?t=\d+$/), { cache: 'no-store' });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('announces a new build once, even when later checks see it again', async () => {
    const fetchImpl = vi.fn(async () => respond(newer));
    const { checker, onUpdate } = setup(fetchImpl);
    expect(await checker.check()).toEqual(newer);
    expect(await checker.check()).toEqual(newer);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(newer);
  });

  it('announces the next build after one that was put off', async () => {
    const third = { ...newer, version: '0.2.0' };
    const fetchImpl = vi.fn().mockResolvedValueOnce(respond(newer)).mockResolvedValueOnce(respond(third));
    const { checker, onUpdate } = setup(fetchImpl);
    await checker.check();
    await checker.check();
    expect(onUpdate.mock.calls.map(([info]) => info.version)).toEqual(['0.1.0', '0.2.0']);
  });

  it('checks on start and then on the interval', async () => {
    const fetchImpl = vi.fn(async () => respond(current));
    const { checker } = setup(fetchImpl);
    checker.start();
    checker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    checker.stop();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 4);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(checker.isRunning()).toBe(false);
  });

  it('checks on focus and visibility, throttled', async () => {
    const fetchImpl = vi.fn(async () => respond(current));
    const { checker, win, doc } = setup(fetchImpl);
    checker.start();
    await vi.advanceTimersByTimeAsync(0);
    win.dispatchEvent(new Event('focus'));
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_MIN_GAP_MS);
    (doc as { visibilityState: string }).visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    (doc as { visibilityState: string }).visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    checker.stop();
  });

  it('shares one request between overlapping checks', async () => {
    let resolve!: (value: unknown) => void;
    const fetchImpl = vi.fn(() => new Promise((r) => (resolve = r)));
    const { checker } = setup(fetchImpl);
    const a = checker.check();
    const b = checker.check();
    resolve(respond(newer));
    expect(await a).toEqual(newer);
    expect(await b).toEqual(newer);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails silently and backs off on errors, bad JSON and being offline', async () => {
    let online = true;
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(respond({ version: 'nope' }))
      .mockResolvedValueOnce(respond(null, 500))
      .mockResolvedValue(respond(newer));
    const { checker, onUpdate } = setup(fetchImpl, { isOnline: () => online });
    checker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // One failure doubles the wait.
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    online = false;
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    online = true;
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(onUpdate).toHaveBeenCalledWith(newer);
    checker.stop();
  });

  it('stops polling when the host has no version.json', async () => {
    const fetchImpl = vi.fn(async () => respond(null, 404));
    const { checker } = setup(fetchImpl);
    checker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(checker.isRunning()).toBe(false);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 10);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('updatePromptText', () => {
  it('words the prompt for each reason and room role', () => {
    expect(updatePromptText('deploy', { isHost: true, inRoom: false })).toEqual({
      message: 'A new version of the app is available.',
      detail: 'Your changes are saved first.',
    });
    expect(updatePromptText('peer', { isHost: false, inRoom: true }).message).toMatch(/collaborator is on a newer version/);
    expect(updatePromptText('peer', { isHost: false, inRoom: true }).detail).toMatch(/rejoin the room/);
    expect(updatePromptText('stale-chunk', { isHost: true, inRoom: true }).message).toMatch(/couldn't load/);
    expect(updatePromptText('deploy', { isHost: true, inRoom: true }).detail).toMatch(/Guests are disconnected for a moment/);
  });
});

describe('flushBeforeReload', () => {
  const autosave = (over: Partial<Parameters<typeof flushBeforeReload>[0]['autosave']> = {}) => ({
    hasUnsavedChanges: () => true,
    isPaused: () => false,
    lastSaveError: () => null,
    saveNow: vi.fn(async () => true),
    ...over,
  });

  it('writes the session and saves pending edits right away', async () => {
    const persist = vi.fn();
    const saver = autosave();
    expect(await flushBeforeReload({ isClient: false, persist, autosave: saver })).toBeNull();
    expect(persist).toHaveBeenCalled();
    expect(saver.saveNow).toHaveBeenCalled();
  });

  it('skips the provider save with nothing pending, while paused, and for guests', async () => {
    for (const [isClient, saver] of [
      [false, autosave({ hasUnsavedChanges: () => false })],
      [false, autosave({ isPaused: () => true })],
      [true, autosave()],
    ] as const) {
      const persist = vi.fn();
      expect(await flushBeforeReload({ isClient, persist, autosave: saver })).toBeNull();
      expect(persist).toHaveBeenCalled();
      expect(saver.saveNow).not.toHaveBeenCalled();
    }
  });

  it('retries a save that failed before, and reports a failure', async () => {
    let error: string | null = 'network';
    const saver = autosave({ hasUnsavedChanges: () => false, lastSaveError: () => error, saveNow: vi.fn(async () => false) });
    expect(await flushBeforeReload({ isClient: false, persist: () => undefined, autosave: saver })).toBe("Couldn't save: network.");
    error = null;
    expect(await flushBeforeReload({ isClient: false, persist: () => undefined, autosave: { ...saver, hasUnsavedChanges: () => true } })).toBe(
      "Couldn't save: the save failed.",
    );
  });

  it('stops on work a save cannot finish', async () => {
    const saver = autosave();
    expect(await flushBeforeReload({ isClient: false, persist: () => undefined, autosave: saver, blocker: () => 'held' })).toBe('held');
    expect(saver.saveNow).not.toHaveBeenCalled();
  });
});

describe('isStaleChunkError', () => {
  it('spots failed lazy chunk loads from each browser', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js'))).toBe(true);
    expect(isStaleChunkError('error loading dynamically imported module')).toBe(true);
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isStaleChunkError(new Error('Something else'))).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});
