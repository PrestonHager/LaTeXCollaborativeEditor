import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import * as Y from 'yjs';
import { ProjectDoc } from '../project/projectDoc';
import { completionProjectFrom, offsetOf, type CompletionProject, type TextLocation } from './completionProject';
import { ProjectIndex } from './projectCompletion';
import {
  definitionsOf,
  findReferences,
  goToDefinition,
  invalidLabel,
  labelNavigationExtension,
  referencesOf,
  renameEdits,
  renameLabel,
  symbolAt,
} from './labelNavigation';

// CodeMirror measures text on clicks and scrolling, which jsdom can't do, so give it empty boxes.
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

const FILES: Record<string, string> = {
  'main.tex': String.raw`\newcommand{\R}{\mathbb{R}}
\section{Intro}\label{sec:intro}
See \ref{sec:intro} and \cref{sec:b,sec:intro}. % \ref{sec:intro}
\cite{knuth,hand} $\R$ \foo
\bibitem{hand} Hand.`,
  'chapters/b.tex': String.raw`\section{B}\label{sec:b}
Back to \autoref{sec:intro}.`,
  'refs.bib': '@book{knuth,\n  title = {The TeXbook}}\n',
};

/** Text with a `|` for the cursor: the offset and the text without it. */
function at(text: string) {
  const pos = text.indexOf('|');
  return { pos, text: text.slice(0, pos) + text.slice(pos + 1) };
}

function staticIndex(files = FILES) {
  return new ProjectIndex({
    version: () => 0,
    files: () => Object.entries(files).map(([path, text]) => ({ path, kind: 'text' as const, text: () => text })),
    mainPath: () => 'main.tex',
  });
}

describe('symbolAt', () => {
  it('finds a ref, label, cite, bibitem and command key under the cursor', () => {
    const cases: [string, string, string | null][] = [
      ['See \\ref{sec:in|tro}', 'label', 'sec:intro'],
      ['See \\ref{|sec:intro}', 'label', 'sec:intro'],
      ['See \\ref{sec:intro|}', 'label', 'sec:intro'],
      ['\\label{x|y}', 'label', 'xy'],
      ['\\cref{a,|b}', 'label', 'b'],
      ['\\citep[p.~3]{kn|uth}', 'citation', 'knuth'],
      ['\\bibitem{ha|nd}', 'citation', 'hand'],
      ['$\\R| x$', 'command', 'R'],
      ['$\\|R x$', 'command', 'R'],
      ['$\\sec|tion{a}$', 'command', 'section'],
      // A key built from a macro isn't a key, but the macro is still a command.
      ['\\ref{\\the|chapter}', 'command', 'thechapter'],
    ];
    for (const [input, kind, key] of cases) {
      const { pos, text } = at(input);
      expect(symbolAt(text, pos, 'a.tex'), input).toMatchObject({ kind, key });
    }
  });

  it('gives the range of the key', () => {
    const { pos, text } = at('x\nSee \\ref{sec:in|tro}');
    expect(symbolAt(text, pos, 'a.tex')).toEqual({ kind: 'label', key: 'sec:intro', from: 11, to: 20 });
  });

  it('finds nothing on plain text, in a comment, after \\\\, or on a macro key', () => {
    for (const input of ['plain te|xt', '% \\ref{a|b}', '\\\\|ref', 'x % \\fo|o', '\\label{#|1}']) {
      const { pos, text } = at(input);
      expect(symbolAt(text, pos, 'a.tex'), input).toBeNull();
    }
  });

  it('finds an entry key in a .bib file', () => {
    const { pos, text } = at('@book{knu|th,\n title = {T}}');
    expect(symbolAt(text, pos, 'refs.bib')).toEqual({ kind: 'citation', key: 'knuth', from: 6, to: 11 });
    const outside = at('@book{knuth,\n ti|tle = {T}}');
    expect(symbolAt(outside.text, outside.pos, 'refs.bib')).toBeNull();
  });
});

