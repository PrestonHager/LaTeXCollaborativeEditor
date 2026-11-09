import { AutosaveController } from './autosave';
import { StorageError } from './errors';

/** Wrap a save mock the way main.ts does, returning the provider label. */
const saver = (save: () => Promise<unknown>, label?: string) => async () => {
  await save();
  return label;
};

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
    const autosave = new AutosaveController({ save: saver(save), onStatus: () => undefined });

    expect(await autosave.saveNow()).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves dirty content after debounce and marks saved', async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const save = vi.fn(async () => {});
    const autosave = new AutosaveController({ save: saver(save), onStatus: (s) => statuses.push(s) });

    autosave.enable();
    autosave.markDirty();
    expect(autosave.hasUnsavedChanges()).toBe(true);
    await vi.advanceTimersByTimeAsync(4000);

    expect(save).toHaveBeenCalledTimes(1);
    expect(statuses).toContain('Saved');
    expect(autosave.hasUnsavedChanges()).toBe(false);
  });

  it('names the provider in the saved status when it has a label', async () => {
    const statuses: string[] = [];
    const autosave = new AutosaveController({ save: saver(async () => {}, 'Google Drive'), onStatus: (s) => statuses.push(s) });
    await autosave.saveNow();
    expect(statuses).toContain('Saved to Google Drive');
  });

  it('runs saves one at a time so a new project is never created twice', async () => {
    let active = 0;
    let maxActive = 0;
    const save = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    });
    const autosave = new AutosaveController({ save: saver(save), onStatus: () => undefined });
    await Promise.all([autosave.saveNow(), autosave.saveNow(), autosave.saveNow()]);
    expect(maxActive).toBe(1);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it('runs queued tasks between saves, never during one', async () => {
    const order: string[] = [];
    const autosave = new AutosaveController({
      save: saver(async () => {
        order.push('save start');
        await new Promise((r) => setTimeout(r, 5));
        order.push('save end');
      }),
      onStatus: () => undefined,
    });
    const saving = autosave.saveNow();
    const task = autosave.enqueue(async () => {
      order.push('task');
      return 7;
    });
    await saving;
    expect(await task).toBe(7);
    expect(order).toEqual(['save start', 'save end', 'task']);
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
    const autosave = new AutosaveController({ save: saver(save), onStatus: (s) => statuses.push(s) });
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
    const autosave = new AutosaveController({ save: saver(vi.fn(async () => {})), onStatus: () => undefined });
    autosave.enable();
    expect(clearIntervalSpy).not.toHaveBeenCalled();
    autosave.enable();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('saveNow surfaces the reason when save exhausts retries', async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const save = vi.fn().mockRejectedValue(new Error('network'));
    const autosave = new AutosaveController({ save, onStatus: (s) => statuses.push(s) });
    const done = autosave.saveNow();
    await vi.runAllTimersAsync();
    expect(await done).toBe(false);
    expect(save).toHaveBeenCalledTimes(4);
    expect(statuses).toContain('Save Error: network');
  });

  it('does not retry errors marked as not retryable', async () => {
    const statuses: string[] = [];
    const save = vi.fn().mockRejectedValue(new StorageError('Drive: Session expired.', { retryable: false }));
    const autosave = new AutosaveController({ save, onStatus: (s) => statuses.push(s) });
    expect(await autosave.saveNow()).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(statuses).toContain('Save Error: Drive: Session expired.');
  });

  it('markDirty is a no-op when disabled', () => {
    const onStatus = vi.fn();
    const autosave = new AutosaveController({ save: vi.fn(), onStatus });
    autosave.markDirty();
    expect(onStatus).not.toHaveBeenCalled();
    expect(autosave.hasUnsavedChanges()).toBe(false);
  });
});
