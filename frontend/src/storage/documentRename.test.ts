import { renameDocumentTitle, toTexName, type TitleRenameDeps } from './documentRename';
import { AutosaveController } from './autosave';
import { LocalAppStorageProvider } from './providers/localAppStorage';
import { GoogleDriveProvider } from './providers/googleDrive';
import type { StorageProvider } from './providers/types';

vi.mock('./providers/scriptLoader', () => ({ loadScript: vi.fn(async () => undefined) }));

/** Wire the rename up the same way main.ts does, against a real provider and autosave queue. */
function setup(provider: StorageProvider, startName: string) {
  const state = { name: startName, statuses: [] as string[] };
  const commitName = vi.fn((name: string) => {
    state.name = name;
  });
  const autosave = new AutosaveController({
    provider: () => provider,
    getContent: () => 'body',
    getFileName: () => toTexName(state.name),
    onStatus: (s) => state.statuses.push(s),
  });
  const deps = (): TitleRenameDeps => ({
    currentName: state.name,
    storageBlocker: () =>
      provider instanceof GoogleDriveProvider && !provider.isSignedIn()
        ? 'Drive: Session expired. Use File > Connect Google Drive, then rename again.'
        : null,
    renameInStorage: (oldFileName, newFileName, onRenamed) => autosave.renameDocument(oldFileName, newFileName, onRenamed),
    commitName,
    markDirty: vi.fn(),
    onStatus: (s) => state.statuses.push(s),
  });
  return { state, commitName, autosave, deps };
}

const readLocalDocs = () => JSON.parse(localStorage.getItem('latex_editor_docs') ?? '{}') as Record<string, string>;

describe('renameDocumentTitle', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('ignores blank names and names that did not change', async () => {
    const { commitName, deps } = setup(new LocalAppStorageProvider(), 'a');
    expect(await renameDocumentTitle('   ', deps())).toBe(false);
    expect(await renameDocumentTitle(' a ', deps())).toBe(false);
    expect(commitName).not.toHaveBeenCalled();
  });

  it('names an untitled doc right away since nothing is saved yet', async () => {
    const { commitName, deps } = setup(new LocalAppStorageProvider(), 'Untitled');
    const d = deps();
    expect(await renameDocumentTitle('Draft', d)).toBe(true);
    expect(commitName).toHaveBeenCalledWith('Draft');
    expect(d.markDirty).toHaveBeenCalled();
  });

  it('renames locally then commits the title', async () => {
    localStorage.setItem('latex_editor_docs', JSON.stringify({ 'a.tex': 'old' }));
    const { state, deps } = setup(new LocalAppStorageProvider(), 'a');
    expect(await renameDocumentTitle('b', deps())).toBe(true);
    expect(state.name).toBe('b');
    expect(readLocalDocs()).toEqual({ 'b.tex': 'body' });
  });

  it('keeps the old title when the local rename hits a full storage', async () => {
    localStorage.setItem('latex_editor_docs', JSON.stringify({ 'a.tex': 'old' }));
    const provider = new LocalAppStorageProvider();
    const { state, commitName, autosave, deps } = setup(provider, 'a');
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });

    expect(await renameDocumentTitle('b', deps())).toBe(false);
    expect(commitName).not.toHaveBeenCalled();
    expect(state.name).toBe('a');
    expect(state.statuses.some((s) => s.startsWith('Rename failed: Browser storage is full'))).toBe(true);

    // Once there's room again, the next save still goes to the old entry instead of making a new one.
    setItem.mockRestore();
    expect(await autosave.saveNow()).toBe(true);
    expect(readLocalDocs()).toEqual({ 'a.tex': 'body' });
  });

  it('keeps the old title when Drive is signed out', async () => {
    const drive = new GoogleDriveProvider();
    (drive as any).fileRef = { id: 'f1', name: 'a.tex', documentId: 'doc-1' };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { state, commitName, deps } = setup(drive, 'a');

    expect(await renameDocumentTitle('b', deps())).toBe(false);
    expect(commitName).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.statuses).toContain('Drive: Session expired. Use File > Connect Google Drive, then rename again.');
    expect(drive.getCurrentFileRef()).toEqual({ id: 'f1', name: 'a.tex', documentId: 'doc-1' });
  });

  it('keeps the old title and Drive link when the Drive rename fails', async () => {
    const drive = new GoogleDriveProvider();
    (drive as any).accessToken = 'token';
    (drive as any).tokenExpiresAt = Date.now() + 60 * 60 * 1000;
    (drive as any).fileRef = { id: 'f1', name: 'a.tex', documentId: 'doc-1' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    const { state, commitName, deps } = setup(drive, 'a');

    expect(await renameDocumentTitle('b', deps())).toBe(false);
    expect(commitName).not.toHaveBeenCalled();
    expect(state.name).toBe('a');
    expect(drive.getCurrentFileRef()?.name).toBe('a.tex');
    expect(drive.isLinkedTo('doc-1')).toBe(true);
  });

  it('commits before a save queued behind the rename runs', async () => {
    const save = vi.fn(async () => {});
    const saveAs = vi.fn(async () => {});
    const provider = { connect: async () => true, save, saveAs, status: () => 'x' };
    const { autosave, deps } = setup(provider, 'a');

    const renamed = renameDocumentTitle('b', deps());
    const saved = autosave.saveNow();
    await Promise.all([renamed, saved]);

    expect(saveAs).toHaveBeenCalledWith('body', 'a.tex', 'b.tex');
    expect(save).toHaveBeenCalledWith('body', 'b.tex');
  });
});
