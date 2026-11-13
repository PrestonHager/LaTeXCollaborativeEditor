import * as Y from 'yjs';
import { ProjectDoc } from './projectDoc';
import { createFileHistory } from './fileHistory';
import { restoredPath } from './paths';

/** A blob store stand-in that only counts pins. */
function pins() {
  const counts = new Map<string, number>();
  const forgotten: string[] = [];
  return {
    counts,
    forgotten,
    retain: (hash: string) => counts.set(hash, (counts.get(hash) ?? 0) + 1),
    release: (hash: string) => {
      const next = (counts.get(hash) ?? 0) - 1;
      if (next > 0) counts.set(hash, next);
      else counts.delete(hash);
    },
    forget: (hash: string) => forgotten.push(hash),
  };
}

function setup(limit?: number) {
  const project = new ProjectDoc(new Y.Doc());
  const blobs = pins();
  const history = createFileHistory(project, { blobs, limit });
  return { project, blobs, history };
}

/** Two peers whose docs pass updates straight to each other, each with a file history. */
function pair() {
  const a = new ProjectDoc(new Y.Doc());
  const b = new ProjectDoc(new Y.Doc());
  a.doc.on('update', (update: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(b.doc, update, 'remote'));
  b.doc.on('update', (update: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(a.doc, update, 'remote'));
  return { a, b, historyA: createFileHistory(a, { blobs: pins() }), historyB: createFileHistory(b, { blobs: pins() }) };
}

const paths = (project: ProjectDoc) => project.entries().map((entry) => entry.path);

describe('restoredPath', () => {
  it('adds " (restored)" before the extension, and a number when that is taken too', () => {
    expect(restoredPath('ch/a.tex', () => false)).toBe('ch/a (restored).tex');
    expect(restoredPath('a.tex', (path) => path === 'a (restored).tex')).toBe('a (restored 2).tex');
    expect(restoredPath('v1.2', () => false, true)).toBe('v1.2 (restored)');
  });
});

describe('createFileHistory', () => {
  it('undoes and redoes deleting a text file, text and all', () => {
    const { project, history } = setup();
    const id = project.createTextFile('chapter.tex', 'Hello');
    history.record('Delete chapter.tex', () => project.removePath('chapter.tex'));
    expect(project.get(id)).toBeUndefined();
    expect(history.undoLabel()).toBe('Delete chapter.tex');
    expect(history.undo()).toEqual({ label: 'Delete chapter.tex', renamed: [] });
    expect(project.get(id)?.path).toBe('chapter.tex');
    expect(project.getText(id).toString()).toBe('Hello');
    expect(history.canUndo()).toBe(false);
    expect(history.redoLabel()).toBe('Delete chapter.tex');
    history.redo();
    expect(project.get(id)).toBeUndefined();
    history.undo();
    expect(project.getText(id).toString()).toBe('Hello');
  });

  it('undoes and redoes create, rename and move, one step each', () => {
    const { project, history } = setup();
    history.record('New Folder figs', () => project.createFolder('figs'));
    const id = history.record('New File a.tex', () => project.createTextFile('a.tex', 'x'));
    history.record('Rename a.tex', () => project.movePath('a.tex', 'b.tex'));
    history.record('Move b.tex', () => project.movePath('b.tex', 'figs/b.tex'));
    expect(paths(project)).toEqual(['figs', 'figs/b.tex']);
    history.undo();
    expect(paths(project)).toEqual(['b.tex', 'figs']);
    history.undo();
    expect(paths(project)).toEqual(['a.tex', 'figs']);
    history.undo();
    expect(paths(project)).toEqual(['figs']);
    history.undo();
    expect(paths(project)).toEqual([]);
    expect(history.undo()).toBeNull();
    history.redo();
    history.redo();
    expect(project.getText(id).toString()).toBe('x');
    history.redo();
    history.redo();
    expect(paths(project)).toEqual(['figs', 'figs/b.tex']);
    expect(history.redo()).toBeNull();
  });

  it('moves a whole folder back in one step', () => {
    const { project, history } = setup();
    project.createTextFile('ch/a.tex', 'a');
    project.createTextFile('ch/b.tex', 'b');
    history.record('Rename ch', () => project.movePath('ch', 'parts'));
    expect(paths(project)).toEqual(['parts/a.tex', 'parts/b.tex']);
    history.undo();
    expect(paths(project)).toEqual(['ch/a.tex', 'ch/b.tex']);
  });

  it('only tracks ops made through record or batch', () => {
    const { project, history } = setup();
    project.createTextFile('a.tex');
    project.replaceAll({ name: 'P', files: [{ path: 'b.tex', kind: 'text' }] });
    expect(history.canUndo()).toBe(false);
  });

  it('makes a batch one step, under one label', async () => {
    const { project, history } = setup();
    await history.batch('Upload 2 files', async () => {
      project.createTextFile('a.tex');
      await Promise.resolve();
      history.record('ignored', () => project.putBinaryFile('b.png', 'h1', 3));
    });
    expect(history.undoLabel()).toBe('Upload 2 files');
    history.undo();
    expect(paths(project)).toEqual([]);
    expect(history.canUndo()).toBe(false);
  });

  it('undoes replacing a text file by upload', () => {
    const { project, history } = setup();
    const id = project.createTextFile('a.tex', 'old');
    history.record('Upload a.tex', () => project.replaceText(id, 'new'));
    history.undo();
    expect(project.getText(id).toString()).toBe('old');
  });

  it('keeps the bytes of deleted binary files while a step needs them, and lets go after', () => {
    const { project, blobs, history } = setup(1);
    history.record('Upload a.png', () => project.putBinaryFile('a.png', 'h1', 3));
    expect(blobs.counts.get('h1')).toBe(1);
    history.record('Delete a.png', () => project.removePath('a.png'));
    // The upload fell off the 1-step stack, but the delete still needs h1.
    expect(blobs.counts.get('h1')).toBe(1);
    history.undo();
    expect(project.findByPath('a.png')?.hash).toBe('h1');
    expect(blobs.counts.get('h1')).toBe(1);
    history.redo();
    expect(project.findByPath('a.png')).toBeUndefined();
    // Now the delete falls off, and nothing uses h1, so its bytes can go.
    history.record('New File b.tex', () => project.createTextFile('b.tex'));
    expect(blobs.counts.has('h1')).toBe(false);
    expect(blobs.forgotten).toEqual(['h1']);
  });

  it('keeps bytes a file still uses when its step goes, and lets go of everything on destroy', () => {
    const { project, blobs, history } = setup();
    history.record('Upload a.png', () => project.putBinaryFile('a.png', 'h1', 3));
    history.record('Delete b', () => project.createFolder('b'));
    history.clear();
    expect(blobs.counts.size).toBe(0);
    expect(blobs.forgotten).toEqual([]);
    history.record('Delete a.png', () => project.removePath('a.png'));
    history.destroy();
    expect(blobs.counts.size).toBe(0);
    expect(blobs.forgotten).toEqual(['h1']);
  });

  it('caps the stack', () => {
    const { project, history } = setup(2);
    for (const name of ['a', 'b', 'c']) history.record(`New Folder ${name}`, () => project.createFolder(name));
    history.undo();
    history.undo();
    expect(history.canUndo()).toBe(false);
    expect(paths(project)).toEqual(['a']);
  });

  it('drops the history when a new project replaces this one, here or on a peer', () => {
    const { a, b, historyA, historyB } = pair();
    historyA.record('New Folder x', () => a.createFolder('x'));
    historyB.record('New Folder y', () => b.createFolder('y'));
    a.replaceAll({ name: 'Next', files: [{ path: 'main.tex', kind: 'text' }] });
    expect(historyA.canUndo()).toBe(false);
    expect(historyB.canUndo()).toBe(false);
  });

  it('notifies listeners and tells the newest step apart', () => {
    const { project, history } = setup();
    const listener = vi.fn();
    const stop = history.subscribe(listener);
    history.record('New Folder a', () => project.createFolder('a'));
    const first = history.latest();
    history.record('New Folder b', () => project.createFolder('b'));
    expect(history.latest()).not.toBe(first);
    expect(listener).toHaveBeenCalled();
    stop();
  });

  describe('with a peer', () => {
    it("never undoes a peer's ops", () => {
      const { a, b, historyA, historyB } = pair();
      historyA.record('New Folder mine', () => a.createFolder('mine'));
      historyB.record('New Folder theirs', () => b.createFolder('theirs'));
      historyA.undo();
      expect(paths(a)).toEqual(['theirs']);
      expect(paths(b)).toEqual(['theirs']);
      expect(historyA.canUndo()).toBe(false);
      expect(historyB.undoLabel()).toBe('New Folder theirs');
    });

    it("keeps a peer's text edits when a rename is undone", () => {
      const { a, b, historyA } = pair();
      const id = a.createTextFile('a.tex', 'one');
      historyA.record('Rename a.tex', () => a.movePath('a.tex', 'b.tex'));
      b.getText(id).insert(3, ' two');
      historyA.undo();
      expect(b.get(id)?.path).toBe('a.tex');
      expect(b.getText(id).toString()).toBe('one two');
    });

    it('leaves a file where a peer moved it after our rename', () => {
      const { a, b, historyA } = pair();
      a.createTextFile('a.tex');
      historyA.record('Rename a.tex', () => a.movePath('a.tex', 'b.tex'));
      b.movePath('b.tex', 'c.tex');
      expect(historyA.undo()).toBeNull();
      expect(paths(a)).toEqual(['c.tex']);
    });

    it("restores a deleted file next to the one a peer made at its path, not over it", () => {
      const { a, b, historyA } = pair();
      const mine = a.createTextFile('a.tex', 'mine');
      historyA.record('Delete a.tex', () => a.removePath('a.tex'));
      const theirs = b.createTextFile('a.tex', 'theirs');
      expect(historyA.undo()).toEqual({ label: 'Delete a.tex', renamed: [{ from: 'a.tex', to: 'a (restored).tex' }] });
      expect(b.get(theirs)?.path).toBe('a.tex');
      expect(b.getText(theirs).toString()).toBe('theirs');
      expect(b.get(mine)?.path).toBe('a (restored).tex');
      expect(b.getText(mine).toString()).toBe('mine');
      // Redo deletes ours again, rename and all, and leaves theirs.
      historyA.redo();
      expect(paths(b)).toEqual(['a.tex']);
      historyA.undo();
      expect(paths(b)).toEqual(['a (restored).tex', 'a.tex']);
    });

    it("merges a restored folder with one a peer made again, and renames only clashing files", () => {
      const { a, b, historyA } = pair();
      a.createFolder('ch');
      a.createTextFile('ch/x.tex', 'mine');
      a.createTextFile('ch/y.tex', 'y');
      historyA.record('Delete ch', () => a.removePath('ch'));
      b.createFolder('ch');
      b.createTextFile('ch/x.tex', 'theirs');
      const step = historyA.undo();
      expect(step?.renamed).toEqual([{ from: 'ch/x.tex', to: 'ch/x (restored).tex' }]);
      expect(paths(b)).toEqual(['ch', 'ch/x (restored).tex', 'ch/x.tex', 'ch/y.tex']);
      expect(b.getText(b.findByPath('ch/x.tex')!.id).toString()).toBe('theirs');
    });

    it('renames a restored folder that clashes with a file, and moves its contents with it', () => {
      const { a, b, historyA } = pair();
      a.createFolder('ch');
      a.createTextFile('ch/x.tex');
      historyA.record('Delete ch', () => a.removePath('ch'));
      b.putBinaryFile('ch', 'h', 1);
      historyA.undo();
      expect(paths(b)).toEqual(['ch', 'ch (restored)', 'ch (restored)/x.tex']);
    });

    it('keeps folders implied by a peer file without renaming', () => {
      const { a, b, historyA } = pair();
      a.createFolder('ch');
      historyA.record('Delete ch', () => a.removePath('ch'));
      b.createTextFile('ch/new.tex');
      expect(historyA.undo()?.renamed).toEqual([]);
      expect(paths(b)).toEqual(['ch', 'ch/new.tex']);
    });

    it("keeps a peer's edits made inside a folder while we deleted it", () => {
      const a = new ProjectDoc(new Y.Doc());
      const b = new ProjectDoc(new Y.Doc());
      const history = createFileHistory(a, { blobs: pins() });
      const id = a.createTextFile('ch/x.tex', 'base');
      Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
      // Offline at the same time: we delete the folder, they type in a file in it.
      history.record('Delete ch', () => a.removePath('ch'));
      b.getText(id).insert(4, ' + theirs');
      Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc)));
      history.undo();
      Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)));
      expect(b.get(id)?.path).toBe('ch/x.tex');
      expect(b.getText(id).toString()).toBe('base + theirs');
    });

    it("can undo deleting a file a peer made", () => {
      const { a, b, historyA } = pair();
      const id = b.createTextFile('theirs.tex', 'text');
      historyA.record('Delete theirs.tex', () => a.removePath('theirs.tex'));
      historyA.undo();
      expect(b.getText(id).toString()).toBe('text');
    });
  });
});
