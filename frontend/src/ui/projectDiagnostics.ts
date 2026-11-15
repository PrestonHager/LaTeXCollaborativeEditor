import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { EditorDiagnostic } from './diagnostics';
import { setProjectDiagnostics } from './diagnostics';
import { projectIndex, type ProjectGetter, type ProjectIndex } from './projectCompletion';

/**
 * Project-wide checks (issue #246): a `\ref` to a label no file defines, a `\label` defined more
 * than once, and a `\cite` key that isn't in any .bib file. Part of the lazy completion chunk, and
 * built on the same index, so nothing is parsed until the editor has loaded completion.
 * Everything stays in the browser.
 */

export type PathDiagnostic = EditorDiagnostic & { path: string };

function where(entry: { path: string; line: number }) {
  return `${entry.path}:${entry.line}`;
}

/** Every reference, label and citation problem in the project, for each file. */
export function projectDiagnostics(index: ProjectIndex): PathDiagnostic[] {
  const out: PathDiagnostic[] = [];
  const labels = new Map<string, { path: string; line: number; column?: number }[]>();
  for (const label of index.labels()) {
    // A label built from a macro, like \label{#1} in a \newcommand, isn't one label.
    if (/[\\#]/.test(label.key)) continue;
    const list = labels.get(label.key);
    if (list) list.push(label);
    else labels.set(label.key, [label]);
  }
  for (const [key, list] of labels) {
    if (list.length < 2) continue;
    for (const label of list) {
      const others = list.filter((other) => other !== label).map(where);
      out.push({
        path: label.path,
        line: label.line,
        column: label.column,
        length: key.length,
        severity: 'warning',
        message: `Label “${key}” is defined ${list.length} times. Also at ${others.join(', ')}.`,
      });
    }
  }
  const references = index.references();
  const citeKeys = new Set(index.bibEntries().map((entry) => entry.key));
  for (const ref of references) if (ref.kind === 'bibitem') citeKeys.add(ref.key);
  const bibFiles = index.bibFiles();
  for (const ref of references) {
    if (ref.kind === 'ref' && !labels.has(ref.key)) {
      out.push({
        path: ref.path,
        line: ref.line,
        column: ref.column,
        length: ref.key.length,
        severity: 'warning',
        message: `Undefined reference: no file in the project has \\label{${ref.key}}.`,
      });
    } else if (ref.kind === 'cite' && !citeKeys.has(ref.key)) {
      out.push({
        path: ref.path,
        line: ref.line,
        column: ref.column,
        length: ref.key.length,
        severity: 'warning',
        subject: `cite:${ref.key}`,
        message: bibFiles
          ? `Missing citation: “${ref.key}” isn't in any .bib file in the project.`
          : `Missing citation: “${ref.key}”. The project has no .bib file.`,
      });
    }
  }
  return out;
}

/** The diagnostics for one file, without its path. */
export function diagnosticsFor(all: readonly PathDiagnostic[], path: string): EditorDiagnostic[] {
  return all.filter((diagnostic) => diagnostic.path === path).map(({ path: _path, ...rest }) => rest);
}

/** How long typing has to pause before the project is checked again. */
export const PROJECT_DIAGNOSTICS_DELAY = 400;

/**
 * Keeps the open file's project diagnostics up to date. It checks again a moment after the open
 * file changes or the project does (a peer's edit in another file included), and clears them while
 * there's no project or open file.
 */
export function projectDiagnosticsExtension(getProject: ProjectGetter, delay = PROJECT_DIAGNOSTICS_DELAY): Extension {
  return ViewPlugin.fromClass(class {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private stopListening: (() => void) | null = null;
    private listeningTo: object | null = null;
    private lastKey = '';
    private last: EditorDiagnostic[] = [];

    private readonly view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      this.schedule(0);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.schedule(delay);
    }

    /** Listens to the project it'll read, and moves to a new one when the doc is replaced. */
    private listen() {
      const project = getProject();
      if (project === this.listeningTo) return;
      this.stopListening?.();
      this.stopListening = null;
      this.listeningTo = project;
      if (project?.onChange) this.stopListening = project.onChange(() => this.schedule(delay));
    }

    private schedule(wait: number) {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.run();
      }, wait);
    }

    run() {
      this.listen();
      const project = getProject();
      const path = project?.activePath?.() ?? null;
      let diagnostics: EditorDiagnostic[] = [];
      let key = '';
      if (project && path) {
        diagnostics = diagnosticsFor(projectDiagnostics(projectIndex(project)), path);
        key = JSON.stringify([path, diagnostics]);
      }
      // Only dispatch when something changed, so the lint gutter isn't redrawn for nothing.
      if (key === this.lastKey && diagnostics.length === this.last.length) return;
      this.lastKey = key;
      this.last = diagnostics;
      setProjectDiagnostics(this.view, diagnostics);
    }

    destroy() {
      if (this.timer !== null) clearTimeout(this.timer);
      this.stopListening?.();
    }
  });
}
