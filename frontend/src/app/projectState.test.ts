import { MemoryProvider } from '../test/memoryProvider';
import type { AppSessionState } from '../state/appSession';
import type { SavedManifest } from '../storage/projectSaver';
import { ProjectState, toTexName, type DriveLike } from './projectState';

// A memory provider standing in for Drive, with a token we can turn on and off.
class FakeDrive extends MemoryProvider {
  tokenOk = true;
  hasUsableToken() {
    return this.tokenOk;
  }
  legacyProjectId(documentId: string | undefined, fileName: string) {
    return documentId ? `legacy:${documentId}:${fileName}` : null;
  }
}

const manifest = (projectId: string): SavedManifest => ({ projectId, name: 'Paper', mainPath: 'main.tex', files: {} });

const session = (overrides: Partial<AppSessionState> = {}): AppSessionState => ({
  documentName: 'Paper',
  content: '',
  providerMode: 'local',
  saveNowEnabled: false,
  updatedAt: 0,
  ...overrides,
});

function setup() {
  const local = new MemoryProvider();
  const drive = new FakeDrive();
  return { local, drive, state: new ProjectState(local, drive as DriveLike) };
}

describe('ProjectState', () => {
  it('adds .tex to names that lack it', () => {
    expect(toTexName('main')).toBe('main.tex');
    expect(toTexName('main.tex')).toBe('main.tex');
  });

  it('starts on local storage with no stored project', () => {
    const { state, local } = setup();
    expect(state.activeProvider).toBe(local);
    expect(state.isDrive()).toBe(false);
    expect(state.savingPaused).toBe(false);
    expect(state.getProviderMode()).toBe('local');
    expect(state.currentStorageLabel()).toBe('Saved on host local storage');
    expect(state.sessionFields()).toMatchObject({ providerMode: 'local', saveNowEnabled: true, projectId: undefined, manifest: undefined });
  });

  it('restores a local session', () => {
    const { state, local } = setup();
    const message = state.restore(session({ documentId: 'doc-1', projectId: 'p1', manifest: manifest('p1') }));
    expect(message).toBeNull();
    expect(state.activeProvider).toBe(local);
    expect(state.documentId).toBe('doc-1');
    expect(state.projectId).toBe('p1');
    expect(state.manifest?.projectId).toBe('p1');
  });

  it('maps the saved saveNowEnabled flag to and from savingPaused', () => {
    const { state } = setup();
    state.restore(session({ saveNowEnabled: false }));
    expect(state.savingPaused).toBe(true);
    expect(state.sessionFields().saveNowEnabled).toBe(false);
    state.restore(session({ saveNowEnabled: true }));
    expect(state.savingPaused).toBe(false);
    expect(state.sessionFields().saveNowEnabled).toBe(true);
  });

  it('restores Drive when the token is still good', () => {
    const { state, drive } = setup();
    const message = state.restore(session({ providerMode: 'drive', projectId: 'folder-1' }));
    expect(message).toBe('Drive: Session restored');
    expect(state.activeProvider).toBe(drive);
    expect(state.projectId).toBe('folder-1');
    expect(state.currentStorageLabel()).toBe('Saved on host Google Drive');
  });

  it('keeps saving to an old single Drive file', () => {
    const { state } = setup();
    state.restore(session({ providerMode: 'drive', documentId: 'doc-1', documentName: 'Paper' }));
    expect(state.projectId).toBe('legacy:doc-1:Paper.tex');
  });

  it('falls back to local when the Drive token expired', () => {
    const { state, drive, local } = setup();
    drive.tokenOk = false;
    const message = state.restore(session({ providerMode: 'drive', projectId: 'folder-1', manifest: manifest('folder-1') }));
    expect(message).toBe('Drive needs you to reconnect; saving locally. Use File > Connect Google Drive.');
    expect(state.activeProvider).toBe(local);
    expect(state.projectId).toBeNull();
    expect(state.manifest).toBeNull();
  });

  it('switches provider and project together, and drops held conflicts', () => {
    const { state, drive } = setup();
    state.conflicts.set('f1', { id: 'f1', path: 'main.tex' });
    state.overwrite.add('f2');
    state.use(drive, 'folder-2', manifest('folder-2'));
    expect(state.getProviderMode()).toBe('drive');
    expect(state.sessionFields()).toMatchObject({ providerMode: 'drive', projectId: 'folder-2' });
    expect(state.conflicts.size).toBe(0);
    expect(state.overwrite.size).toBe(0);
    state.use(drive, null);
    expect(state.manifest).toBeNull();
  });

  it('drops a save that finished after the provider changed', () => {
    const { state, local, drive } = setup();
    expect(state.recordSave(local, manifest('p1'))).toBe(true);
    expect(state.projectId).toBe('p1');
    state.use(drive, null);
    expect(state.recordSave(local, manifest('p2'))).toBe(false);
    expect(state.projectId).toBeNull();
  });
});
