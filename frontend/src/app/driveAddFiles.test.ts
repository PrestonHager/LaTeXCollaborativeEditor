import * as Y from 'yjs';
import { MemoryProvider } from '../test/memoryProvider';
import { ProjectDoc } from '../project/projectDoc';
import { starterProject } from '../project/projectIo';
import { manifestFromProject, saveProject, textRev, type SavedManifest } from '../storage/projectSaver';
import type { BlobStore } from '../project/blobStore';
import type { PickerSelection } from '../storage/providers/googlePicker';
import { addFilesFromDrive, addFromDriveNote, describeAddResult, mergeNewDriveFiles, type AddFromDriveDeps } from './driveAddFiles';

const bytes = (text: string) => new TextEncoder().encode(text);

/**
 * A memory provider standing in for Drive. Files in `hidden` are in the folder but the app can't
 * see them yet, like files added from drive.google.com under the drive.file scope.
 */
class FakeDrive extends MemoryProvider {
  readonly hidden = new Set<string>();
  // Drive ids by path, so the Picker can hand back ids.
  readonly ids = new Map<string, string>();
  folderId: string | null = 'folder-1';

  async projectFolderId() {
    return this.folderId;
  }

  async openProject(projectId: string) {
    const listing = await super.openProject(projectId);
    return { ...listing, entries: listing.entries.filter((entry) => !this.hidden.has(entry.path)) };
  }

  pathOfDriveId(_projectId: string, driveId: string) {
    for (const [path, id] of this.ids) if (id === driveId && !this.hidden.has(path)) return path;
    return undefined;
  }

  /** Put a file in the folder the way someone in Drive would: there, but hidden from the app. */
  addInDrive(projectId: string, path: string, data: Uint8Array | null) {
    this.projects.get(projectId)!.files.set(path, data);
    if (data) this.projects.get(projectId)!.versions.set(path, 1);
    this.hidden.add(path);
    this.ids.set(path, `id-${path}`);
  }

  /** What picking does: the app can see it now. */
  pick(paths: string[]): PickerSelection[] {
    return paths.map((path) => {
      this.hidden.delete(path);
      return { id: this.ids.get(path) ?? `id-${path}`, name: path.split('/').pop()!, isFolder: !path.includes('.') };
    });
  }
}

function fakeBlobs() {
  const stored = new Map<string, Uint8Array>();
  return {
    stored,
    blobs: {
      put: vi.fn(async (data: Uint8Array) => {
        const hash = `h${data.length}-${data[0]}`;
        stored.set(hash, data);
        return hash;
      }),
      get: vi.fn(async (hash: string) => stored.get(hash)),
    },
  };
}

/** A project saved once to the fake Drive, so it has a manifest like a real opened project. */
async function savedProject() {
  const drive = new FakeDrive();
  const project = new ProjectDoc(new Y.Doc());
  project.replaceAll(starterProject('Paper'));
  const { blobs } = fakeBlobs();
  const { manifest } = await saveProject({ provider: drive, project, blobs: blobs as unknown as BlobStore, manifest: null, projectId: null });
  return { drive, project, manifest, projectId: manifest.projectId };
}

