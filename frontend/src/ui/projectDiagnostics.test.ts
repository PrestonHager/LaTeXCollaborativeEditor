import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import * as Y from 'yjs';
import { ProjectDoc } from '../project/projectDoc';
import { completionProjectFrom, type CompletionProject } from './completionProject';
import { diagnosticsExtensions, diagnosticsToLint } from './diagnostics';
import { extractLabels, extractReferences, isLiteralKey, ProjectIndex } from './projectCompletion';
import { diagnosticsFor, projectDiagnostics, projectDiagnosticsExtension } from './projectDiagnostics';

function projectWith(files: Record<string, string>) {
  const doc = new Y.Doc();
  const project = new ProjectDoc(doc);
  project.replaceAll({
    name: 'Test',
    mainPath: 'main.tex',
    files: Object.entries(files).map(([path, text]) => ({ path, kind: 'text' as const, text })),
  });
  return { doc, project };
}

function staticProject(files: Record<string, string>, active: string | null = 'main.tex'): CompletionProject {
  return {
    version: () => 0,
    files: () => Object.entries(files).map(([path, text]) => ({ path, kind: 'text' as const, text: () => text })),
    mainPath: () => 'main.tex',
    activePath: () => active,
  };
}

describe('extractReferences', () => {
  it('finds refs, cites and bibitems with their line and column', () => {
    const text = String.raw`See \ref{sec:a} and \eqref{eq:1}.
\cref{fig:a, fig:b} \autoref*{tab:x}
\citep[p.~3]{knuth84,lamport94} \parencite[see][12]{gratzer}
\bibitem[K84]{k84} Knuth.`;
    const refs = extractReferences(text, 'main.tex');
    expect(refs.map((r) => [r.kind, r.command, r.key, r.line, r.column])).toEqual([
      ['ref', 'ref', 'sec:a', 1, 9],
      ['ref', 'eqref', 'eq:1', 1, 27],
      ['ref', 'cref', 'fig:a', 2, 6],
      ['ref', 'cref', 'fig:b', 2, 13],
      ['ref', 'autoref', 'tab:x', 2, 30],
      ['cite', 'citep', 'knuth84', 3, 13],
      ['cite', 'citep', 'lamport94', 3, 21],
      ['cite', 'parencite', 'gratzer', 3, 52],
      ['bibitem', 'bibitem', 'k84', 4, 14],
    ]);
    expect(text.split('\n')[2].slice(52, 59)).toBe('gratzer');
  });

  it('skips comments, line breaks, macro keys, \\nocite{*} and commands that only look like cites', () => {
    const text = String.raw`% \ref{gone}
a \% \ref{kept} % \cite{gone}
\\ref{notacommand} \ref{sec:\thechapter} \ref{#1}
\nocite{*} \citestyle{authoryear} \referee{x} \ref{a,b}`;
    expect(extractReferences(text, 'a.tex').map((r) => r.key)).toEqual(['kept', 'a,b']);
  });

  it('knows a literal key', () => {
    expect(isLiteralKey('fig:a-1')).toBe(true);
    expect(isLiteralKey('')).toBe(false);
    expect(isLiteralKey('\\x')).toBe(false);
    expect(isLiteralKey('#1')).toBe(false);
  });

  it('gives a label its column', () => {
    expect(extractLabels('x \\label{ a }', 'a.tex')).toEqual([{ key: 'a', path: 'a.tex', line: 1, column: 10 }]);
  });

  it('reads a listing\'s label= option as a label', () => {
    const text = String.raw`\begin{lstlisting}[language=C, caption={A loop}, label=lst:loop, numbers=left]
\lstinputlisting[label={lst:file}]{a.py} \label{after}
\begin{minted}{python}[label = m:1 ]
\begin{lstlisting}[caption=No label]`;
    expect(extractLabels(text, 'a.tex').map((l) => [l.key, l.line, text.split('\n')[l.line - 1].slice(l.column, l.column! + l.key.length)])).toEqual([
      ['lst:loop', 1, 'lst:loop'],
      ['lst:file', 2, 'lst:file'],
      ['after', 2, 'after'],
      ['m:1', 3, 'm:1'],
    ]);
  });
});

