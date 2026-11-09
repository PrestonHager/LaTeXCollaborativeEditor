import { AutosaveController } from './autosave';
import { StorageError } from './errors';

const makeProvider = (save: (...args: any[]) => Promise<void>, extra: Record<string, unknown> = {}) => ({
  connect: async () => true,
  save,
  status: () => 'x',
  ...extra,
});

describe('AutosaveController', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('saveNow performs an immediate save even before autosave enable', async () => {
    const save = vi.fn(async () => {});
    const autosave = new AutosaveController({
      provider: () => makeProvider(save),
      getContent: () => 'hello',
      getFileName: () => 'doc.tex',
      onStatus: () => undefined,
    });

    expect(await autosave.saveNow()).toBe(true);
    expect(save).toHaveBeenCalledWith('hello', 'doc.tex');
  });

  it('saves dirty content after debounce and marks saved', async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const save = vi.fn(async () => {});
    const autosave = new AutosaveController({
      provider: () => makeProvider(save),
      getContent: () => 'new text',
      getFileName: () => 'doc.tex',
      onStatus: (s) => statuses.push(s),
    });

    autosave.enable();
    autosave.markDirty();
    expect(autosave.hasUnsavedChanges()).toBe(true);
    await vi.advanceTimersByTimeAsync(4000);

    expect(save).toHaveBeenCalledWith('new text', 'doc.tex');
    expect(statuses).toContain('Saved');
    expect(autosave.hasUnsavedChanges()).toBe(false);
  });

  it('names the provider in the saved status when it has a label', async () => {
    const statuses: string[] = [];
    const autosave = new AutosaveController({
      provider: () => makeProvider(async () => {}, { label: 'Google Drive' }),
      getContent: () => 'a',
      getFileName: () => 'a.tex',
      onStatus: (s) => statuses.push(s),
    });
    await autosave.saveNow();
    expect(statuses).toContain('Saved to Google Drive');
  });

  it('runs saves one at a time so a new file is never created twice', async () => {
    let active = 0;
    let maxActive = 0;
    const save = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    });
    const autosave = new AutosaveController({
      provider: () => makeProvider(save),
      getContent: () => 'a',
      getFileName: () => 'a.tex',
      onStatus: () => undefined,
    });
    await Promise.all([autosave.saveNow(), autosave.saveNow(), autosave.saveNow()]);
    expect(maxActive).toBe(1);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it('keeps edits made during a save marked as unsaved', async () => {
    const statuses: string[] = [];
    let release: () => void = () => undefined;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const autosave = new AutosaveController({
      provider: () => makeProvider(save),
      getContent: () => 'a',
      getFileName: () => 'a.tex',
      onStatus: (s) => statuses.push(s),
    });
    autosave.enable();
    autosave.markDirty();
    const pending = autosave.saveNow();
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    // Now type something while the save is still in flight.
    autosave.markDirty();
    release();
    await pending;
    expect(autosave.hasUnsavedChanges()).toBe(true);
    expect(statuses[statuses.length - 1]).toBe('Saving pending');
  });

  it('enable clears an existing interval before starting a new one', () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    const autosave = new AutosaveController({
      provider: () => makeProvider(vi.fn(async () => {})),
      getContent: () => 'a',
      getFileName: () => 'a.tex',
      onStatus: () => undefined,
    });
    autosave.enable();
    expect(clearIntervalSpy).not.toHaveBeenCalled();
    autosave.enable();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('renameDocument uses saveAs when provider supports it', async () => {
    const saveAs = vi.fn(async () => {});
    const save = vi.fn(async () => {});
    const autosave = new AutosaveController({
      provider: () => makeProvider(save, { saveAs }),
      getContent: () => 'body',
      getFileName: () => 'ignored.tex',
      onStatus: () => undefined,
    });
    expect(await autosave.renameDocument('old.tex', 'new.tex')).toBe(true);
    expect(saveAs).toHaveBeenCalledWith('body', 'old.tex', 'new.tex');
    expect(save).not.toHaveBeenCalled();
  });

  it('renameDocument falls back to save when saveAs is absent', async () => {
    const save = vi.fn(async () => {});
    const autosave = new AutosaveController({
      provider: () => makeProvider(save),
      getContent: () => 'body',
      getFileName: () => 'x.tex',
      onStatus: () => undefined,
    });
    await autosave.renameDocument('old.tex', 'new.tex');
    expect(save).toHaveBeenCalledWith('body', 'new.tex');
  });

  it('renameDocument reports failures instead of throwing', async () => {
    const statuses: string[] = [];
    const autosave = new AutosaveController({
      provider: () => makeProvider(vi.fn(async () => {}), { saveAs: vi.fn().mockRejectedValue(new Error('nope')) }),
      getContent: () => 'body',
      getFileName: () => 'x.tex',
      onStatus: (s) => statuses.push(s),
    });
    const onRenamed = vi.fn();
    expect(await autosave.renameDocument('old.tex', 'new.tex', onRenamed)).toBe(false);
    expect(statuses).toContain('Rename failed: nope');
    expect(onRenamed).not.toHaveBeenCalled();
  });

  it('renameDocument calls onRenamed once the rename worked', async () => {
    const onRenamed = vi.fn();
    const autosave = new AutosaveController({
      provider: () => makeProvider(vi.fn(async () => {}), { saveAs: vi.fn(async () => {}) }),
      getContent: () => 'body',
      getFileName: () => 'x.tex',
      onStatus: () => undefined,
    });
    expect(await autosave.renameDocument('old.tex', 'new.tex', onRenamed)).toBe(true);
    expect(onRenamed).toHaveBeenCalledTimes(1);
  });

  it('saveNow surfaces the reason when save exhausts retries', async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const save = vi.fn().mockRejectedValue(new Error('network'));
    const autosave = new AutosaveController({
      provider: () => makeProvider(save),
      getContent: () => 'x',
      getFileName: () => 'f.tex',
      onStatus: (s) => statuses.push(s),
    });
    const done = autosave.saveNow();
    await vi.runAllTimersAsync();
    expect(await done).toBe(false);
    expect(save).toHaveBeenCalledTimes(4);
    expect(statuses).toContain('Save Error: network');
  });

  it('does not retry errors marked as not retryable', async () => {
    const statuses: string[] = [];
    const save = vi.fn().mockRejectedValue(new StorageError('Drive: Session expired.', { retryable: false }));
    const autosave = new AutosaveController({
      provider: () => makeProvider(save),
      getContent: () => 'x',
      getFileName: () => 'f.tex',
      onStatus: (s) => statuses.push(s),
    });
    expect(await autosave.saveNow()).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(statuses).toContain('Save Error: Drive: Session expired.');
  });

  it('markDirty is a no-op when disabled', () => {
    const onStatus = vi.fn();
    const autosave = new AutosaveController({
      provider: () => makeProvider(vi.fn()),
      getContent: () => '',
      getFileName: () => 'a.tex',
      onStatus,
    });
    autosave.markDirty();
    expect(onStatus).not.toHaveBeenCalled();
    expect(autosave.hasUnsavedChanges()).toBe(false);
  });
});
