import type * as Y from 'yjs';
import type { ProjectDoc } from '../project/projectDoc';

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
}

/**
 * Wraps a project doc for completion. It only counts updates to the doc, so nothing is parsed
 * until someone asks for a completion. Call `dispose` when the doc is replaced.
 */
export function completionProjectFrom(
  doc: Y.Doc,
  project: ProjectDoc,
  activePath: () => string | null = () => null,
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
    activePath,
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
