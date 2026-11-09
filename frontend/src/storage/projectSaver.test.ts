import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { manifestFromProject, saveProject, textRev, type SavedManifest } from './projectSaver';
import { ProjectDoc } from '../project/projectDoc';
import { BlobStore } from '../project/blobStore';
import { MemoryProvider } from '../test/memoryProvider';

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

  it('fingerprints text by content and length', () => {
    expect(textRev('abc')).toBe(textRev('abc'));
    expect(textRev('abc')).not.toBe(textRev('abd'));
  });
});