describe('definitions, references and rename edits', () => {
  const index = staticIndex();

  it('finds where labels, citations and commands are defined', () => {
    expect(definitionsOf(index, { kind: 'label', key: 'sec:b' })).toEqual([{ role: 'definition', path: 'chapters/b.tex', line: 1, column: 18, length: 5 }]);
    expect(definitionsOf(index, { kind: 'citation', key: 'knuth' })).toEqual([{ role: 'definition', path: 'refs.bib', line: 1, column: 6, length: 5 }]);
    expect(definitionsOf(index, { kind: 'citation', key: 'hand' })).toEqual([{ role: 'definition', path: 'main.tex', line: 5, column: 9, length: 4 }]);
    expect(definitionsOf(index, { kind: 'command', key: 'R' })).toEqual([{ role: 'definition', path: 'main.tex', line: 1, column: 12, length: 2 }]);
    expect(definitionsOf(index, { kind: 'command', key: 'foo' })).toEqual([]);
  });

  it('lists every definition and use in file and line order, leaving comments out', () => {
    expect(referencesOf(index, { kind: 'label', key: 'sec:intro' }).map((l) => `${l.role} ${l.path}:${l.line}:${l.column}`)).toEqual([
      'use chapters/b.tex:2:17',
      'definition main.tex:2:22',
      'use main.tex:3:9',
      'use main.tex:3:36',
    ]);
    expect(referencesOf(index, { kind: 'citation', key: 'knuth' }).map((l) => `${l.role} ${l.path}:${l.line}`)).toEqual([
      'use main.tex:4',
      'definition refs.bib:1',
    ]);
    expect(referencesOf(index, { kind: 'command', key: 'R' }).map((l) => l.role)).toEqual(['definition']);
  });

  it('checks a new label name', () => {
    expect(invalidLabel('sec:new', index, 'sec:intro')).toBeNull();
    expect(invalidLabel('sec:intro', index, 'sec:intro')).toBeNull();
    expect(invalidLabel('', index, 'sec:intro')).toBe('A label needs a name.');
    expect(invalidLabel('a b', index, 'sec:intro')).toMatch(/can't have spaces/);
    expect(invalidLabel('a,b', index, 'sec:intro')).toMatch(/commas/);
    expect(invalidLabel('sec:b', index, 'sec:intro')).toBe('There\'s already a label “sec:b”.');
  });

  it('makes an edit for each label and reference', () => {
    const edits = renameEdits(index, 'sec:intro', 'sec:start');
    expect(edits).toHaveLength(4);
    expect(edits.every((e) => e.insert === 'sec:start' && e.expect === 'sec:intro' && e.length === 9)).toBe(true);
  });
});

/** An editor on the main file of a real project doc, with the app's open, record and notify as spies. */
function setup(files = FILES) {
  const doc = new Y.Doc();
  const project = new ProjectDoc(doc);
  project.replaceAll({ name: 'T', mainPath: 'main.tex', files: Object.entries(files).map(([path, text]) => ({ path, kind: 'text' as const, text })) });
  let active = 'main.tex';
  const textOf = (path: string) => project.getText(project.entries().find((e) => e.path === path)!.id);
  const notify = vi.fn();
  const record = vi.fn((op: () => void) => op());
  const parent = document.createElement('div');
  document.body.append(parent);
  // eslint-disable-next-line prefer-const
  let view: EditorView;
  const opened: TextLocation[] = [];
  const completion = completionProjectFrom(doc, project, {
    activePath: () => active,
    open: (location) => {
      opened.push(location);
      active = location.path;
      // The app rebinds the editor to the file it opens.
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: textOf(location.path).toString() } });
    },
    record,
    notify,
  });
  const getProject = (): CompletionProject => completion;
  view = new EditorView({ state: EditorState.create({ doc: textOf('main.tex').toString(), extensions: labelNavigationExtension(getProject) }), parent });
  const cursorAt = (needle: string, offset = 1) => {
    const pos = view.state.doc.toString().indexOf(needle) + offset;
    view.dispatch({ selection: { anchor: pos } });
    return pos;
  };
  const selected = () => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
  const cleanup = () => {
    view.destroy();
    parent.remove();
    completion.dispose();
  };
  return { view, getProject, notify, record, opened, textOf, cursorAt, selected, active: () => active, cleanup };
}

