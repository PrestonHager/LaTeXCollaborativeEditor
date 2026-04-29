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
});
