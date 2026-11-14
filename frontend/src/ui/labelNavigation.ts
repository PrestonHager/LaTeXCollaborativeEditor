import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView, showPanel, type Panel } from '@codemirror/view';
import type { CompletionProject, TextEdit, TextLocation } from './completionProject';
import { extension } from '../project/paths';
import {
  extractBibEntries,
  extractLabels,
  extractReferences,
  isLiteralKey,
  projectIndex,
  type ProjectGetter,
  type ProjectIndex,
} from './projectCompletion';

/**
 * Go to definition, find references and rename for labels and citations (issue #247). Part of the
 * lazy completion chunk, and built on the same project index. Everything stays in the browser;
 * a rename goes through the Yjs doc like typing, so collaborators see it.
 */

/** What's under the cursor: a label key, a citation key, or a command name (without the backslash). */
export interface NavSymbol {
  kind: 'label' | 'citation' | 'command';
  key: string;
  /** Where it is in the document. */
  from: number;
  to: number;
}

/** A place a key is defined or used, with the text of its line to show in the list. */
export interface NavLocation extends TextLocation {
  role: 'definition' | 'use';
}

/** Finds the label, citation or command at `offset` in a file's text. Null in a comment or on plain text. */
export function symbolAt(text: string, offset: number, path: string): NavSymbol | null {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineEndAt = text.indexOf('\n', offset);
  const line = text.slice(lineStart, lineEndAt < 0 ? text.length : lineEndAt);
  const column = offset - lineStart;
  if (extension(path) === 'bib') {
    for (const entry of extractBibEntries(line, path)) {
      if (entry.column !== undefined && column >= entry.column && column <= entry.column + entry.key.length) {
        return { kind: 'citation', key: entry.key, from: lineStart + entry.column, to: lineStart + entry.column + entry.key.length };
      }
    }
    return null;
  }
  const covers = (start: number, key: string) => column >= start && column <= start + key.length;
  for (const ref of extractReferences(line, path)) {
    if (covers(ref.column, ref.key)) {
      return { kind: ref.kind === 'ref' ? 'label' : 'citation', key: ref.key, from: lineStart + ref.column, to: lineStart + ref.column + ref.key.length };
    }
  }
  for (const label of extractLabels(line, path)) {
    const start = label.column ?? 0;
    if (covers(start, label.key) && isLiteralKey(label.key)) {
      return { kind: 'label', key: label.key, from: lineStart + start, to: lineStart + start + label.key.length };
    }
  }
  // A command name: the backslash and letters around the cursor, outside a comment.
  const before = /\\[a-zA-Z@]*$/.exec(line.slice(0, column));
  const after = /^[a-zA-Z@]*/.exec(line.slice(column))?.[0] ?? '';
  if (before) {
    const start = column - before[0].length;
    const lead = line.slice(0, start);
    const escaped = (/\\*$/.exec(lead)?.[0].length ?? 0) % 2 === 1;
    const inComment = /(?:^|[^\\])(?:\\\\)*%/.test(lead);
    const name = before[0].slice(1) + after;
    if (name && !escaped && !inComment) return { kind: 'command', key: name, from: lineStart + start, to: lineStart + column + after.length };
  }
  return null;
}

const byPlace = (a: TextLocation, b: TextLocation) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column;

/** Where a key is defined: the `\label`s for a label, the `.bib` entries and `\bibitem`s for a citation, the definitions for a command. */
export function definitionsOf(index: ProjectIndex, symbol: Pick<NavSymbol, 'kind' | 'key'>): NavLocation[] {
  const { key } = symbol;
  const out: NavLocation[] = [];
  if (symbol.kind === 'label') {
    for (const label of index.labels()) {
      if (label.key === key) out.push({ role: 'definition', path: label.path, line: label.line, column: label.column ?? 0, length: key.length });
    }
  } else if (symbol.kind === 'citation') {
    for (const entry of index.bibEntries()) {
      if (entry.key === key) out.push({ role: 'definition', path: entry.path, line: entry.line ?? 1, column: entry.column ?? 0, length: key.length });
    }
    for (const ref of index.references()) {
      if (ref.kind === 'bibitem' && ref.key === key) out.push({ role: 'definition', path: ref.path, line: ref.line, column: ref.column, length: key.length });
    }
  } else {
    for (const def of index.definitions()) {
      if (def.kind === 'command' && def.name === key) {
        out.push({ role: 'definition', path: def.path, line: def.line, column: def.column ?? 0, length: key.length + 1 });
      }
    }
  }
  return out;
}

/** Every place a label or citation key is defined or used across the project, in file and line order. */
export function referencesOf(index: ProjectIndex, symbol: Pick<NavSymbol, 'kind' | 'key'>): NavLocation[] {
  const uses: NavLocation[] = [];
  const wanted = symbol.kind === 'label' ? 'ref' : symbol.kind === 'citation' ? 'cite' : null;
  for (const ref of index.references()) {
    if (ref.kind === wanted && ref.key === symbol.key) {
      uses.push({ role: 'use', path: ref.path, line: ref.line, column: ref.column, length: ref.key.length });
    }
  }
  return [...definitionsOf(index, symbol), ...uses].sort(byPlace);
}

