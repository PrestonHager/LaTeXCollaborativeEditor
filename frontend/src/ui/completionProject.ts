import type * as Y from 'yjs';
import { PROJECT_ORIGIN, type ProjectDoc } from '../project/projectDoc';

/**
 * What completion reads from the project (issue #193): its files and the main file, and a version
 * that goes up whenever the project changes. This stays small, since the app loads it up front;
 * the index that parses labels and .bib files is in the lazy completion chunk (projectCompletion.ts).
 */
export interface CompletionFile {
  path: string;
  kind: 'text' | 'binary' | 'folder';
  /** Reads the text now. Only called for the files completion parses (.tex and .bib). */
  text(): string;
}

export interface CompletionProject {
  /** Goes up on every change to the project doc, local or from a peer. */
  version(): number;
  files(): readonly CompletionFile[];
  /** The main file's path. Paths in \input and the like are relative to its folder. */
  mainPath(): string | null;
  /** The path of the file open in the editor, which project diagnostics are shown for (issue #246). */
  activePath?(): string | null;
  /** Calls `listener` after each change to the project. Returns a function that stops it. */
  onChange?(listener: () => void): () => void;
  /** Opens a file in the editor and selects a range in it, for go to definition (issue #247). */
  open?(location: TextLocation): void;
  /**
   * Makes the edits to the project's files in one Yjs transaction, so peers see them, as one step
   * the app can undo, named `label`. `done` is what to tell the user after.
   */
  applyEdits?(edits: readonly TextEdit[], label: string, done: string): void;
  /** Tells the user something, like that there's no definition to go to. */
  notify?(message: string): void;
}

/** A place in a file. Lines count from 1 and columns from 0. */
export interface TextLocation {
  path: string;
  line: number;
  column: number;
  length: number;
}

/** Puts `insert` in place of a location's text. */
export interface TextEdit extends TextLocation {
  insert: string;
  /** The text the edit replaces. If the file has something else there now, the edit is skipped. */
  expect?: string;
}

/** What the app gives a project for navigation and rename. All optional, for tests and guests. */
export interface CompletionHost {
  activePath?: () => string | null;
  open?: (location: TextLocation) => void;
  /** Runs `op` as one undoable step named `label`, then says `done`. */
  record?: (op: () => void, label: string, done: string) => void;
  notify?: (message: string) => void;
}

/** The offset of a line and column in `text`, or -1 when the line isn't there. */
export function offsetOf(text: string, line: number, column: number): number {
  let start = 0;
  for (let i = 1; i < line; i++) {
    start = text.indexOf('\n', start) + 1;
    if (start === 0) return -1;
  }
  return start + column;
}

/**
 * Wraps a project doc for completion. It only counts updates to the doc, so nothing is parsed
 * until someone asks for a completion. Call `dispose` when the doc is replaced.
 */
export function completionProjectFrom(
  doc: Y.Doc,
  project: ProjectDoc,
  host: CompletionHost = {},
): CompletionProject & { dispose(): void } {
  let version = 0;
  const listeners = new Set<() => void>();
  const bump = () => {
    version += 1;
    listeners.forEach((listener) => listener());
  };
  doc.on('update', bump);
  return {
    version: () => version,
    files: () => project.entries().map((entry) => ({ path: entry.path, kind: entry.kind, text: () => project.getText(entry.id).toString() })),
    mainPath: () => {
      const id = project.getMainFileId();
      return id ? (project.get(id)?.path ?? null) : null;
    },
    activePath: () => host.activePath?.() ?? null,
    open: host.open,
    notify: host.notify,
    applyEdits: (edits, label, done) => {
      const byPath = new Map<string, TextEdit[]>();
      for (const edit of edits) byPath.set(edit.path, [...(byPath.get(edit.path) ?? []), edit]);
      const op = () => doc.transact(() => {
        for (const [path, list] of byPath) {
          const entry = project.entries().find((e) => e.path === path && e.kind === 'text');
          if (!entry) continue;
          const text = project.getText(entry.id);
          const source = text.toString();
          // From the end back, so earlier offsets stay right. An edit whose text moved on is skipped.
          const placed = list
            .map((edit) => ({ edit, at: offsetOf(source, edit.line, edit.column) }))
            .filter(({ edit, at }) => at >= 0 && (edit.expect === undefined || source.slice(at, at + edit.length) === edit.expect))
            .sort((a, b) => b.at - a.at);
          for (const { edit, at } of placed) {
            text.delete(at, edit.length);
            text.insert(at, edit.insert);
          }
        }
      }, PROJECT_ORIGIN);
      if (host.record) host.record(op, label, done);
      else op();
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose: () => {
      doc.off('update', bump);
      listeners.clear();
    },
  };
}