describe('mergeNewDriveFiles', () => {
  it('adds new files at their Drive path and records them so the next save writes nothing', async () => {
    const { drive, project, manifest, projectId } = await savedProject();
    const { blobs, stored } = fakeBlobs();
    drive.addInDrive(projectId, 'figs', null);
    drive.addInDrive(projectId, 'figs/plot.png', new Uint8Array([7, 8]));
    drive.addInDrive(projectId, 'chapters/intro.tex', bytes('Hello'));
    drive.pick(['figs', 'figs/plot.png', 'chapters/intro.tex']);

    const listing = await drive.openProject(projectId);
    const result = await mergeNewDriveFiles({ provider: drive, projectId, listing, project, blobs, manifest });
    expect(result.added).toEqual(['chapters/intro.tex', 'figs/plot.png']);
    expect(result.kept).toEqual([]);
    expect(project.findByPath('figs')?.kind).toBe('folder');
    expect(project.findByPath('figs/plot.png')).toMatchObject({ kind: 'binary', size: 2 });
    expect(stored.size).toBe(1);
    const intro = project.findByPath('chapters/intro.tex')!;
    expect(project.getText(intro.id).toString()).toBe('Hello');
    expect(manifest.files[intro.id]).toEqual({ path: 'chapters/intro.tex', kind: 'text', rev: textRev('Hello'), version: '1' });

    drive.calls.length = 0;
    await saveProject({ provider: drive, project, blobs: blobs as unknown as BlobStore, manifest, projectId });
    expect(drive.calls).toEqual([]);
  });

  it("keeps the project's own copy and leaves alone paths waiting on a save", async () => {
    const { drive, project, manifest, projectId } = await savedProject();
    const { blobs } = fakeBlobs();
    // Someone added notes.tex here and in Drive. And main.tex was deleted here but not saved yet.
    project.createTextFile('notes.tex', 'mine');
    project.removePath('main.tex');
    drive.addInDrive(projectId, 'notes.tex', bytes('theirs'));
    drive.pick(['notes.tex']);

    const listing = await drive.openProject(projectId);
    const result = await mergeNewDriveFiles({ provider: drive, projectId, listing, project, blobs, manifest });
    expect(result).toEqual({ added: [], kept: ['notes.tex'], failed: [] });
    expect(project.findByPath('main.tex')).toBeUndefined();
    expect(project.getText(project.findByPath('notes.tex')!.id).toString()).toBe('mine');
  });

  it('reports files it could not read, and works without a manifest', async () => {
    const { drive, project, projectId } = await savedProject();
    const { blobs } = fakeBlobs();
    drive.addInDrive(projectId, 'refs.bib', bytes('@book{a}'));
    drive.pick(['refs.bib']);
    vi.spyOn(drive, 'readFile').mockRejectedValueOnce(new Error('offline'));
    const listing = await drive.openProject(projectId);
    const result = await mergeNewDriveFiles({ provider: drive, projectId, listing, project, blobs, manifest: null });
    expect(result.failed).toEqual([{ path: 'refs.bib', message: 'offline' }]);
  });
});

describe('describeAddResult', () => {
  it('sums up what happened', () => {
    expect(describeAddResult({ added: ['a.png'], kept: [], failed: [] }, [])).toEqual({ message: 'Added 1 file(s) from Drive: a.png.', isError: false });
    const mixed = describeAddResult({ added: [], kept: ['b.tex'], failed: [{ path: 'c.bib', message: 'offline' }] }, ['Notes']);
    expect(mixed.isError).toBe(true);
    expect(mixed.message).toContain('No new files to add from Drive.');
    expect(mixed.message).toContain("Kept the project's own copy of b.tex.");
    expect(mixed.message).toContain('Could not add Notes');
    expect(mixed.message).toContain('Failed: c.bib (offline).');
  });
});

describe('addFromDriveNote', () => {
  it('explains why the button is off', () => {
    expect(addFromDriveNote({ isClient: true, isDrive: true })).toMatch(/Only the host/);
    expect(addFromDriveNote({ isClient: false, isDrive: false })).toMatch(/Save the project to Google Drive first/);
    expect(addFromDriveNote({ isClient: false, isDrive: true })).toMatch(/stay hidden until you pick them/);
  });
});