describe('goToDefinition', () => {
  it('selects a label in the same file', () => {
    const t = setup();
    t.cursorAt('\\ref{sec:intro}', 7);
    expect(goToDefinition(t.view, t.getProject)).toBe(true);
    expect(t.selected()).toBe('sec:intro');
    expect(t.view.state.doc.lineAt(t.view.state.selection.main.from).number).toBe(2);
    expect(t.opened).toEqual([]);
    t.cleanup();
  });

  it('opens another file for a label, a .bib entry, or a command', () => {
    const t = setup();
    t.cursorAt('sec:b,', 1);
    goToDefinition(t.view, t.getProject);
    expect(t.active()).toBe('chapters/b.tex');
    expect(t.selected()).toBe('sec:b');
    t.cleanup();

    const c = setup();
    c.cursorAt('knuth,hand', 2);
    goToDefinition(c.view, c.getProject);
    expect(c.active()).toBe('refs.bib');
    expect(c.selected()).toBe('knuth');
    c.cleanup();

    const r = setup();
    r.cursorAt('$\\R$', 2);
    goToDefinition(r.view, r.getProject);
    expect(r.selected()).toBe('\\R');
    r.cleanup();
  });

  it('cycles through duplicate labels', () => {
    const t = setup({ 'main.tex': '\\label{d} x\n\\label{d}\n\\ref{d}' });
    t.cursorAt('\\ref{d}', 5);
    goToDefinition(t.view, t.getProject);
    expect(t.view.state.doc.lineAt(t.view.state.selection.main.from).number).toBe(1);
    goToDefinition(t.view, t.getProject);
    expect(t.view.state.doc.lineAt(t.view.state.selection.main.from).number).toBe(2);
    goToDefinition(t.view, t.getProject);
    expect(t.view.state.doc.lineAt(t.view.state.selection.main.from).number).toBe(1);
    t.cleanup();
  });

  it('says when there is nothing to go to', () => {
    const t = setup({ 'main.tex': 'plain \\ref{nope} \\foo' });
    t.cursorAt('plain', 1);
    expect(goToDefinition(t.view, t.getProject)).toBe(false);
    t.cursorAt('nope', 1);
    expect(goToDefinition(t.view, t.getProject)).toBe(true);
    t.cursorAt('\\foo', 2);
    goToDefinition(t.view, t.getProject);
    expect(t.notify.mock.calls.map(([m]) => m)).toEqual([
      'Put the cursor on a label, a \\ref or \\cite key, or a command first.',
      'No definition of the label “nope” in the project.',
      '\\foo isn\'t defined in the project. It may come from LaTeX or a package.',
    ]);
    // With no project there's nothing to do and nothing to say.
    expect(goToDefinition(t.view, () => null)).toBe(false);
    t.cleanup();
  });

  it('goes on Ctrl+click on a key, and leaves other clicks alone', () => {
    const t = setup();
    const pos = t.view.state.doc.toString().indexOf('sec:b,') + 1;
    const coords = vi.spyOn(t.view, 'posAtCoords').mockReturnValue(pos);
    const click = (init: MouseEventInit) => {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init });
      t.view.contentDOM.dispatchEvent(event);
      return event;
    };
    click({});
    click({ ctrlKey: true, metaKey: true, button: 2 });
    expect(t.active()).toBe('main.tex');
    // Ctrl+click on plain text, or outside the text, is CodeMirror's (adding a cursor).
    coords.mockReturnValue(0);
    click({ ctrlKey: true, metaKey: true });
    coords.mockReturnValue(null);
    click({ ctrlKey: true, metaKey: true });
    expect(t.active()).toBe('main.tex');
    coords.mockReturnValue(pos);
    click({ ctrlKey: true, metaKey: true });
    expect(t.active()).toBe('chapters/b.tex');
    expect(t.notify).not.toHaveBeenCalled();
    t.cleanup();
  });
});

describe('findReferences', () => {
  it('lists every place in a panel, and each row opens its place', () => {
    const t = setup();
    t.cursorAt('\\label{sec:intro}', 8);
    expect(findReferences(t.view, t.getProject)).toBe(true);
    const panel = t.view.dom.querySelector('.cm-references')!;
    expect(panel.querySelector('.cm-references-header span')!.textContent).toBe('Label “sec:intro”: 1 definition, 3 uses');
    const rows = [...panel.querySelectorAll<HTMLButtonElement>('.cm-references-item')];
    expect(rows.map((row) => row.textContent)).toEqual([
      'chapters/b.tex:2Back to \\autoref{sec:intro}.',
      'main.tex:2\\section{Intro}\\label{sec:intro}',
      'main.tex:3See \\ref{sec:intro} and \\cref{sec:b,sec:intro}. % \\ref{sec:intro}',
      'main.tex:3See \\ref{sec:intro} and \\cref{sec:b,sec:intro}. % \\ref{sec:intro}',
    ]);
    expect(rows[1].dataset.definition).toBe('true');
    expect(document.activeElement).toBe(rows[0]);
    rows[0].click();
    expect(t.active()).toBe('chapters/b.tex');
    expect(t.selected()).toBe('sec:intro');
    // The panel stays while you go through the list, and Escape closes it.
    const still = t.view.dom.querySelector('.cm-references')!;
    still.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(t.view.dom.querySelector('.cm-references')).toBeTruthy();
    still.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(t.view.dom.querySelector('.cm-references')).toBeNull();
    t.cleanup();
  });

  it('closes with its button, and only works on labels and citations', () => {
    const t = setup();
    t.cursorAt('knuth,', 1);
    findReferences(t.view, t.getProject);
    expect(t.view.dom.querySelector('.cm-references-header span')!.textContent).toBe('Citation “knuth”: 1 definition, 1 use');
    t.view.dom.querySelector<HTMLButtonElement>('.cm-references-close')!.click();
    expect(t.view.dom.querySelector('.cm-references')).toBeNull();
    t.cursorAt('$\\R', 2);
    expect(findReferences(t.view, t.getProject)).toBe(false);
    t.cursorAt('Intro}', 1);
    expect(findReferences(t.view, t.getProject)).toBe(false);
    expect(findReferences(t.view, () => null)).toBe(false);
    expect(t.notify.mock.calls.map(([m]) => m)).toEqual([
      'Find references works on labels and citations.',
      'Put the cursor on a label, a \\ref or \\cite key, or a command first.',
    ]);
    t.cleanup();
  });
});

