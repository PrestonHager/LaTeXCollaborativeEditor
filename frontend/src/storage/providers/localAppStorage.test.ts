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
});
