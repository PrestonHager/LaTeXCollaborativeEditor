import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { manifestFromProject, saveProject, textRev, type SavedManifest } from './projectSaver';
import { ProjectDoc } from '../project/projectDoc';
import { BlobStore } from '../project/blobStore';
import { MemoryProvider } from '../test/memoryProvider';
import { createFileHistory } from '../project/fileHistory';

function setup() {
  const provider = new MemoryProvider();
  const project = new ProjectDoc(new Y.Doc());
  const blobs = new BlobStore();
  let manifest: SavedManifest | null = null;
  let projectId: string | null = null;
  const save = async () => {
    provider.calls.length = 0;
    const result = await saveProject({ provider, project, blobs, manifest, projectId });
    manifest = result.manifest;
    projectId = result.manifest.projectId;
    return result;
  };
  return { provider, project, blobs, save, id: () => projectId! };
}

describe('saveProject', () => {
  it('makes the project on the first save, then only writes what changed', async () => {
    const t = setup();
    t.project.setName('Thesis');
    const main = t.project.createTextFile('main.tex', '\\documentclass{article}');
    t.project.createFolder('empty');
    const hash = await t.blobs.put(new Uint8Array([1, 2]));
    t.project.putBinaryFile('img/a.png', hash, 2);

    const steps: SavedManifest[] = [];
    const first = await saveProject({ provider: t.provider, project: t.project, blobs: t.blobs, manifest: null, projectId: null, onStep: (step) => steps.push(step) });
    expect(t.provider.calls).toEqual(['create Thesis', 'folder empty', 'write img/a.png', 'write main.tex', 'main main.tex']);
    expect(first.pending).toBe(0);
    expect(steps.length).toBeGreaterThan(3);

    t.provider.calls.length = 0;
    const second = await saveProject({ provider: t.provider, project: t.project, blobs: t.blobs, manifest: first.manifest, projectId: first.manifest.projectId });
    expect(t.provider.calls).toEqual([]);

    t.project.getText(main).insert(0, '% hi\n');
    await saveProject({ provider: t.provider, project: t.project, blobs: t.blobs, manifest: second.manifest, projectId: second.manifest.projectId });
    expect(t.provider.calls).toEqual(['write main.tex']);
  });

  it('moves folders once, deletes before writing, and renames the project', async () => {
    const t = setup();
    t.project.setName('P');
    t.project.createTextFile('ch/a.tex', 'a');
    t.project.createTextFile('ch/b.tex', 'b');
    t.project.createTextFile('old/x.tex', 'x');
    t.project.createTextFile('main.tex', '\\documentclass{article}');
    await t.save();

    t.project.movePath('ch', 'chapters');
    t.project.removePath('old');
    t.project.setName('Renamed');
    await t.save();
    expect(t.provider.calls).toEqual(['remove old/x.tex', 'move ch/a.tex chapters/a.tex', 'move ch/b.tex chapters/b.tex', 'rename Renamed']);
    expect([...t.provider.projects.get(t.id())!.files.keys()].sort()).toEqual(['chapters/a.tex', 'chapters/b.tex', 'main.tex']);
  });

  it('moves an explicit folder in one call and deletes a folder in one call', async () => {
    const t = setup();
    t.project.setName('P');
    t.project.createFolder('figs');
    t.project.createTextFile('figs/a.tex', 'a');
    t.project.createFolder('gone');
    t.project.createTextFile('gone/b.tex', 'b');
    await t.save();
    t.project.movePath('figs', 'figures');
    t.project.removePath('gone');
    await t.save();
    expect(t.provider.calls).toEqual(['remove gone', 'move figs figures']);
  });

  it('waits on binary files that have not arrived yet', async () => {
    const t = setup();
    t.project.setName('P');
    t.project.putBinaryFile('a.png', 'not-here-yet', 3);
    const result = await t.save();
    expect(result.pending).toBe(1);
    expect(t.provider.projects.get(t.id())!.files.has('a.png')).toBe(false);
  });

  it('writes everything, and deletes nothing, for a known project without a manifest', async () => {
    const t = setup();
    const { id } = await t.provider.createProject('Old');
    await t.provider.writeFile(id, 'other.tex', 'made in Drive');
    t.project.setName('Old');
    t.project.createTextFile('main.tex', 'x');
    await saveProject({ provider: t.provider, project: t.project, blobs: t.blobs, manifest: null, projectId: id });
    expect(t.provider.text(id, 'other.tex')).toBe('made in Drive');
    expect(t.provider.text(id, 'main.tex')).toBe('x');
  });

  it('picks up a new project id from the provider', async () => {
    const t = setup();
    t.project.setName('P');
    t.project.createTextFile('main.tex', 'x');
    Object.assign(t.provider, { currentProjectId: (id: string) => `${id}-moved` });
    const result = await saveProject({ provider: t.provider, project: t.project, blobs: t.blobs, manifest: null, projectId: null });
    expect(result.manifest.projectId).toBe('p1-moved');
  });

  it('builds a manifest that matches a freshly loaded project', async () => {
    const project = new ProjectDoc(new Y.Doc());
    project.setName('P');
    const id = project.createTextFile('main.tex', '\\documentclass{article}');
    project.putBinaryFile('a.png', 'h', 1);
    project.createFolder('f');
    const manifest = manifestFromProject('pid', project);
    expect(manifest.mainPath).toBe('main.tex');
    expect(manifest.files[id]).toEqual({ path: 'main.tex', kind: 'text', rev: textRev('\\documentclass{article}') });
    expect(Object.values(manifest.files).map((file) => file.rev)).toContain('h');
  });

  it('keeps the version from a load, so the first save can check it', () => {
    const project = new ProjectDoc(new Y.Doc());
    const text = project.createTextFile('main.tex', 'x');
    const folder = project.createFolder('f');
    const manifest = manifestFromProject('pid', project, (path) => (path === 'main.tex' ? 'v7' : 'nope'));
    expect(manifest.files[text].version).toBe('v7');
    expect(manifest.files[folder].version).toBeUndefined();
  });

  describe('conflicts', () => {
    /** Save a two-file project once, then let the test change things. */
    async function savedTwice() {
      const t = setup();
      t.project.setName('P');
      const main = t.project.createTextFile('main.tex', 'mine');
      const other = t.project.createTextFile('other.tex', 'a');
      let manifest = (await saveProject({ provider: t.provider, project: t.project, blobs: t.blobs, manifest: null, projectId: null })).manifest;
      const save = async (extra: { held?: Set<string>; overwrite?: Set<string> } = {}) => {
        t.provider.calls.length = 0;
        const result = await saveProject({ provider: t.provider, project: t.project, blobs: t.blobs, manifest, projectId: manifest.projectId, ...extra });
        manifest = result.manifest;
        return result;
      };
      return { ...t, main, other, save, manifest: () => manifest };
    }

    it('records the version of every write', async () => {
      const t = await savedTwice();
      expect(t.manifest().files[t.main].version).toBe('1');
      t.project.getText(t.main).insert(0, '% ');
      await t.save();
      expect(t.manifest().files[t.main].version).toBe('2');
    });

    it('holds a file that changed in storage and still saves the rest', async () => {
      const t = await savedTwice();
      const pid = t.manifest().projectId;
      t.provider.editElsewhere(pid, 'main.tex', 'theirs');
      t.project.getText(t.main).insert(0, 'more ');
      t.project.getText(t.other).insert(0, 'b');

      const result = await t.save();
      expect(result.conflicts).toEqual([{ id: t.main, path: 'main.tex', remoteVersion: '2' }]);
      expect(t.provider.calls).toEqual(['conflict main.tex', 'write other.tex']);
      expect(t.provider.text(pid, 'main.tex')).toBe('theirs');
      // The held file keeps its old rev, so it still counts as unsaved.
      expect(t.manifest().files[t.main].rev).toBe(textRev('mine'));

      // While held, saves don't even try it.
      await t.save({ held: new Set([t.main]) });
      expect(t.provider.calls).toEqual([]);

      // Keep mine overwrites it.
      await t.save({ overwrite: new Set([t.main]) });
      expect(t.provider.calls).toEqual(['write main.tex']);
      expect(t.provider.text(pid, 'main.tex')).toBe('more mine');
      expect(t.manifest().files[t.main].version).toBe('3');
    });

    it('still throws other errors', async () => {
      const t = await savedTwice();
      t.project.getText(t.main).insert(0, 'x');
      vi.spyOn(t.provider, 'writeFile').mockRejectedValueOnce(new Error('offline'));
      await expect(t.save()).rejects.toThrow('offline');
    });
  });

  it('fingerprints text by content and length', () => {
    expect(textRev('abc')).toBe(textRev('abc'));
    expect(textRev('abc')).not.toBe(textRev('abd'));
  });

  describe('after an undone delete', () => {
    const withHistory = async () => {
      const t = setup();
      t.project.setName('P');
      const history = createFileHistory(t.project, { blobs: t.blobs });
      // The main file follows the .tex files around, which isn't what these tests are about.
      const ops = () => t.provider.calls.filter((call) => !call.startsWith('main '));
      return { ...t, history, ops };
    };

    it('untrashes the same file instead of writing a copy', async () => {
      const t = await withHistory();
      t.project.createTextFile('a.tex', 'a');
      await t.save();
      t.history.record('Delete a.tex', () => t.project.removePath('a.tex'));
      await t.save();
      expect(t.ops()).toEqual(['remove a.tex']);
      t.history.undo();
      await t.save();
      expect(t.ops()).toEqual(['restore a.tex']);
      expect(t.provider.text(t.id(), 'a.tex')).toBe('a');
      // Nothing left to write on the next save.
      await t.save();
      expect(t.ops()).toEqual([]);
    });

    it('untrashes a folder with everything in it, and trashes again what the project lost since', async () => {
      const t = await withHistory();
      t.project.createFolder('ch');
      t.project.createTextFile('ch/a.tex', 'a');
      const png = await t.blobs.put(new Uint8Array([1, 2, 3]));
      t.project.putBinaryFile('ch/b.png', png, 3);
      await t.save();
      t.history.record('Delete ch', () => t.project.removePath('ch'));
      await t.save();
      t.history.undo();
      t.project.removePath('ch/b.png');
      await t.save();
      expect(t.ops()).toEqual(['restore ch', 'remove ch/b.png']);
      expect([...t.provider.projects.get(t.id())!.files.keys()].sort()).toEqual(['ch', 'ch/a.tex']);
    });

    it('restores under the old name, then moves it aside for a file someone made there', async () => {
      const t = await withHistory();
      t.project.createTextFile('a.tex', 'mine');
      await t.save();
      t.history.record('Delete a.tex', () => t.project.removePath('a.tex'));
      await t.save();
      // Not recorded, so it counts as someone else's.
      t.project.createTextFile('a.tex', 'theirs');
      t.history.undo();
      await t.save();
      expect(t.ops()).toEqual(['restore a.tex', 'move a.tex a (restored).tex', 'write a.tex']);
      expect(t.provider.text(t.id(), 'a (restored).tex')).toBe('mine');
      expect(t.provider.text(t.id(), 'a.tex')).toBe('theirs');
    });

    it('writes the file again when storage can no longer untrash it', async () => {
      const t = await withHistory();
      t.project.createTextFile('a.tex', 'a');
      await t.save();
      t.history.record('Delete a.tex', () => t.project.removePath('a.tex'));
      await t.save();
      t.provider.restorable = false;
      t.history.undo();
      await t.save();
      expect(t.ops()).toEqual(['write a.tex']);
    });

    it('remembers a bounded number of trashed files', async () => {
      const t = await withHistory();
      for (let i = 0; i < 3; i += 1) t.project.createTextFile(`f${i}.tex`, 'x');
      await t.save();
      for (let i = 0; i < 3; i += 1) t.project.removePath(`f${i}.tex`);
      const { manifest } = await t.save();
      expect(Object.values(manifest.trashed ?? {}).map((file) => file.path)).toEqual(['f0.tex', 'f1.tex', 'f2.tex']);
    });
  });
});
