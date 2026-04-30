import { AutosaveController } from './autosave';

describe('AutosaveController', () => {
  it('saveNow performs an immediate save even before autosave enable', async () => {
    const save = vi.fn(async () => {});
    const provider = { connect: async () => true, save, status: () => 'x' };
    const autosave = new AutosaveController({
      provider: () => provider,
      getContent: () => 'hello',
      getFileName: () => 'doc.tex',
      onStatus: () => undefined,
    });

    await autosave.saveNow();
    expect(save).toHaveBeenCalledWith('hello', 'doc.tex');
  });

  it('saves dirty content after debounce and marks saved', async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const save = vi.fn(async () => {});
    const provider = { connect: async () => true, save, status: () => 'x' };
    const autosave = new AutosaveController({
      provider: () => provider,
      getContent: () => 'new text',
      getFileName: () => 'doc.tex',
      onStatus: (s) => statuses.push(s),
    });

    autosave.enable();
    autosave.markDirty();
    vi.advanceTimersByTime(4000);
    await Promise.resolve();
    await Promise.resolve();

    expect(save).toHaveBeenCalledWith('new text', 'doc.tex');
    expect(statuses).toContain('Saved');
    vi.useRealTimers();
  });

  it('enable clears an existing interval before starting a new one', async () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    const save = vi.fn(async () => {});
    const provider = { connect: async () => true, save, status: () => 'x' };
    const autosave = new AutosaveController({
      provider: () => provider,
      getContent: () => 'a',
      getFileName: () => 'a.tex',
      onStatus: () => undefined,
    });
    autosave.enable();
    expect(clearIntervalSpy).not.toHaveBeenCalled();
    autosave.enable();
    expect(clearIntervalSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('renameDocument uses saveAs when provider supports it', async () => {
    const saveAs = vi.fn(async () => {});
    const save = vi.fn(async () => {});
    const provider = { connect: async () => true, save, saveAs, status: () => 'x' };
    const autosave = new AutosaveController({
      provider: () => provider,
      getContent: () => 'body',
      getFileName: () => 'ignored.tex',
      onStatus: () => undefined,
    });
    await autosave.renameDocument('old.tex', 'new.tex');
    expect(saveAs).toHaveBeenCalledWith('body', 'old.tex', 'new.tex');
    expect(save).not.toHaveBeenCalled();
  });

  it('renameDocument falls back to save when saveAs is absent', async () => {
    const save = vi.fn(async () => {});
    const provider = { connect: async () => true, save, status: () => 'x' };
    const autosave = new AutosaveController({
      provider: () => provider,
      getContent: () => 'body',
      getFileName: () => 'x.tex',
      onStatus: () => undefined,
    });
    await autosave.renameDocument('old.tex', 'new.tex');
    expect(save).toHaveBeenCalledWith('body', 'new.tex');
  });

  it('saveNow surfaces Save Error when save exhausts retries', async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const save = vi.fn().mockRejectedValue(new Error('network'));
    const provider = { connect: async () => true, save, status: () => 'x' };
    const autosave = new AutosaveController({
      provider: () => provider,
      getContent: () => 'x',
      getFileName: () => 'f.tex',
      onStatus: (s) => statuses.push(s),
    });
    const done = autosave.saveNow();
    await vi.runAllTimersAsync();
    await done;
    expect(statuses).toContain('Save Error');
    vi.useRealTimers();
  });

  it('markDirty is a no-op when disabled', () => {
    const onStatus = vi.fn();
    const autosave = new AutosaveController({
      provider: () => ({ connect: async () => true, save: vi.fn(), status: () => '' }),
      getContent: () => '',
      getFileName: () => 'a.tex',
      onStatus,
    });
    autosave.markDirty();
    expect(onStatus).not.toHaveBeenCalled();
  });
});