/** Why a new label name can't be used, or null when it's fine. */
export function invalidLabel(name: string, index: ProjectIndex, current: string): string | null {
  if (!name.trim()) return 'A label needs a name.';
  if (name !== name.trim() || /[\s,{}\\#%~^$]/.test(name)) return 'A label can\'t have spaces, commas, braces, or \\ # % ~ ^ $ in it.';
  if (name !== current && index.labels().some((label) => label.key === name)) return `There's already a label “${name}”.`;
  return null;
}

/** The edits that rename a label everywhere: each `\label` and every reference to it. */
export function renameEdits(index: ProjectIndex, key: string, name: string): TextEdit[] {
  return referencesOf(index, { kind: 'label', key }).map(({ path, line, column, length }) => ({ path, line, column, length, insert: name, expect: key }));
}

/** Selects a location in the open file and scrolls to it. */
function select(view: EditorView, location: TextLocation) {
  const doc = view.state.doc;
  const line = doc.line(Math.min(Math.max(location.line, 1), doc.lines));
  const from = Math.min(line.from + location.column, line.to);
  const to = Math.min(from + location.length, line.to);
  view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
  view.focus();
}

/** Opens a location: in the open file, or the app opens its file first. */
export function reveal(view: EditorView, project: CompletionProject, location: TextLocation) {
  if (project.activePath?.() !== location.path) project.open?.(location);
  if (project.activePath?.() === location.path) select(view, location);
}

function describe(symbol: Pick<NavSymbol, 'kind' | 'key'>): string {
  if (symbol.kind === 'label') return `label “${symbol.key}”`;
  if (symbol.kind === 'citation') return `citation “${symbol.key}”`;
  return `\\${symbol.key}`;
}

/** The symbol at `pos` in the open file, with the project and its index, or null with a message. */
function context(view: EditorView, getProject: ProjectGetter, pos: number) {
  const project = getProject();
  const path = project?.activePath?.();
  if (!project || !path) return null;
  const symbol = symbolAt(view.state.doc.toString(), pos, path);
  return { project, path, symbol, index: projectIndex(project) };
}

const NOTHING_HERE = 'Put the cursor on a label, a \\ref or \\cite key, or a command first.';

/** Jumps to where the label, citation or command at `pos` is defined. True when there was something to look up. */
export function goToDefinition(view: EditorView, getProject: ProjectGetter, pos = view.state.selection.main.head): boolean {
  const found = context(view, getProject, pos);
  if (!found) return false;
  const { project, symbol, index } = found;
  if (!symbol) {
    project.notify?.(NOTHING_HERE);
    return false;
  }
  const targets = definitionsOf(index, symbol);
  if (!targets.length) {
    project.notify?.(symbol.kind === 'command'
      ? `\\${symbol.key} isn't defined in the project. It may come from LaTeX or a package.`
      : `No definition of the ${describe(symbol)} in the project.`);
    return true;
  }
  // On a definition already, go to the next one (a duplicate label), else the first.
  const here = targets.findIndex((t) => t.path === found.path && view.state.doc.line(Math.min(t.line, view.state.doc.lines)).from + t.column === symbol.from);
  reveal(view, project, targets[(here + 1) % targets.length]);
  return true;
}

// The references panel under the editor.

interface ReferenceList {
  title: string;
  items: { location: NavLocation; preview: string }[];
}

const setReferences = StateEffect.define<ReferenceList | null>();

/** Builds the panel's DOM. Each row opens its place; Escape or Close shuts it. */
function referencesPanel(list: ReferenceList, getProject: ProjectGetter) {
  return (view: EditorView): Panel => {
    const dom = document.createElement('div');
    dom.className = 'cm-references';
    dom.setAttribute('role', 'region');
    dom.setAttribute('aria-label', list.title);
    const header = document.createElement('div');
    header.className = 'cm-references-header';
    const title = document.createElement('span');
    title.textContent = list.title;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'cm-references-close';
    close.textContent = 'Close';
    close.addEventListener('click', () => {
      view.dispatch({ effects: setReferences.of(null) });
      view.focus();
    });
    header.append(title, close);
    const ul = document.createElement('ul');
    for (const { location, preview } of list.items) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cm-references-item';
      const place = document.createElement('span');
      place.className = 'cm-references-place';
      place.textContent = `${location.path}:${location.line}`;
      const text = document.createElement('span');
      text.className = 'cm-references-text';
      text.textContent = preview;
      button.append(place, text);
      if (location.role === 'definition') button.dataset.definition = 'true';
      button.addEventListener('click', () => {
        const project = getProject();
        if (project) reveal(view, project, location);
      });
      li.append(button);
      ul.append(li);
    }
    dom.append(header, ul);
    dom.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      view.dispatch({ effects: setReferences.of(null) });
      view.focus();
    });
    return { dom, top: false };
  };
}

