import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { keepMineAsCopy, takeTheirs } from './conflictResolution';
import { ConflictError, copyPath } from './conflicts';
import { saveProject, textRev } from './projectSaver';
import { ProjectDoc } from '../project/projectDoc';
import { BlobStore } from '../project/blobStore';
import { MemoryProvider } from '../test/memoryProvider';

/** Save a project, then change main.tex both here and in storage. */
async function conflicted() {
  const provider = new MemoryProvider();
  const project = new ProjectDoc(new Y.Doc());
  const blobs = new BlobStore();
  project.setName('P');
  const main = project.createTextFile('main.tex', 'mine');
  const hash = await blobs.put(new Uint8Array([1]));
  const image = project.putBinaryFile('fig.png', hash, 1);
  const { manifest } = await saveProject({ provider, project, blobs, manifest: null, projectId: null });
  const projectId = manifest.projectId;
  provider.editElsewhere(projectId, 'main.tex', 'theirs');
  project.getText(main).insert(4, ' edited');
  const result = await saveProject({ provider, project, blobs, manifest, projectId });
  return { provider, project, blobs, projectId, main, image, conflict: result.conflicts[0] };
}

describe('conflict resolution', () => {
  it('takes their copy of a text file', async () => {
    const t = await conflicted();
    const saved = await takeTheirs({ ...t });
    expect(t.project.getText(t.main).toString()).toBe('theirs');
    expect(saved).toEqual({ path: 'main.tex', kind: 'text', rev: textRev('theirs'), version: '2' });
  });

  it('keeps my copy as a new file, then takes theirs', async () => {
    const t = await conflicted();
    const saved = await keepMineAsCopy({ ...t });
    expect(t.project.getText(t.main).toString()).toBe('theirs');
    const copy = t.project.findByPath('main (my copy).tex')!;
    expect(t.project.getText(copy.id).toString()).toBe('mine edited');
    expect(saved?.version).toBe('2');
  });

  it('takes their copy of a binary file', async () => {
    const t = await conflicted();
    t.provider.editElsewhere(t.projectId, 'fig.png', 'png');
    const saved = await takeTheirs({ ...t, conflict: { id: t.image, path: 'fig.png', remoteVersion: '2' } });
    const entry = t.project.get(t.image)!;
    expect(entry.hash).toBe(saved?.rev);
    expect(Array.from((await t.blobs.get(entry.hash!))!)).toEqual(Array.from(new TextEncoder().encode('png')));
  });

  it('copies a binary file before taking theirs', async () => {
    const t = await conflicted();
    const before = t.project.get(t.image)!.hash;
    t.provider.editElsewhere(t.projectId, 'fig.png', 'png');
    await keepMineAsCopy({ ...t, conflict: { id: t.image, path: 'fig.png' } });
    expect(t.project.findByPath('fig (my copy).png')?.hash).toBe(before);
  });

  it('does nothing for a file that is gone', async () => {
    const t = await conflicted();
    t.project.removePath('main.tex');
    expect(await takeTheirs({ ...t })).toBeNull();
    expect(await keepMineAsCopy({ ...t })).toBeNull();
  });

  it('names copies so they never clash', () => {
    const taken = new Set(['a (my copy).tex', 'a (my copy 2).tex']);
    expect(copyPath('a.tex', (path) => taken.has(path))).toBe('a (my copy 3).tex');
    expect(copyPath('dir.v2/Makefile', () => false)).toBe('dir.v2/Makefile (my copy)');
    expect(copyPath('.latexmkrc', () => false)).toBe('.latexmkrc (my copy)');
  });

  it('makes a readable, non-retryable error', () => {
    const error = new ConflictError('main.tex', 'v2');
    expect(error.message).toMatch(/main\.tex was changed somewhere else/);
    expect(error.retryable).toBe(false);
    expect(error.remoteVersion).toBe('v2');
  });
});
