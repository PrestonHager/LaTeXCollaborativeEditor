import { LocalAppStorageProvider } from './localAppStorage';

describe('LocalAppStorageProvider', () => {
  it('saves and renames documents in browser storage', async () => {
    localStorage.clear();
    const provider = new LocalAppStorageProvider();
    await provider.connect();
    await provider.save('hello', 'doc.tex');
    await provider.saveAs?.('hello2', 'doc.tex', 'renamed.tex');

    const raw = localStorage.getItem('latex_editor_docs');
    expect(raw).toBeTruthy();
    const docs = JSON.parse(raw!);
    expect(docs['doc.tex']).toBeUndefined();
    expect(docs['renamed.tex']).toBe('hello2');
  });

  it('clears saved docs', async () => {
    localStorage.setItem('latex_editor_docs', JSON.stringify({ a: 'b' }));
    const provider = new LocalAppStorageProvider();
    await provider.clear?.();
    expect(localStorage.getItem('latex_editor_docs')).toBe('{}');
  });

  it('lists and loads local documents', async () => {
    localStorage.clear();
    const provider = new LocalAppStorageProvider();
    await provider.save('first', 'b.tex');
    await provider.save('second', 'a.tex');

    expect(provider.listDocuments?.()).toEqual(['a.tex', 'b.tex']);
    expect(provider.loadDocument?.('a.tex')).toBe('second');
    expect(provider.loadDocument?.('missing.tex')).toBeNull();
  });

  it('ignores non-string entries written under our key', () => {
    localStorage.setItem('latex_editor_docs', JSON.stringify({ good: 'tex', bad: 42 }));
    const provider = new LocalAppStorageProvider();
    expect(provider.listDocuments()).toEqual(['good']);
    localStorage.setItem('latex_editor_docs', JSON.stringify(['array']));
    expect(provider.listDocuments()).toEqual([]);
  });

  it('turns a full storage error into a clear, non-retryable message', async () => {
    localStorage.clear();
    const provider = new LocalAppStorageProvider();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    await expect(provider.save('x', 'big.tex')).rejects.toMatchObject({
      message: expect.stringContaining('storage is full'),
      retryable: false,
    });
    spy.mockImplementation(() => {
      throw new Error('locked');
    });
    await expect(provider.save('x', 'big.tex')).rejects.toThrow('Could not write to browser storage.');
    spy.mockRestore();
  });

  it('explains when browser storage cannot be read at all', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const provider = new LocalAppStorageProvider();
    expect(() => provider.listDocuments()).toThrow(/Browser storage is unavailable/);
    spy.mockRestore();
  });
});