function referencesField(getProject: ProjectGetter) {
  return StateField.define<ReferenceList | null>({
    create: () => null,
    update(value, tr) {
      for (const effect of tr.effects) if (effect.is(setReferences)) return effect.value;
      return value;
    },
    provide: (field) => showPanel.from(field, (list) => (list ? referencesPanel(list, getProject) : null)),
  });
}

/** Lists every place the label or citation at `pos` is defined or used, in a panel under the editor. */
export function findReferences(view: EditorView, getProject: ProjectGetter, pos = view.state.selection.main.head): boolean {
  const found = context(view, getProject, pos);
  if (!found) return false;
  const { project, symbol, index } = found;
  if (!symbol || symbol.kind === 'command') {
    project.notify?.(symbol ? 'Find references works on labels and citations.' : NOTHING_HERE);
    return false;
  }
  const locations = referencesOf(index, symbol);
  const texts = new Map(project.files().filter((f) => f.kind === 'text').map((f) => [f.path, f]));
  const lines = new Map<string, string[]>();
  const items = locations.map((location) => {
    let fileLines = lines.get(location.path);
    if (!fileLines) {
      fileLines = texts.get(location.path)?.text().split('\n') ?? [];
      lines.set(location.path, fileLines);
    }
    return { location, preview: (fileLines[location.line - 1] ?? '').trim() };
  });
  const uses = locations.filter((l) => l.role === 'use').length;
  const title = `${describe(symbol)[0].toUpperCase()}${describe(symbol).slice(1)}: ${locations.length - uses} definition${locations.length - uses === 1 ? '' : 's'}, ${uses} use${uses === 1 ? '' : 's'}`;
  view.dispatch({ effects: setReferences.of({ title, items }) });
  view.dom.querySelector<HTMLButtonElement>('.cm-references-item')?.focus();
  return true;
}

/**
 * Renames the label at `pos` and every reference to it, in every file, after asking for the new
 * name. The whole rename is one step in the app's undo history. True when it renamed.
 */
export async function renameLabel(
  view: EditorView,
  getProject: ProjectGetter,
  ask: (current: string, check: (name: string) => string | null) => Promise<string | null>,
  pos = view.state.selection.main.head,
): Promise<boolean> {
  const found = context(view, getProject, pos);
  if (!found) return false;
  const { project, symbol, index } = found;
  if (!symbol || symbol.kind !== 'label') {
    project.notify?.('Put the cursor on a \\label or a \\ref key to rename it.');
    return false;
  }
  const name = await ask(symbol.key, (value) => invalidLabel(value, index, symbol.key));
  if (name === null || name === symbol.key) return false;
  const problem = invalidLabel(name, index, symbol.key);
  if (problem) {
    project.notify?.(problem);
    return false;
  }
  const edits = renameEdits(index, symbol.key, name);
  if (!edits.length) {
    project.notify?.(`No \\label{${symbol.key}} or reference to it in the project.`);
    return false;
  }
  const files = new Set(edits.map((edit) => edit.path)).size;
  project.applyEdits?.(
    edits,
    `Rename label ${symbol.key}`,
    `Renamed “${symbol.key}” to “${name}”: ${edits.length} place${edits.length === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}.`,
  );
  return true;
}

const panelTheme = EditorView.baseTheme({
  '.cm-references': { maxHeight: '12rem', overflowY: 'auto', fontSize: '0.8125rem', fontFamily: 'system-ui, sans-serif' },
  '.cm-references-header': {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem',
    padding: '0.25rem 0.5rem', fontWeight: '600', position: 'sticky', top: '0', background: 'inherit',
  },
  '.cm-references ul': { listStyle: 'none', margin: '0', padding: '0' },
  '.cm-references-item, .cm-references-close': { font: 'inherit', color: 'inherit', background: 'none', border: 'none', cursor: 'pointer' },
  '.cm-references-item': { display: 'flex', gap: '0.75rem', width: '100%', textAlign: 'left', padding: '0.25rem 0.5rem', minHeight: '1.75rem' },
  '.cm-references-item:hover, .cm-references-item:focus-visible': { background: 'rgba(127, 127, 127, 0.15)' },
  '.cm-references-item[data-definition] .cm-references-place': { fontWeight: '600' },
  '.cm-references-place': { flex: 'none', opacity: '0.8' },
  '.cm-references-text': { fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  '.cm-references-close': { textDecoration: 'underline', padding: '0.25rem' },
});

/** True when the platform's go-to-definition click modifier is down: Cmd on a Mac, Ctrl elsewhere. */
function modClick(event: MouseEvent): boolean {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return mac ? event.metaKey : event.ctrlKey;
}

/** The references panel, and Ctrl+click (Cmd+click on a Mac) on a key or command to go to its definition. */
export function labelNavigationExtension(getProject: ProjectGetter): Extension {
  return [
    referencesField(getProject),
    panelTheme,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button !== 0 || !modClick(event)) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        const project = getProject();
        const path = project?.activePath?.();
        if (pos === null || !project || !path || !symbolAt(view.state.doc.toString(), pos, path)) return false;
        event.preventDefault();
        goToDefinition(view, getProject, pos);
        return true;
      },
    }),
  ];
}
