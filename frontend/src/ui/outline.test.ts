import * as Y from 'yjs';
import { ProjectDoc } from '../project/projectDoc';
import { completionProjectFrom, type CompletionProject } from './completionProject';
import { blankVerbatim, buildOutline, cleanTitle, entryLabel, mountOutline, outlineItems, resolveInclude } from './outline';

function staticProject(files: Record<string, string>, main: string | null = 'main.tex'): CompletionProject {
  return {
    version: () => 0,
    files: () => Object.entries(files).map(([path, text]) => ({ path, kind: 'text' as const, text: () => text })),
    mainPath: () => main,
  };
}

const FILES: Record<string, string> = {
  'main.tex': String.raw`\documentclass{article}
\begin{document}
\section{Introduction}\label{sec:intro}
\input{chapters/one}
% \section{Commented out}
\begin{figure}[h]
  \includegraphics{a.png}
  \caption[Short]{A \emph{nice} plot of $x^2$}
\end{figure}
\include{chapters/two.tex}
\input{missing}
\section*{Appendix: The {\TeX}book}
\begin{verbatim}
\section{Not a section}
\end{verbatim}
\\section is just text after a line break.
\end{document}`,
  'chapters/one.tex': String.raw`\subsection{Details}
\begin{table}
\centering
\caption{Results}
\end{table}
\begin{figure*}
\end{figure*}
\input{chapters/one}`,
  'chapters/two.tex': String.raw`\section[Short]{Second~part}
\paragraph{}`,
};

describe('outlineItems', () => {
  it('finds headings, floats and includes in order, skipping comments, verbatim and \\\\section', () => {
    expect(outlineItems(FILES['main.tex']).map((item) => [item.type, 'kind' in item ? item.kind : item.name, 'title' in item ? item.title : ''])).toEqual([
      ['heading', 'section', 'Introduction'],
      ['include', 'chapters/one', ''],
      ['float', 'figure', 'A nice plot of $x^2$'],
      ['include', 'chapters/two.tex', ''],
      ['include', 'missing', ''],
      ['heading', 'section', 'Appendix: The TeXbook'],
    ]);
  });

  it('skips a heading with no title group', () => {
    expect(outlineItems('\\section')).toEqual([]);
  });

  it('blanks verbatim blocks but keeps their lines', () => {
    expect(blankVerbatim('a\n\\begin{lstlisting}\nx\n\\end{lstlisting}\nb').split('\n')).toHaveLength(5);
  });

  it('cleans titles but keeps math', () => {
    expect(cleanTitle('The \\textbf{big}~idea\\label{x} of $\\alpha$')).toBe('The big idea of $\\alpha$');
  });
});

describe('resolveInclude', () => {
  const has = (path: string) => ['chapters/one.tex', 'sub/x.tex', 'data.txt'].includes(path);
  it('adds .tex, works from the main file folder, and refuses to climb out', () => {
    expect(resolveInclude('chapters/one', '', has)).toBe('chapters/one.tex');
    expect(resolveInclude('x', 'sub', has)).toBe('sub/x.tex');
    expect(resolveInclude('data.txt', '', has)).toBe('data.txt');
    expect(resolveInclude('../x', 'sub', has)).toBeNull();
    expect(resolveInclude('nope', '', has)).toBeNull();
  });
});

describe('buildOutline', () => {
  it('follows \\input and \\include from the main file in document order, with depths', () => {
    const entries = buildOutline(staticProject(FILES));
    expect(entries.map((e) => [e.kind, e.depth, entryLabel(e), `${e.path}:${e.line}:${e.column}`])).toEqual([
      ['section', 0, 'Introduction', 'main.tex:3:0'],
      ['subsection', 1, 'Details', 'chapters/one.tex:1:0'],
      ['table', 2, 'Table: Results', 'chapters/one.tex:2:0'],
      ['figure', 2, 'Figure', 'chapters/one.tex:6:0'],
      // After \input{chapters/one}, so it's in the Details subsection.
      ['figure', 2, 'Figure: A nice plot of $x^2$', 'main.tex:6:0'],
      ['section', 0, 'Second part', 'chapters/two.tex:1:0'],
      ['paragraph', 3, '(untitled paragraph)', 'chapters/two.tex:2:0'],
      ['section', 0, 'Appendix: The TeXbook', 'main.tex:12:0'],
    ]);
  });

  it('puts a float before any heading at depth 0, and is empty without a main file', () => {
    expect(buildOutline(staticProject({ 'main.tex': '\\begin{table}\\caption{T}\\end{table}' })).map((e) => e.depth)).toEqual([0]);
    expect(buildOutline(staticProject(FILES, null))).toEqual([]);
    expect(buildOutline(staticProject(FILES, 'gone.tex'))).toEqual([]);
  });

  it('reads main files in a folder', () => {
    const entries = buildOutline(staticProject({ 'thesis/main.tex': '\\chapter{A}\\input{ch1}', 'thesis/ch1.tex': '\\section{B}' }, 'thesis/main.tex'));
    expect(entries.map((e) => [e.title, e.depth])).toEqual([['A', 0], ['B', 1]]);
  });
});

describe('mountOutline', () => {
  afterEach(() => vi.useRealTimers());

  it('draws rows that open their place, and follows changes to the project', async () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    const project = new ProjectDoc(doc);
    project.replaceAll({ name: 'T', mainPath: 'main.tex', files: [{ path: 'main.tex', kind: 'text', text: '\\section{One}' }] });
    const completion = completionProjectFrom(doc, project);
    const list = document.createElement('ol');
    const open = vi.fn();
    const mounted = mountOutline(list, { project: () => completion, open }, 50);
    const rows = () => [...list.querySelectorAll<HTMLButtonElement>('.outline-item')];
    expect(rows().map((r) => r.textContent)).toEqual(['One']);
    expect(rows()[0].title).toBe('One (main.tex:1)');
    rows()[0].click();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ path: 'main.tex', line: 1, column: 0 }));

    // A peer adds a section.
    project.getText(project.entries()[0].id).insert(13, '\n\\subsection{Two}');
    await vi.advanceTimersByTimeAsync(49);
    expect(rows()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(rows().map((r) => [r.textContent, r.style.getPropertyValue('--depth')])).toEqual([['One', '0'], ['Two', '1']]);

    // Nothing changed: the rows stay the same elements.
    const before = rows()[0];
    mounted.refresh();
    expect(rows()[0]).toBe(before);

    mounted.dispose();
    project.getText(project.entries()[0].id).insert(0, '\\section{Zero}\n');
    await vi.advanceTimersByTimeAsync(100);
    expect(rows()).toHaveLength(2);
    completion.dispose();
  });

  it('says why it is empty, and moves to a replaced project', () => {
    let current: CompletionProject | null = null;
    const list = document.createElement('ol');
    const mounted = mountOutline(list, { project: () => current, open: vi.fn() });
    expect(list.textContent).toBe('Set a main file to see its outline.');
    current = staticProject({ 'main.tex': 'Just text.' });
    mounted.refresh();
    expect(list.textContent).toBe('No sections, figures or tables yet.');
    current = staticProject({ 'main.tex': '\\section{S}' });
    mounted.refresh();
    expect(list.querySelector('.outline-item')?.textContent).toBe('S');
    mounted.dispose();
  });
});
