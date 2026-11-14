import * as Y from 'yjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setUpFolders, type FolderContext } from './desktopFolders';
import { ProjectState, type DriveLike } from './projectState';
import { MemoryProvider } from '../test/memoryProvider';
import { memoryFs } from '../test/memoryFolderFs';
import { ProjectDoc } from '../project/projectDoc';
import { createProviderRegistry, localStorageEntry } from '../storage/providers/registry';
import { manifestFromProject } from '../storage/projectSaver';
import type { FileConflict } from '../storage/conflicts';
import type { StorageProvider } from '../storage/providers/types';

const ROOT = '/home/me/thesis';

async function setup() {
  localStorage.clear();
  const fs = memoryFs(ROOT);
  fs.outside(`${ROOT}/main.tex`, 'disk');
  const local = new MemoryProvider();
  const state = new ProjectState(local, new MemoryProvider() as unknown as DriveLike);
  const registry = createProviderRegistry([localStorageEntry(local)]);
  const project = new ProjectDoc(new Y.Doc());
  project.replaceAll({ name: '', mainPath: 'main.tex', files: [{ path: 'main.tex', kind: 'text', text: 'disk' }] });
  const held: FileConflict[] = [];
  const taken: FileConflict[] = [];
  const ctx = {
    registry,
    projectState: state,
    getProject: () => project,
    useProvider: vi.fn((provider: StorageProvider, id: string | null) => state.use(provider, id)),
    openStoredProject: vi.fn(async (provider: StorageProvider, id: string) => {
      await provider.openProject(id);
      await provider.readFile(id, 'main.tex');
      state.use(provider, id, manifestFromProject(id, project, (path) => provider.fileVersion?.(id, path)));
    }),
    holdConflict: vi.fn((conflict: FileConflict) => void held.push(conflict)),
    takeTheirs: vi.fn(async (conflict: FileConflict) => void taken.push(conflict)),
    confirmDialog: vi.fn(async () => true),
    autosave: { enable: vi.fn(), markDirty: vi.fn() },
    setStatus: vi.fn(),
    showNotice: vi.fn(),
  } satisfies FolderContext;
  const folders = await setUpFolders(ctx, fs);
  return { fs, state, registry, project, ctx, folders, held, taken };
}

