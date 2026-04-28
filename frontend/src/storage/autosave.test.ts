import { AutosaveController } from './autosave';

describe('AutosaveController', () => {
  it('reports off state for saveNow before enable', async () => {
    const statuses: string[] = [];
    const save = vi.fn(async () => {});
    const autosave = new AutosaveController({
      provider: { connect: async () => true, save, status: () => 'x' },
      getContent: () => 'hello',
      getFileName: () => 'doc.tex',
      onStatus: (s) => statuses.push(s),
    });

    await autosave.saveNow();
    expect(statuses.at(-1)).toBe('Autosave Off');
    expect(save).not.toHaveBeenCalled();
  });

  it('saves dirty content after debounce and marks saved', async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const save = vi.fn(async () => {});
    const autosave = new AutosaveController({
      provider: { connect: async () => true, save, status: () => 'x' },
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
