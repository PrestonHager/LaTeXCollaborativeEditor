import * as Y from 'yjs';
import { GENERATION_KEY, PROJECT_ORIGIN, type EntryKind, type ProjectDoc } from './projectDoc';
import { dirname, isSafePath, replacePrefix, restoredPath } from './paths';

type Stored = { path: string; kind: EntryKind; hash?: string; size?: number };

/** How many file ops the history keeps. Older ones fall off, and their deleted bytes go with them. */
export const FILE_HISTORY_LIMIT = 50;

/** What an undo or redo did, for the notice. */
export type FileHistoryStep = {
  /** The op, like "Delete chapter.tex". */
  label: string;
  /** What came back under a new name because someone else had taken its path meanwhile. */
  renamed: { from: string; to: string }[];
};

type BlobPins = { retain(hash: string): void; release(hash: string): void; forget(hash: string): void };

/**
 * Undo and redo for the file tree: create, rename, move, delete and upload (issue #55).
 *
 * It's a Yjs UndoManager on the project's `files` map, apart from the editor's per-file text undo,
 * like VS Code's explorer. It only tracks our own PROJECT_ORIGIN transactions, and only ones made
 * inside record() or batch(), so a peer's changes and background work (like conflict copies) are
 * never undone. Every text file is in scope too, so undoing a delete brings its text back.
 *
 * Deleted binary files only keep a hash in the doc, so the bytes of every binary file an undo step
 * touches are retained in the blob store while the step is on either stack, and let go after.
 */