/** Let the watcher's async handler run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('setUpFolders', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('adds the folder provider to the registry and ProjectState', async () => {
    const { registry, state } = await setup();
    const entry = registry.get('localFolder');
    expect(entry).toMatchObject({ name: 'Folder on this computer', icon: 'folder', needsSignIn: false, connectCommand: 'file.saveToFolder', actionLabel: 'Save to a Folder' });
    expect(entry.configured()).toBe(true);
    expect(entry.status()).toBe('connected');
    expect(entry.account()).toBeNull();
    expect(state.folderProvider).toBe(entry.provider);
    expect(() => registry.add(entry)).toThrow(/share an id/);
  });

  it('opens a picked folder and watches it', async () => {
    const { folders, ctx, state, fs } = await setup();
    await folders.open();
    expect(ctx.openStoredProject).toHaveBeenCalledWith(state.folderProvider, ROOT);
    expect(state.isFolder()).toBe(true);
    expect(fs.watch).toHaveBeenCalledWith(ROOT, expect.any(Function));
  });

  it('does nothing when the dialog is canceled', async () => {
    const { folders, ctx, fs } = await setup();
    fs.picked = null;
    await folders.open();
    expect(ctx.openStoredProject).not.toHaveBeenCalled();
    expect(ctx.setStatus).toHaveBeenCalledWith('Folder: Selection canceled');
    await folders.saveTo();
    expect(ctx.useProvider).not.toHaveBeenCalled();
  });

  it('reloads a file changed outside the app quietly when there are no unsaved edits', async () => {
    const { folders, fs, taken, held } = await setup();
    await folders.open();
    fs.outside(`${ROOT}/main.tex`, 'from git pull');
    fs.emit([`${ROOT}/main.tex`]);
    await settle();
    expect(held).toEqual([]);
    expect(taken).toEqual([expect.objectContaining({ path: 'main.tex' })]);
  });

  it('asks which copy to keep when there are unsaved edits too', async () => {
    const { folders, fs, project, taken, held } = await setup();
    await folders.open();
    const id = project.findByPath('main.tex')!.id;
    project.getText(id).insert(0, 'local edit ');
    fs.outside(`${ROOT}/main.tex`, 'outside edit');
    fs.emit([`${ROOT}/main.tex`]);
    await settle();
    expect(taken).toEqual([]);
    expect(held).toEqual([expect.objectContaining({ id, path: 'main.tex', remoteVersion: expect.any(String) })]);
  });

  it("ignores the app's own writes, hidden files, deletes and other folders", async () => {
    const { folders, fs, state, taken, held } = await setup();
    await folders.open();
    await state.folderProvider!.writeFile(ROOT, 'main.tex', 'saved by the app');
    fs.outside(`${ROOT}/.git/index`, 'git');
    fs.files.delete(`${ROOT}/gone.tex`);
    fs.emit([`${ROOT}/main.tex`, `${ROOT}/.git/index`, `${ROOT}/gone.tex`, '/elsewhere/x.tex']);
    await settle();
    expect(taken).toEqual([]);
    expect(held).toEqual([]);
  });

  it('says once that files were added outside the app', async () => {
    const { folders, fs, ctx } = await setup();
    await folders.open();
    fs.outside(`${ROOT}/new.tex`, 'new');
    fs.emit([`${ROOT}/new.tex`]);
    await settle();
    fs.outside(`${ROOT}/new2.tex`, 'new');
    fs.emit([`${ROOT}/new2.tex`]);
    await settle();
    expect(ctx.showNotice).toHaveBeenCalledTimes(1);
    expect(ctx.showNotice).toHaveBeenCalledWith(expect.stringMatching(/added to the project folder/));
  });

  it('stops watching once another project is open', async () => {
    const { folders, fs, state, taken } = await setup();
    await folders.open();
    state.use(new MemoryProvider(), 'other');
    fs.outside(`${ROOT}/main.tex`, 'changed');
    fs.emit([`${ROOT}/main.tex`]);
    await settle();
    fs.emit([`${ROOT}/main.tex`]);
    await settle();
    expect(taken).toEqual([]);
  });

  it('saves the project to an empty folder, named after it', async () => {
    const { folders, fs, ctx, state, project } = await setup();
    fs.files.clear();
    await folders.saveTo();
    expect(ctx.confirmDialog).not.toHaveBeenCalled();
    expect(project.getName()).toBe('thesis');
    expect(ctx.useProvider).toHaveBeenCalledWith(state.folderProvider, ROOT);
    expect(ctx.autosave.enable).toHaveBeenCalled();
    expect(ctx.autosave.markDirty).toHaveBeenCalled();
    expect(fs.watch).toHaveBeenCalled();
  });

  it('asks before saving into a folder that has files, and keeps a named project its name', async () => {
    const { folders, ctx, project } = await setup();
    project.setName('Paper');
    ctx.confirmDialog.mockResolvedValueOnce(false);
    await folders.saveTo();
    expect(ctx.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Save into this folder?' }));
    expect(ctx.useProvider).not.toHaveBeenCalled();
    await folders.saveTo();
    expect(ctx.useProvider).toHaveBeenCalled();
    expect(project.getName()).toBe('Paper');
  });

  it('shows the error when the folder cannot be read', async () => {
    const { folders, fs, ctx } = await setup();
    fs.readDir.mockRejectedValueOnce(new Error('forbidden path'));
    await folders.saveTo();
    expect(ctx.showNotice).toHaveBeenCalledWith(expect.stringMatching(/no longer reach/), true);
    expect(ctx.useProvider).not.toHaveBeenCalled();
  });

  it('reopens the last session folder only when it is still reachable', async () => {
    const { folders, state } = await setup();
    expect(await folders.reopen('/gone')).toBeNull();
    expect(await folders.reopen(ROOT)).toBe(state.folderProvider);
  });

  it('keeps watching while the last session folder waits to resume', async () => {
    const { folders, fs, state, taken } = await setup();
    state.restore({ documentName: 'x', content: '', providerMode: 'folder', projectId: ROOT, saveNowEnabled: true, updatedAt: 0 });
    await folders.reopen(ROOT);
    fs.emit([`${ROOT}/main.tex`]);
    await settle();
    state.resumeFolder(state.folderProvider);
    expect(fs.watch).toHaveBeenCalledTimes(1);
    expect(taken).toEqual([]);
  });

  it('still saves when the watch fails to start', async () => {
    const { folders, fs, state } = await setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fs.watch.mockRejectedValueOnce(new Error('inotify limit'));
    await folders.open();
    await settle();
    expect(state.isFolder()).toBe(true);
    expect(warn).toHaveBeenCalledWith('Could not watch the project folder', expect.any(Error));
  });
});
