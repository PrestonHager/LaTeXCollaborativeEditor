import * as Y from 'yjs';
import { LEGACY_TEXT_ID, ProjectDoc } from './projectDoc';

/** Two peers whose docs pass updates straight to each other. */
function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (update: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(b, update, 'remote'));
  b.on('update', (update: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(a, update, 'remote'));
  return { a: new ProjectDoc(a), b: new ProjectDoc(b) };
}

/** Two peers that make changes offline, then swap state. */
function offlinePair() {
  const a = new ProjectDoc(new Y.Doc());
  const b = new ProjectDoc(new Y.Doc());
  return {
    a,
    b,
    seed() {
      Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    },
    sync() {
      const fromA = Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc));
      const fromB = Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc));
      Y.applyUpdate(b.doc, fromA);
      Y.applyUpdate(a.doc, fromB);
    },
  };
}

describe('ProjectDoc', () => {
  it('creates text files, folders and binary files, and shares them with a peer', () => {
    const { a, b } = pair();
    a.setName('Thesis');
    const main = a.createTextFile('main.tex', '\\documentclass{article}');
    a.createFolder('figures');
    a.putBinaryFile('figures/plot.png', 'hash1', 10);

    expect(b.getName()).toBe('Thesis');
    expect(b.entries().map((entry) => [entry.path, entry.kind])).toEqual([
      ['figures', 'folder'],
      ['figures/plot.png', 'binary'],
      ['main.tex', 'text'],
    ]);
    expect(b.getText(main).toString()).toBe('\\documentclass{article}');
    expect(b.findByPath('figures/plot.png')).toMatchObject({ hash: 'hash1', size: 10 });
    expect(b.textFiles().get('main.tex')).toBe('\\documentclass{article}');
    expect(b.isEmpty()).toBe(false);
  });

  it('lists implicit folders from file paths', () => {
    const project = new ProjectDoc(new Y.Doc());
    project.createTextFile('a/b/c.tex');
    project.createFolder('empty');
    expect(project.folderPaths()).toEqual(['a', 'a/b', 'empty']);
  });

  it('refuses bad or taken names', () => {
    const project = new ProjectDoc(new Y.Doc());
    project.createTextFile('main.tex');
    expect(() => project.createTextFile('main.tex')).toThrow(/already exists/);
    expect(() => project.createTextFile('../x.tex')).toThrow(/not allowed/);
    expect(() => project.createFolder('main.tex')).toThrow(/already exists/);
    expect(() => project.putBinaryFile('', 'h', 1)).toThrow(/not allowed/);
  });

  it('replaces a binary file in place, but never a text file', () => {
    const project = new ProjectDoc(new Y.Doc());
    const id = project.putBinaryFile('x.png', 'h1', 1);
    expect(project.putBinaryFile('x.png', 'h2', 2)).toBe(id);
    expect(project.get(id)).toMatchObject({ hash: 'h2', size: 2 });
    project.createTextFile('x.dat');
    expect(() => project.putBinaryFile('x.dat', 'h3', 3)).toThrow(/already exists/);
  });

  it('moves a folder with everything in it, and keeps ids', () => {
    const project = new ProjectDoc(new Y.Doc());
    const intro = project.createTextFile('ch/intro.tex', 'hi');
    project.createFolder('ch/sub');
    project.movePath('ch', 'chapters');
    expect(project.get(intro)?.path).toBe('chapters/intro.tex');
    expect(project.getText(intro).toString()).toBe('hi');
    expect(project.folderPaths()).toEqual(['chapters', 'chapters/sub']);
    project.move(intro, 'intro.tex');
    expect(project.get(intro)?.path).toBe('intro.tex');
    expect(() => project.movePath('chapters', 'chapters/inner')).toThrow(/inside itself/);
    expect(() => project.move(intro, 'chapters')).toThrow(/already exists/);
    expect(() => project.movePath('nope', 'x')).toThrow(/no longer exists/);
    expect(() => project.move('missing-id', 'x')).toThrow(/no longer exists/);
    expect(() => project.move(intro, '..')).toThrow(/not allowed/);
    project.move(intro, 'intro.tex');
  });

  it('deletes a folder and clears the text of deleted files', () => {
    const project = new ProjectDoc(new Y.Doc());
    const inner = project.createTextFile('ch/a.tex', 'text');
    project.createTextFile('keep.tex');
    project.removePath('ch');
    expect(project.entries().map((entry) => entry.path)).toEqual(['keep.tex']);
    expect(project.getText(inner).toString()).toBe('');
  });

  it('picks the main file, or guesses it from \\documentclass', () => {
    const project = new ProjectDoc(new Y.Doc());
    expect(project.getMainFileId()).toBeNull();
    const chapter = project.createTextFile('chapter.tex', 'Some text');
    const main = project.createTextFile('paper.tex', '\\documentclass{article}');
    expect(project.getMainFileId()).toBe(main);
    project.setMainFile(chapter);
    expect(project.getMainFileId()).toBe(chapter);
    // A main file that was deleted falls back to the guess.
    project.removePath('chapter.tex');
    expect(project.getMainFileId()).toBe(main);
  });

  it('replaces the whole project in one change', () => {
    const project = new ProjectDoc(new Y.Doc());
    const old = project.createTextFile('old.tex', 'old');
    project.replaceAll({
      name: 'New',
      mainPath: 'b.tex',
      files: [
        { path: 'a.tex', kind: 'text', text: '\\documentclass{article}' },
        { path: 'b.tex', kind: 'text', text: 'b' },
        { path: 'b.tex', kind: 'text', text: 'duplicate' },
        { path: '../bad', kind: 'text' },
        { path: 'img/x.png', kind: 'binary', hash: 'h', size: 3 },
        { path: 'empty', kind: 'folder' },
      ],
    });
    expect(project.getName()).toBe('New');
    expect(project.entries().map((entry) => entry.path)).toEqual(['a.tex', 'b.tex', 'empty', 'img/x.png']);
    expect(project.get(project.getMainFileId()!)?.path).toBe('b.tex');
    expect(project.getText(old).toString()).toBe('');
  });

  it('turns an old single-document doc into a one-file project', () => {
    const doc = new Y.Doc();
    doc.getText(LEGACY_TEXT_ID).insert(0, 'legacy');
    const project = new ProjectDoc(doc);
    expect(project.migrateLegacy('paper.tex', 'Paper')).toBe(true);
    expect(project.entries()).toEqual([{ id: LEGACY_TEXT_ID, path: 'paper.tex', kind: 'text' }]);
    expect(project.getText(LEGACY_TEXT_ID).toString()).toBe('legacy');
    expect(project.getMainFileId()).toBe(LEGACY_TEXT_ID);
    expect(project.getName()).toBe('Paper');
    // Only once, and only on an empty project.
    expect(project.migrateLegacy('again.tex', 'X')).toBe(false);
    const other = new ProjectDoc(new Y.Doc());
    other.migrateLegacy('../bad', '');
    expect(other.entries()[0].path).toBe('main.tex');
  });

  it('settles two peers making the same path at once on the same names', () => {
    const peers = offlinePair();
    peers.a.createTextFile('notes.tex', 'from a');
    peers.b.createTextFile('notes.tex', 'from b');
    peers.sync();
    const pathsA = peers.a.entries().map((entry) => entry.path);
    expect(pathsA).toEqual(['notes (2).tex', 'notes.tex']);
    expect(peers.b.entries().map((entry) => entry.path)).toEqual(pathsA);
  });

  it('keeps a file renamed on one peer while another deletes it, so no work is lost', () => {
    const peers = offlinePair();
    const id = peers.a.createTextFile('draft.tex', 'keep me');
    peers.seed();
    peers.a.move(id, 'final.tex');
    peers.b.removePath('draft.tex');
    peers.sync();
    expect(peers.a.entries().map((entry) => entry.path)).toEqual(['final.tex']);
    expect(peers.b.entries().map((entry) => entry.path)).toEqual(['final.tex']);
  });

  it('settles two renames of the same file on one name', () => {
    const peers = offlinePair();
    const id = peers.a.createTextFile('draft.tex');
    peers.seed();
    peers.a.move(id, 'a.tex');
    peers.b.move(id, 'b.tex');
    peers.sync();
    expect(peers.a.get(id)?.path).toBe(peers.b.get(id)?.path);
  });

  it('tells listeners about tree changes once they finish, until they stop listening', async () => {
    const project = new ProjectDoc(new Y.Doc());
    const listener = vi.fn();
    const stop = project.onTreeChange(listener);
    project.createTextFile('a.tex');
    project.setName('x');
    // Both changes land before the listener runs, so it runs once.
    expect(listener).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    project.createTextFile('c.tex');
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    project.createTextFile('b.tex');
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