describe('projectDiagnostics', () => {
  const files = {
    'main.tex': String.raw`\section{A}\label{sec:a}
\ref{sec:a} \ref{sec:missing} \ref{dup}
\cite{knuth84} \cite{nobody} \cite{handmade}
\begin{thebibliography}{9}\bibitem{handmade} X.\end{thebibliography}`,
    'chapters/b.tex': String.raw`\label{dup}
\label{dup}
\newcommand{\mylabel}[1]{\label{#1}\label{#1}}`,
    'refs.bib': '@book{knuth84, title = {The TeXbook}}',
  };

  it('warns on undefined references, duplicate labels and missing citations, with file and line', () => {
    const all = projectDiagnostics(new ProjectIndex(staticProject(files)));
    expect(all.map((d) => [d.path, d.line, d.column, d.message])).toEqual([
      ['chapters/b.tex', 1, 7, 'Label “dup” is defined 2 times. Also at chapters/b.tex:2.'],
      ['chapters/b.tex', 2, 7, 'Label “dup” is defined 2 times. Also at chapters/b.tex:1.'],
      ['main.tex', 2, 17, 'Undefined reference: no file in the project has \\label{sec:missing}.'],
      ['main.tex', 3, 21, 'Missing citation: “nobody” isn\'t in any .bib file in the project.'],
    ]);
    expect(all.every((d) => d.severity === 'warning')).toBe(true);
    expect(diagnosticsFor(all, 'main.tex')).toEqual([
      { line: 2, column: 17, length: 11, severity: 'warning', message: 'Undefined reference: no file in the project has \\label{sec:missing}.' },
      { line: 3, column: 21, length: 6, severity: 'warning', subject: 'cite:nobody', message: 'Missing citation: “nobody” isn\'t in any .bib file in the project.' },
    ]);
  });

  it('says when there is no .bib file at all', () => {
    const all = projectDiagnostics(new ProjectIndex(staticProject({ 'main.tex': '\\cite{x}' })));
    expect(all.map((d) => d.message)).toEqual(['Missing citation: “x”. The project has no .bib file.']);
  });
});

describe('projectDiagnosticsExtension', () => {
  afterEach(() => vi.useRealTimers());

  function editor(getProject: () => CompletionProject | null, doc = '') {
    const parent = document.createElement('div');
    const view = new EditorView({
      state: EditorState.create({ doc, extensions: [diagnosticsExtensions, projectDiagnosticsExtension(getProject, 50)] }),
      parent,
    });
    return view;
  }

  it('shows the open file\'s problems, and updates when another file changes (a peer\'s edit)', async () => {
    vi.useFakeTimers();
    const { doc, project } = projectWith({
      'main.tex': '\\ref{later}\n\\ref{sec:a}',
      'b.tex': '\\label{sec:a}',
    });
    const completion = completionProjectFrom(doc, project, { activePath: () => 'main.tex' });
    const view = editor(() => completion, project.getText(project.entries().find((e) => e.path === 'main.tex')!.id).toString());
    await vi.advanceTimersByTimeAsync(0);
    expect(diagnosticsToLint(view).map((d) => [d.from, d.to])).toEqual([[5, 10]]);

    // Someone adds the label in another file.
    const other = project.entries().find((e) => e.path === 'b.tex')!;
    project.getText(other.id).insert(0, '\\label{later}');
    await vi.advanceTimersByTimeAsync(49);
    expect(diagnosticsToLint(view)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(diagnosticsToLint(view)).toEqual([]);

    // Typing in the open file checks again too.
    view.dispatch({ changes: { from: 0, insert: ' ' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(diagnosticsToLint(view)).toEqual([]);

    view.destroy();
    completion.dispose();
  });

  it('follows a replaced project and clears when there is none', async () => {
    vi.useFakeTimers();
    let current: CompletionProject | null = staticProject({ 'main.tex': '\\ref{x}' });
    const view = editor(() => current, '\\ref{x}');
    await vi.advanceTimersByTimeAsync(0);
    expect(diagnosticsToLint(view)).toHaveLength(1);

    const { doc, project } = projectWith({ 'main.tex': '\\ref{y}' });
    const replaced = completionProjectFrom(doc, project, { activePath: () => 'main.tex' });
    current = replaced;
    view.dispatch({ changes: { from: 0, insert: ' ' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(diagnosticsToLint(view).map((d) => d.message)).toEqual(['Undefined reference: no file in the project has \\label{y}.']);

    current = null;
    view.dispatch({ changes: { from: 0, insert: ' ' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(diagnosticsToLint(view)).toEqual([]);

    // A project without an open file has nothing to show either.
    current = staticProject({ 'main.tex': '\\ref{x}' }, null);
    view.dispatch({ changes: { from: 0, insert: ' ' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(diagnosticsToLint(view)).toEqual([]);

    view.destroy();
    replaced.dispose();
    // A stopped plugin doesn't run after the editor is gone.
    project.getText(project.entries()[0].id).insert(0, 'x');
    await vi.advanceTimersByTimeAsync(100);
  });

  it('does not dispatch again when nothing changed', async () => {
    vi.useFakeTimers();
    const view = editor(() => staticProject({ 'main.tex': '\\ref{x}' }), '\\ref{x}');
    await vi.advanceTimersByTimeAsync(0);
    const before = view.state;
    view.dispatch({ changes: { from: 7, insert: ' ' } });
    const afterEdit = view.state;
    await vi.advanceTimersByTimeAsync(50);
    expect(view.state).toBe(afterEdit);
    expect(before).not.toBe(afterEdit);
    view.destroy();
  });
});
