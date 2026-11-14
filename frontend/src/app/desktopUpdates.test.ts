import { CHECK_EVERY_MS, FIRST_CHECK_MS, describeInstallError, setUpDesktopUpdates } from './desktopUpdates';

function fakeFlow() {
  let install: (() => Promise<void>) | null = null;
  return {
    offer: vi.fn(),
    useAppUpdater: vi.fn((next: () => Promise<void>) => {
      install = next;
    }),
    install: () => install!(),
  };
}

describe('desktop app updates (#179)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('checks a little after start and then every few hours', () => {
    const setTimer = vi.fn();
    const setRepeat = vi.fn();
    setUpDesktopUpdates({ flow: () => null, invoke: vi.fn(async () => null), setTimer, setRepeat });
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), FIRST_CHECK_MS);
    expect(setRepeat).toHaveBeenCalledWith(expect.any(Function), CHECK_EVERY_MS);
  });

  it('shows the update card with an installer when the shell finds a release', async () => {
    const flow = fakeFlow();
    const invoke = vi.fn(async (command: string) => (command === 'update_check' ? { version: '0.2.0', notes: null } : undefined));
    const updates = setUpDesktopUpdates({ flow: () => flow, invoke, setTimer: vi.fn(), setRepeat: vi.fn() });
    expect(await updates.check()).toBe('0.2.0');
    expect(flow.useAppUpdater).toHaveBeenCalledTimes(1);
    expect(flow.offer).toHaveBeenCalledWith('deploy');
    // The same release again only shows the card again.
    await updates.check();
    expect(flow.useAppUpdater).toHaveBeenCalledTimes(1);
    expect(flow.offer).toHaveBeenCalledTimes(2);
    await flow.install();
    expect(invoke).toHaveBeenLastCalledWith('update_install');
  });

  it('turns install errors into words', async () => {
    const flow = fakeFlow();
    const invoke = vi.fn(async (command: string) => {
      if (command === 'update_check') return { version: '0.2.0' };
      throw 'no_update';
    });
    await setUpDesktopUpdates({ flow: () => flow, invoke, setTimer: vi.fn(), setRepeat: vi.fn() }).check();
    await expect(flow.install()).rejects.toThrow('No update is ready yet');
    expect(describeInstallError(new Error('signature mismatch'))).toBe('signature mismatch');
    expect(describeInstallError('')).toBe('unknown error');
  });

  it('shows nothing with no update, no updater, no flow yet, or a failed check', async () => {
    const flow = fakeFlow();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await setUpDesktopUpdates({ flow: () => flow, invoke: vi.fn(async () => null), setTimer: vi.fn(), setRepeat: vi.fn() }).check()).toBeNull();
    expect(await setUpDesktopUpdates({ flow: () => null, invoke: vi.fn(async () => ({ version: '1.0.0' })), setTimer: vi.fn(), setRepeat: vi.fn() }).check()).toBeNull();
    expect(
      await setUpDesktopUpdates({
        flow: () => flow,
        invoke: vi.fn(async () => {
          throw 'offline';
        }),
        setTimer: vi.fn(),
        setRepeat: vi.fn(),
      }).check(),
    ).toBeNull();
    expect(warn).toHaveBeenCalledWith('Update check failed', 'offline');
    expect(flow.offer).not.toHaveBeenCalled();
  });

  it('does nothing outside the desktop app', async () => {
    const setTimer = vi.fn();
    const updates = setUpDesktopUpdates({ flow: () => fakeFlow(), setTimer, setRepeat: vi.fn() });
    expect(setTimer).not.toHaveBeenCalled();
    expect(await updates.check()).toBeNull();
  });

  it('uses the shell when there is one', async () => {
    const invoke = vi.fn(async () => null);
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
    await setUpDesktopUpdates({ flow: () => fakeFlow(), setTimer: vi.fn(), setRepeat: vi.fn() }).check();
    expect(invoke).toHaveBeenCalledWith('update_check');
  });
});