export function createFileHistory(
  project: ProjectDoc,
  options: { blobs: BlobPins; limit?: number; inUse?: (hash: string) => boolean },
) {
  const { doc } = project;
  const files = doc.getMap<Stored>('files');
  const meta = doc.getMap<string>('meta');
  const limit = options.limit ?? FILE_HISTORY_LIMIT;
  const listeners = new Set<() => void>();
  // Blobs we asked the store to keep, and ones a step in progress touched but isn't on a stack yet.
  const held = new Set<string>();
  let pendingHashes = new Set<string>();
  let recording = 0;
  let recordLabel = '';
  // The label for the step an undo or redo pushes onto the other stack.
  let stepLabel: string | null = null;

  const manager = new Y.UndoManager([files], {
    trackedOrigins: new Set([PROJECT_ORIGIN]),
    // Every op is its own step, except inside batch().
    captureTimeout: 0,
    captureTransaction: (tr) => tr.origin !== PROJECT_ORIGIN || recording > 0,
  });

  const textsOf = (ids: string[]) => ids.filter((id) => files.get(id)?.kind === 'text').map((id) => project.getText(id));
  manager.addToScope(textsOf([...files.keys()]));

  const tracked = (tr: Y.Transaction) => tr.origin === manager || (tr.origin === PROJECT_ORIGIN && recording > 0);

  const onFiles = (event: Y.YMapEvent<Stored>, tr: Y.Transaction) => {
    const added: string[] = [];
    event.changes.keys.forEach((change, id) => {
      if (change.action === 'add') added.push(id);
      if (!tracked(tr)) return;
      const before = change.oldValue as Stored | undefined;
      const after = files.get(id);
      if (before?.hash) pendingHashes.add(before.hash);
      if (after?.hash) pendingHashes.add(after.hash);
    });
    // Texts join the scope as files appear, from anyone, so deleting a peer's file can be undone too.
    const texts = textsOf(added);
    if (texts.length) manager.addToScope(texts);
  };
  files.observe(onFiles);

  // A whole new project (open, import, or the host doing either) ends the old project's history.
  const onMeta = (event: Y.YMapEvent<string>) => {
    if (event.keysChanged.has(GENERATION_KEY)) clear();
  };
  meta.observe(onMeta);

  const hashesOf = (item: { meta: Map<unknown, unknown> }) => (item.meta.get('hashes') as Set<string> | undefined) ?? new Set<string>();

  manager.on('stack-item-added', ({ stackItem, origin }) => {
    stackItem.meta.set('label', origin === manager ? (stepLabel ?? 'File Change') : recordLabel || 'File Change');
    stackItem.meta.set('hashes', pendingHashes);
    pendingHashes = new Set();
    while (manager.undoStack.length > limit) manager.undoStack.shift();
    sync();
  });
  manager.on('stack-item-updated', ({ stackItem }) => {
    const hashes = hashesOf(stackItem);
    pendingHashes.forEach((hash) => hashes.add(hash));
    stackItem.meta.set('hashes', hashes);
    pendingHashes = new Set();
    sync();
  });
  manager.on('stack-cleared', () => sync());

  const inUse =
    options.inUse ??
    ((hash: string) => {
      for (const value of files.values()) if (value?.hash === hash) return true;
      return false;
    });

  /** Hold the bytes every step on either stack needs, and let go of the rest. */
  function sync() {
    const wanted = new Set(pendingHashes);
    for (const item of [...manager.undoStack, ...manager.redoStack]) hashesOf(item).forEach((hash) => wanted.add(hash));
    for (const hash of wanted) {
      if (held.has(hash)) continue;
      held.add(hash);
      options.blobs.retain(hash);
    }
    for (const hash of [...held]) {
      if (wanted.has(hash)) continue;
      held.delete(hash);
      options.blobs.release(hash);
      if (!inUse(hash)) options.blobs.forget(hash);
    }
    listeners.forEach((listener) => listener());
  }

  /**
   * An undo can bring something back to a path that's been taken since, like a folder a peer made
   * again. Nothing of theirs is touched: our item gets a " (restored)" name instead. A folder that
   * is there again just merges with ours.
   */
  function resolveConflicts(before: Map<string, Stored>): FileHistoryStep['renamed'] {
    const after = new Map<string, Stored>();
    files.forEach((value, id) => {
      if (value && isSafePath(value.path)) after.set(id, value);
    });
    const depth = (path: string) => path.split('/').length;
    const restored = [...after].filter(([id, value]) => before.get(id)?.path !== value.path).sort(([, a], [, b]) => depth(a.path) - depth(b.path));
    if (!restored.length) return [];
    const restoredIds = new Set(restored.map(([id]) => id));
    const otherFiles = new Set<string>();
    const otherFolders = new Set<string>();
    const explicitFolders = new Set<string>();
    for (const [id, value] of after) {
      if (restoredIds.has(id)) continue;
      if (value.kind === 'folder') explicitFolders.add(value.path);
      else otherFiles.add(value.path);
      for (let dir = value.kind === 'folder' ? value.path : dirname(value.path); dir; dir = dirname(dir)) otherFolders.add(dir);
    }
    const ours = new Set<string>();
    const taken = (path: string) => otherFiles.has(path) || otherFolders.has(path) || ours.has(path) || [...after.values()].some((value) => value.path === path);
    const moves: { from: string; to: string }[] = [];
    const renamed: FileHistoryStep['renamed'] = [];
    for (const [id, value] of restored) {
      let path = moves.reduce((current, move) => replacePrefix(current, move.from, move.to), value.path);
      const folder = value.kind === 'folder';
      if (folder && explicitFolders.has(path)) {
        // The same folder is there already, so ours would only be a duplicate.
        files.delete(id);
        continue;
      }
      if (otherFiles.has(path) || (!folder && otherFolders.has(path))) {
        const to = restoredPath(path, taken, folder);
        if (folder) moves.push({ from: path, to });
        renamed.push({ from: path, to });
        path = to;
      }
      ours.add(path);
      if (path !== value.path) files.set(id, { ...value, path });
    }
    return renamed;
  }

  function step(kind: 'undo' | 'redo'): FileHistoryStep | null {
    const stack = kind === 'undo' ? manager.undoStack : manager.redoStack;
    const top = stack[stack.length - 1];
    if (!top) return null;
    const label = (top.meta.get('label') as string | undefined) ?? 'File Change';
    const before = new Map<string, Stored>();
    files.forEach((value, id) => before.set(id, value));
    let done = false;
    let renamed: FileHistoryStep['renamed'] = [];
    stepLabel = label;
    try {
      // One transaction for the step and its renames, so both land on the other stack as one item.
      doc.transact(() => {
        done = (kind === 'undo' ? manager.undo() : manager.redo()) !== null;
        if (!done) return;
        renamed = resolveConflicts(before);
        // Yjs files a transaction on the other stack only while undoing or redoing, and its undo()
        // and redo() reset that before our outer transaction ends, so set it again until then.
        if (kind === 'undo') manager.undoing = true;
        else manager.redoing = true;
      }, manager);
    } finally {
      manager.undoing = false;
      manager.redoing = false;
      stepLabel = null;
    }
    sync();
    return done ? { label, renamed } : null;
  }

  function clear() {
    manager.clear();
    pendingHashes = new Set();
    sync();
  }

  const top = (stack: Y.UndoManager['undoStack']) => stack[stack.length - 1];

  return {
    /** Run a file op as one undo step called label, like "Delete chapter.tex". */
    record<T>(label: string, op: () => T): T {
      if (recording === 0) {
        recordLabel = label;
        manager.stopCapturing();
      }
      recording += 1;
      try {
        return op();
      } finally {
        recording -= 1;
        if (recording === 0) recordLabel = '';
        sync();
      }
    },
    /** Like record, for ops that take a while, like an upload. Everything until it settles is one step. */
    async batch<T>(label: string, op: () => Promise<T>): Promise<T> {
      const outer = recording === 0;
      if (outer) {
        recordLabel = label;
        manager.stopCapturing();
        manager.captureTimeout = Number.POSITIVE_INFINITY;
      }
      recording += 1;
      try {
        return await op();
      } finally {
        recording -= 1;
        if (outer) {
          manager.captureTimeout = 0;
          manager.stopCapturing();
          recordLabel = '';
        }
        sync();
      }
    },
    canUndo: () => manager.undoStack.length > 0,
    canRedo: () => manager.redoStack.length > 0,
    undoLabel: () => (top(manager.undoStack)?.meta.get('label') as string | undefined) ?? null,
    redoLabel: () => (top(manager.redoStack)?.meta.get('label') as string | undefined) ?? null,
    undo: () => step('undo'),
    redo: () => step('redo'),
    /** The newest step, so a notice's Undo button can check it still undoes what it says. */
    latest: (): object | null => top(manager.undoStack) ?? null,
    clear,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Stop tracking and let go of every held blob, like when the project closes. */
    destroy() {
      files.unobserve(onFiles);
      meta.unobserve(onMeta);
      manager.destroy();
      pendingHashes = new Set();
      manager.undoStack = [];
      manager.redoStack = [];
      sync();
      listeners.clear();
    },
  };
}

export type FileHistory = ReturnType<typeof createFileHistory>;
