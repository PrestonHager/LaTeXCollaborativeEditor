import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { loadProject, projectFromZip, projectToZip, starterProject, STARTER_TEX } from './projectIo';
import { BlobStore } from './blobStore';
import { ProjectDoc } from './projectDoc';
import { createZip, readZip } from './zip';
import { MemoryProvider } from '../test/memoryProvider';

const enc = (text: string) => new TextEncoder().encode(text);

describe('project import and export', () => {
  it('makes a starter project with one main.tex', () => {
    expect(starterProject('X')).toEqual({ name: 'X', mainPath: 'main.tex', files: [{ path: 'main.tex', kind: 'text', text: STARTER_TEX }] });
  });

  it('loads a stored project, keeping binary bytes in the blob store', async () => {
    const provider = new MemoryProvider();
    const { id } = await provider.createProject('Stored');
    await provider.writeFile(id, 'paper.tex', '\\documentclass{article}');
    await provider.writeFile(id, 'img/x.png', new Uint8Array([7]));
    await provider.createFolder(id, 'empty');
    await provider.setMainFile(id, 'paper.tex');
    const blobs = new BlobStore();

    const content = await loadProject(provider, id, blobs);
    expect(content.name).toBe('Stored');
    expect(content.mainPath).toBe('paper.tex');
    const image = content.files.find((file) => file.path === 'img/x.png')!;
    expect(image.kind).toBe('binary');
    expect(Array.from(blobs.peek(image.hash!)!)).toEqual([7]);
    expect(content.files.find((file) => file.path === 'empty')?.kind).toBe('folder');
  });

  it('guesses the main file when storage did not remember one', async () => {
    const provider = new MemoryProvider();
    const { id } = await provider.createProject('S');
    await provider.writeFile(id, 'ch.tex', 'chapter');
    await provider.writeFile(id, 'thesis.tex', '\\documentclass{book}');
    await provider.setMainFile(id, 'gone.tex');
    expect((await loadProject(provider, id, new BlobStore())).mainPath).toBe('thesis.tex');
  });

  it('round trips a project through a .zip', async () => {
    const project = new ProjectDoc(new Y.Doc());
    const blobs = new BlobStore();
    project.createTextFile('main.tex', '\\documentclass{article}');
    const hash = await blobs.put(new Uint8Array([1, 2, 3]));
    project.putBinaryFile('fig/a.png', hash, 3);
    project.putBinaryFile('fig/missing.png', 'not-here', 3);

    const { zip, skipped } = await projectToZip(project, blobs);
    expect(skipped).toEqual(['fig/missing.png']);
    expect((await readZip(zip)).files.map((file) => file.path)).toEqual(['fig/a.png', 'main.tex']);

    const content = await projectFromZip('My Paper.zip', zip, new BlobStore());
    expect(content.name).toBe('My Paper');
    expect(content.mainPath).toBe('main.tex');
    expect(content.files.map((file) => [file.path, file.kind])).toEqual([
      ['fig/a.png', 'binary'],
      ['main.tex', 'text'],
    ]);
  });

  it('refuses an empty .zip', async () => {
    await expect(projectFromZip('x.zip', await createZip([]), new BlobStore())).rejects.toThrow(/no files/);
    const named = await projectFromZip('.zip', await createZip([{ path: 'a.tex', data: enc('a') }]), new BlobStore());
    expect(named.name).toBe('Imported project');
  });
});