describe('addFilesFromDrive', () => {
  async function setup(overrides: Partial<AddFromDriveDeps> = {}) {
    const saved = await savedProject();
    const { drive, project, projectId } = saved;
    const state = { drive: true, projectId: projectId as string | null, manifest: saved.manifest as SavedManifest | null };
    const { blobs } = fakeBlobs();
    const deps = {
      isClient: false,
      projectState: {
        isDrive: () => state.drive,
        get projectId() {
          return state.projectId;
        },
        get manifest() {
          return state.manifest;
        },
      },
      provider: drive,
      getProject: () => project,
      blobs,
      autosave: { enqueue: vi.fn((task: () => Promise<void>) => task()) },
      ensureDrivePickerConfig: vi.fn(() => true),
      ensureDriveConnected: vi.fn(async () => true),
      pickFiles: vi.fn(async (_folderId: string): Promise<PickerSelection[] | null> => drive.pick(['figs/plot.png'])),
      setStatus: vi.fn(),
      showNotice: vi.fn(),
      ...overrides,
    };
    drive.addInDrive(projectId, 'figs/plot.png', new Uint8Array([1]));
    return { ...saved, deps, state };
  }

  it('picks in the project folder and adds what was picked', async () => {
    const { deps, project } = await setup();
    await addFilesFromDrive(deps);
    expect(deps.pickFiles).toHaveBeenCalledWith('folder-1');
    expect(deps.autosave.enqueue).toHaveBeenCalledTimes(1);
    expect(project.findByPath('figs/plot.png')?.kind).toBe('binary');
    expect(deps.setStatus).toHaveBeenLastCalledWith('Drive: Added 1 file(s)');
    expect(deps.showNotice).toHaveBeenCalledWith('Added 1 file(s) from Drive: figs/plot.png.', false);
  });

  it('flags picked files it could not place', async () => {
    const { deps, drive } = await setup();
    vi.mocked(deps.pickFiles).mockImplementationOnce(async () => [{ id: 'elsewhere', name: 'Other.png', isFolder: false }]);
    await addFilesFromDrive(deps);
    expect(drive.hidden.has('figs/plot.png')).toBe(true);
    expect(deps.setStatus).toHaveBeenLastCalledWith('Drive: No new files');
    expect(deps.showNotice).toHaveBeenCalledWith(expect.stringContaining('Could not add Other.png'), true);
  });

  it('does nothing for guests', async () => {
    const { deps } = await setup({ isClient: true });
    await addFilesFromDrive(deps);
    expect(deps.ensureDriveConnected).not.toHaveBeenCalled();
    expect(deps.pickFiles).not.toHaveBeenCalled();
  });

  it('stops when Drive is not set up, not connected, or the project is not on Drive', async () => {
    const noConfig = await setup({ ensureDrivePickerConfig: vi.fn(() => false) });
    await addFilesFromDrive(noConfig.deps);
    expect(noConfig.deps.ensureDriveConnected).not.toHaveBeenCalled();

    const offline = await setup({ ensureDriveConnected: vi.fn(async () => false) });
    await addFilesFromDrive(offline.deps);
    expect(offline.deps.pickFiles).not.toHaveBeenCalled();

    const local = await setup();
    local.state.drive = false;
    await addFilesFromDrive(local.deps);
    expect(local.deps.setStatus).toHaveBeenLastCalledWith('Drive: Save the project to Drive first');
    expect(local.deps.pickFiles).not.toHaveBeenCalled();
  });

  it('asks an old single-file project to get a folder first', async () => {
    const { deps, drive } = await setup();
    drive.folderId = null;
    await addFilesFromDrive(deps);
    expect(deps.showNotice).toHaveBeenCalledWith(expect.stringContaining('still a single Drive file'), true);
    expect(deps.pickFiles).not.toHaveBeenCalled();
  });

  it('handles a canceled or broken Picker', async () => {
    const { deps } = await setup();
    vi.mocked(deps.pickFiles).mockResolvedValueOnce(null);
    await addFilesFromDrive(deps);
    expect(deps.setStatus).toHaveBeenLastCalledWith('Drive: Selection canceled');

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(deps.pickFiles).mockRejectedValueOnce(new Error('popup blocked'));
    await addFilesFromDrive(deps);
    expect(deps.setStatus).toHaveBeenLastCalledWith('Drive: popup blocked');
    expect(deps.autosave.enqueue).not.toHaveBeenCalled();
  });

  it('adds nothing if the project changed while the Picker was open', async () => {
    const { deps, state, project } = await setup();
    vi.mocked(deps.pickFiles).mockImplementationOnce(async () => {
      state.projectId = 'other';
      return [{ id: 'x', name: 'x.png', isFolder: false }];
    });
    await addFilesFromDrive(deps);
    expect(deps.setStatus).toHaveBeenLastCalledWith('Drive: The project changed, so nothing was added');
    expect(project.findByPath('figs/plot.png')).toBeUndefined();
  });
});

describe('manifest round trip', () => {
  it('matches what a fresh open would record', async () => {
    const { drive, project, manifest, projectId } = await savedProject();
    const { blobs } = fakeBlobs();
    drive.addInDrive(projectId, 'a.tex', bytes('A'));
    drive.pick(['a.tex']);
    await mergeNewDriveFiles({ provider: drive, projectId, listing: await drive.openProject(projectId), project, blobs, manifest });
    const fresh = manifestFromProject(projectId, project, (path) => drive.fileVersion(projectId, path));
    expect(manifest.files).toEqual(fresh.files);
  });
});