describe('renameLabel', () => {
  it('renames the label and every reference in every file as one recorded step, through the Yjs doc', async () => {
    const t = setup();
    t.cursorAt('\\ref{sec:intro}', 6);
    const ask = vi.fn(async (current: string, check: (name: string) => string | null) => {
      expect(current).toBe('sec:intro');
      expect(check('sec:b')).toMatch(/already/);
      return 'sec:start';
    });
    expect(await renameLabel(t.view, t.getProject, ask)).toBe(true);
    expect(t.record).toHaveBeenCalledTimes(1);
    expect(t.record.mock.calls[0].slice(1)).toEqual(['Rename label sec:intro', 'Renamed “sec:intro” to “sec:start”: 4 places in 2 files.']);
    expect(t.textOf('main.tex').toString()).toContain('\\label{sec:start}\nSee \\ref{sec:start} and \\cref{sec:b,sec:start}. % \\ref{sec:intro}');
    expect(t.textOf('chapters/b.tex').toString()).toBe('\\section{B}\\label{sec:b}\nBack to \\autoref{sec:start}.');
    t.cleanup();
  });

  it('does nothing when cancelled, unchanged, invalid, or not on a label', async () => {
    const t = setup({ 'main.tex': '\\label{a} \\cite{k} \\ref{a}' });
    t.cursorAt('\\ref{a}', 5);
    expect(await renameLabel(t.view, t.getProject, async () => null)).toBe(false);
    expect(await renameLabel(t.view, t.getProject, async () => 'a')).toBe(false);
    expect(await renameLabel(t.view, t.getProject, async () => 'bad name')).toBe(false);
    t.cursorAt('\\cite{k}', 6);
    expect(await renameLabel(t.view, t.getProject, async () => 'x')).toBe(false);
    expect(await renameLabel(t.view, () => null, async () => 'x')).toBe(false);
    expect(t.record).not.toHaveBeenCalled();
    expect(t.notify.mock.calls.map(([m]) => m)).toEqual([
      'A label can\'t have spaces, commas, braces, or \\ # % ~ ^ $ in it.',
      'Put the cursor on a \\label or a \\ref key to rename it.',
    ]);
    t.cleanup();
  });

  it('can rename a reference to a label nobody defined yet', async () => {
    const t = setup({ 'main.tex': '\\ref{ghost} and \\ref{ghost}' });
    t.cursorAt('ghost', 1);
    expect(await renameLabel(t.view, t.getProject, async () => 'real')).toBe(true);
    expect(t.textOf('main.tex').toString()).toBe('\\ref{real} and \\ref{real}');
    t.cleanup();
  });
});

describe('applyEdits', () => {
  it('skips an edit whose text changed, a missing file, and a line past the end', () => {
    const doc = new Y.Doc();
    const project = new ProjectDoc(doc);
    project.replaceAll({ name: 'T', mainPath: 'a.tex', files: [{ path: 'a.tex', kind: 'text', text: 'one\ntwo' }] });
    const completion = completionProjectFrom(doc, project);
    completion.applyEdits!([
      { path: 'a.tex', line: 2, column: 0, length: 3, insert: 'TWO', expect: 'two' },
      { path: 'a.tex', line: 1, column: 0, length: 3, insert: 'ONE', expect: 'uno' },
      { path: 'a.tex', line: 9, column: 0, length: 1, insert: '!' },
      { path: 'gone.tex', line: 1, column: 0, length: 1, insert: '!' },
    ], 'label', 'done');
    expect(project.getText(project.entries()[0].id).toString()).toBe('one\nTWO');
    expect(offsetOf('a\nb', 3, 0)).toBe(-1);
    completion.dispose();
  });
});
