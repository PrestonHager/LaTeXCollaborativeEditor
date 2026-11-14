import { CompletionContext, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import * as Y from 'yjs';
import { ProjectDoc } from '../project/projectDoc';
import { completionProjectFrom, type CompletionProject } from './completionProject';
import { latexCompletionExtensions } from './latexCompletion';
import {
  citationSource,
  cleanBibValue,
  extractBibEntries,
  extractDefinitions,
  extractLabels,
  extractPackages,
  labelSource,
  pathSource,
  ProjectIndex,
  projectIndex,
  relativePath,
  shortAuthors,
  stripComments,
} from './projectCompletion';

/** Runs a source with the cursor at the first `|`. */
function complete(source: CompletionSource, text: string, explicit = false) {
  const pos = text.indexOf('|');
  const state = EditorState.create({ doc: text.slice(0, pos) + text.slice(pos + 1), selection: { anchor: pos } });
  return source(new CompletionContext(state, pos, explicit)) as CompletionResult | null;
}

const labels = (result: CompletionResult | null) => result?.options.map((o) => o.label);

function projectWith(files: Record<string, string>, main = 'main.tex') {
  const doc = new Y.Doc();
  const project = new ProjectDoc(doc);
  project.replaceAll({
    name: 'Test',
    mainPath: main,
    files: Object.entries(files).map(([path, text]) => (path.endsWith('.png') || path.endsWith('.pdf')
      ? { path, kind: 'binary' as const, hash: 'h', size: 1 }
      : text === '/' ? { path, kind: 'folder' as const } : { path, kind: 'text' as const, text })),
  });
  const completion = completionProjectFrom(doc, project);
  return { doc, project, completion, get: () => completion };
}

const BIB = String.raw`
@string{acm = "ACM"}
@comment{ not an entry }
@article{knuth84,
  author = {Donald E. Knuth},
  title = {Literate {P}rogramming},
  journal = acm # " Journal",
  year = 1984,
}
@book{lamport94, title = "{\LaTeX}: A Document Preparation System",
  author = {Lamport, Leslie and Knuth, Donald and Others, Some}, date = {1994-01-01}}
@misc(paren, title = {In (parens)}, author = {Ana {\"O}zt{\"u}rk and Bo Li})
`;

describe('extractLabels', () => {
  it('finds every \\label with its line, and skips commented-out ones', () => {
    const text = 'a \\label{sec:intro}\n% \\label{gone}\n\\label{ eq:1 } x \\label{fig:a} 50\\% \\label{kept}\n\\label{}';
    expect(extractLabels(text, 'a.tex')).toEqual([
      { key: 'sec:intro', path: 'a.tex', line: 1 },
      { key: 'eq:1', path: 'a.tex', line: 3 },
      { key: 'fig:a', path: 'a.tex', line: 3 },
      { key: 'kept', path: 'a.tex', line: 3 },
    ]);
  });

  it('cuts comments but keeps \\% and treats \\\\% as a comment', () => {
    expect(stripComments('a\\% b % c\nd\\\\% e')).toBe('a\\% b \nd\\\\');
  });
});

describe('extractBibEntries', () => {
  it('reads keys, types, titles, authors and years, and skips @string and @comment', () => {
    const entries = extractBibEntries(BIB, 'refs.bib');
    expect(entries.map((e) => e.key)).toEqual(['knuth84', 'lamport94', 'paren']);
    expect(entries[0]).toEqual({ key: 'knuth84', type: 'article', path: 'refs.bib', title: 'Literate Programming', author: 'Donald E. Knuth', year: '1984' });
    expect(entries[1]).toMatchObject({ type: 'book', title: 'LaTeX: A Document Preparation System', year: '1994' });
    expect(entries[2]).toMatchObject({ key: 'paren', type: 'misc', title: 'In (parens)', author: 'Ana Ozturk and Bo Li', year: undefined });
  });

  it('copes with an entry that never closes or has no fields', () => {
    expect(extractBibEntries('@article{open,\n title = {Never closed', 'x.bib')).toEqual([
      { key: 'open', type: 'article', path: 'x.bib', title: 'Never closed', author: undefined, year: undefined },
    ]);
    expect(extractBibEntries('@misc{a,}', 'x.bib')[0]).toMatchObject({ key: 'a', title: undefined });
  });

  it('cleans values for showing', () => {
    expect(cleanBibValue('  The {\\TeX}book \\emph{x} \\& {\\\'e}tude  ')).toBe('The TeXbook x & etude');
  });
});

describe('shortAuthors', () => {
  it('gives one, two or the first and "et al."', () => {
    expect(shortAuthors('Donald E. Knuth')).toBe('Knuth');
    expect(shortAuthors('Lamport, Leslie and Knuth, Donald')).toBe('Lamport and Knuth');
    expect(shortAuthors('A B and C D and E F')).toBe('B et al.');
    expect(shortAuthors(' ')).toBe('');
  });
});

describe('relativePath', () => {
  it('is relative to a folder, climbing out with ../', () => {
    expect(relativePath('a/b.tex', '')).toBe('a/b.tex');
    expect(relativePath('src/ch/1.tex', 'src')).toBe('ch/1.tex');
    expect(relativePath('img/x.png', 'src')).toBe('../img/x.png');
    expect(relativePath('src/x.tex', 'src/deep')).toBe('../x.tex');
  });
});

describe('extractPackages', () => {
  it('reads \\usepackage lists with options, \\RequirePackage and the class, and skips comments', () => {
    const text = '\\documentclass[11pt]{beamer}\n\\usepackage[fleqn]{amsmath, amssymb,\n}\n% \\usepackage{tikz}\n\\RequirePackage{xcolor}\\usepackage{}';
    expect(extractPackages(text)).toEqual(['beamer', 'amsmath', 'amssymb', 'xcolor']);
  });
});

describe('extractDefinitions', () => {
  const brief = (text: string) => extractDefinitions(text, 'f.tex').map((d) => [d.kind[0], d.name, d.args, d.optional ?? null, d.via, d.text ?? null, d.line]);

  it('reads commands with their arguments, in order, with their lines', () => {
    const text = [
      '\\newcommand{\\R}{\\mathbb{R}}',
      '\\renewcommand*\\vec[1]{\\mathbf{#1}} \\providecommand{\\note}[2][red]{#2}',
      '% \\newcommand{\\gone}{}',
      '\\DeclareMathOperator*{\\argmax}{arg\\,max} \\DeclareMathOperator\\Tr{Tr}',
      '\\def\\pair#1#2{(#1,#2)} \\makeatletter\\newcommand{\\my@internal}{}',
      '\\NewDocumentCommand{\\norm}{o m}{} \\DeclareRobustCommand{\\x}{}',
    ].join('\n');
    expect(brief(text)).toEqual([
      ['c', 'R', 0, null, '\\newcommand', null, 1],
      ['c', 'vec', 1, null, '\\renewcommand', null, 2],
      ['c', 'note', 2, 'red', '\\providecommand', null, 2],
      ['c', 'argmax', 0, null, '\\DeclareMathOperator', 'arg\\,max', 4],
      ['c', 'Tr', 0, null, '\\DeclareMathOperator', 'Tr', 4],
      ['c', 'pair', 2, null, '\\def', null, 5],
      ['c', 'norm', 2, '', '\\NewDocumentCommand', null, 6],
      ['c', 'x', 0, null, '\\DeclareRobustCommand', null, 6],
    ]);
  });

  it('reads environments and theorems', () => {
    const text = '\\newenvironment{boxed}[1][Note]{}{}\n\\renewenvironment{proof}{}{}\n\\newtheorem{theorem}{Theorem}[section]\n\\newtheorem{lemma}[theorem]{Lemma}\n\\newtheorem*{remark}{}\n\\NewDocumentEnvironment{panel}{m}{}{}';
    expect(brief(text)).toEqual([
      ['e', 'boxed', 1, 'Note', '\\newenvironment', null, 1],
      ['e', 'proof', 0, null, '\\renewenvironment', null, 2],
      ['e', 'theorem', 0, null, '\\newtheorem', 'Theorem', 3],
      ['e', 'lemma', 0, null, '\\newtheorem', 'Lemma', 4],
      ['e', 'remark', 0, null, '\\newtheorem', null, 5],
      ['e', 'panel', 1, null, '\\NewDocumentEnvironment', null, 6],
    ]);
  });
});

describe('ProjectIndex', () => {
  it('only rebuilds after a change, and only rereads files whose text changed', () => {
    let version = 0;
    const reads: string[] = [];
    const file = (path: string, text: () => string) => ({ path, kind: 'text' as const, text: () => { reads.push(path); return text(); } });
    let chapter = '\\label{one}';
    const files = [file('main.tex', () => '\\label{main}'), file('ch.tex', () => chapter), file('refs.bib', () => '@misc{k, title={T}}'), file('notes.txt', () => '\\label{no}')];
    const project: CompletionProject = { version: () => version, files: () => files, mainPath: () => 'main.tex' };
    const index = new ProjectIndex(project);
    expect(index.labels().map((l) => l.key)).toEqual(['main', 'one']);
    expect(index.bibEntries().map((e) => e.key)).toEqual(['k']);
    expect(reads).toEqual(['main.tex', 'ch.tex', 'refs.bib']);
    index.labels();
    expect(reads).toHaveLength(3);
    chapter = '\\label{two}';
    version++;
    expect(index.labels().map((l) => l.key)).toEqual(['main', 'two']);
    // A file that's gone drops out.
    files.splice(1, 1);
    version++;
    expect(index.labels().map((l) => l.key)).toEqual(['main']);
  });

  it('reads packages and definitions from .tex and .sty files, and follows changes', () => {
    let version = 0;
    let macros = '\\newcommand{\\R}{\\mathbb{R}}';
    const files = [
      { path: 'main.tex', kind: 'text' as const, text: () => '\\documentclass{article}\n\\usepackage{amsmath}\n\\usepackage{macros}' },
      { path: 'macros.sty', kind: 'text' as const, text: () => `\\RequirePackage{xcolor}\n${macros}` },
      { path: 'notes.txt', kind: 'text' as const, text: () => '\\usepackage{nope}\\newcommand{\\nope}{}' },
    ];
    const index = new ProjectIndex({ version: () => version, files: () => files, mainPath: () => 'main.tex' });
    expect([...index.packages()]).toEqual(['article', 'amsmath', 'macros', 'xcolor']);
    const first = index.definitions();
    expect(first.map((d) => `${d.name} ${d.path}:${d.line}`)).toEqual(['R macros.sty:2']);
    expect(index.definitions()).toBe(first);
    macros = '\\newcommand{\\C}{\\mathbb{C}}';
    version++;
    expect(index.definitions().map((d) => d.name)).toEqual(['C']);
  });

  it('keeps one index per project', () => {
    const { completion } = projectWith({ 'main.tex': '' });
    expect(projectIndex(completion)).toBe(projectIndex(completion));
  });
});

describe('labelSource', () => {
  const { get, project } = projectWith({
    'main.tex': '\\documentclass{article}\n\\label{sec:intro}\n',
    'chapters/one.tex': '\\section{One}\\label{sec:one}\n% \\label{commented}\n',
    'notes.md': '\\label{not-tex}',
  });

  it('offers labels from every .tex file after \\ref{', () => {
    const result = complete(labelSource(get), 'See \\ref{|}');
    expect(labels(result)).toEqual(['sec:one', 'sec:intro']);
    expect(result?.from).toBe(9);
    expect(result?.options[0].detail).toBe('chapters/one.tex:1');
  });

  it.each(['\\eqref{', '\\autoref{', '\\cref{', '\\Cref{', '\\pageref{', '\\cref*{'])('works after %s', (command) => {
    expect(labels(complete(labelSource(get), `${command}s|`))).toContain('sec:intro');
  });

  it('completes the key after the last comma in \\cref', () => {
    const result = complete(labelSource(get), '\\cref{sec:one, s|}');
    expect(result?.from).toBe('\\cref{sec:one, '.length);
  });

  it('updates as files change', () => {
    project.createTextFile('extra.tex', '\\label{fig:new}');
    expect(labels(complete(labelSource(get), '\\ref{|'))).toContain('fig:new');
  });

  it('stays out of comments, escaped backslashes, other commands and closed arguments', () => {
    for (const text of ['% \\ref{|', '\\\\ref{|', '\\label{|', '\\ref{x}|', '\\myref{|']) {
      expect(complete(labelSource(get), text)).toBeNull();
    }
    expect(complete(labelSource(() => null), '\\ref{|')).toBeNull();
  });

  it('lists each key once', () => {
    const dup = projectWith({ 'main.tex': '\\label{a}', 'b.tex': '\\label{a}' });
    expect(labels(complete(labelSource(dup.get), '\\ref{|'))).toEqual(['a']);
  });
});

describe('citationSource', () => {
  const { get, project } = projectWith({ 'main.tex': '', 'refs.bib': BIB, 'more/other.bib': '@online{web, title={A site}}\n@online{web, title={Duplicate}}' });

  it('offers .bib keys with author and year, and the title in the info', () => {
    const result = complete(citationSource(get), '\\cite{|}');
    expect(labels(result)).toEqual(['web', 'knuth84', 'lamport94', 'paren']);
    const knuth = result!.options.find((o) => o.label === 'knuth84')!;
    expect(knuth.detail).toBe('Knuth, 1984');
    expect(knuth.info).toBe('Literate Programming\nDonald E. Knuth\narticle, 1984');
    const web = result!.options.find((o) => o.label === 'web')!;
    expect(web.detail).toBe('online');
    expect(result!.options.find((o) => o.label === 'lamport94')!.detail).toBe('Lamport et al., 1994');
  });

  it.each(['\\citep{', '\\citet[p.~4]{', '\\parencite[see][12]{', '\\textcite{', '\\autocite{', '\\Citeauthor{', '\\footcite{', '\\nocite{', '\\cite{a,'])('works after %s', (command) => {
    expect(complete(citationSource(get), `${command}|`)?.options.length).toBeGreaterThan(0);
  });

  it('falls back to the path when an entry has nothing to show', () => {
    const bare = projectWith({ 'main.tex': '', 'x.bib': '@misc{k,}' });
    expect(complete(citationSource(bare.get), '\\cite{|')?.options[0]).toMatchObject({ detail: 'misc', info: 'x.bib' });
  });

  it('updates when a .bib file is edited', () => {
    const id = project.findByPath('more/other.bib')!.id;
    project.getText(id).insert(0, '@book{fresh, title={New}}\n');
    expect(labels(complete(citationSource(get), '\\cite{|'))).toContain('fresh');
  });

  it('does nothing outside a cite command', () => {
    expect(complete(citationSource(get), '\\ref{|')).toBeNull();
    expect(complete(citationSource(() => null), '\\cite{|')).toBeNull();
  });
});

describe('pathSource', () => {
  const tree = {
    'src/main.tex': '\\documentclass{article}',
    'src/chapters/one.tex': '',
    'shared/macros.tex': '',
    'src/refs.bib': '',
    'src/img/plot.png': '',
    'src/img/fig.pdf': '',
    'src/empty': '/',
    'src/readme.md': '',
  };
  const { get, project } = projectWith(tree, 'src/main.tex');
  const paths = (text: string) => labels(complete(pathSource(get), text));

  it('offers .tex files relative to the main file for \\input, without the main file', () => {
    expect(paths('\\input{|}')).toEqual(['../shared/macros.tex', 'chapters/one.tex']);
  });

  it('leaves off .tex for \\include', () => {
    expect(paths('\\include{|')).toEqual(['../shared/macros', 'chapters/one']);
  });

  it('offers images for \\includegraphics, after its options', () => {
    expect(paths('\\includegraphics[width=\\linewidth]{im|}')).toEqual(['img/fig.pdf', 'img/plot.png']);
  });

  it('offers .bib files: without .bib for \\bibliography, with it for \\addbibresource', () => {
    expect(paths('\\bibliography{a,|')).toEqual(['refs']);
    expect(paths('\\addbibresource{|')).toEqual(['refs.bib']);
  });

  it('follows files as they are added', () => {
    project.createTextFile('src/chapters/two.tex');
    expect(paths('\\input{|')).toContain('chapters/two.tex');
  });

  it('is relative to the project root without a main file', () => {
    const none: CompletionProject = { version: () => 0, files: () => [{ path: 'a/b.tex', kind: 'text', text: () => '' }], mainPath: () => null };
    expect(labels(complete(pathSource(() => none), '\\input{|'))).toEqual(['a/b.tex']);
  });

  it('does nothing outside a path command', () => {
    expect(complete(pathSource(get), '\\inputs{|')).toBeNull();
    expect(complete(pathSource(() => null), '\\input{|')).toBeNull();
  });
});

describe('completionProjectFrom', () => {
  it('counts updates from peers, and stops counting once disposed', () => {
    const { doc, completion } = projectWith({ 'main.tex': '\\label{a}' });
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const peerProject = new ProjectDoc(peer);
    const before = completion.version();
    peerProject.createTextFile('peer.tex', '\\label{from-peer}');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)));
    expect(completion.version()).toBeGreaterThan(before);
    expect(labels(complete(labelSource(() => completion), '\\ref{|'))).toContain('from-peer');
    expect(completion.mainPath()).toBe('main.tex');
    completion.dispose();
    const after = completion.version();
    peerProject.createTextFile('late.tex');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)));
    expect(completion.version()).toBe(after);
  });

  it('picks up a package and a command a peer adds', () => {
    const { doc, completion } = projectWith({ 'main.tex': '\\documentclass{article}' });
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const peerProject = new ProjectDoc(peer);
    expect(projectIndex(completion).packages().has('amsmath')).toBe(false);
    peerProject.createTextFile('defs.tex', '\\usepackage{amsmath}\n\\newcommand{\\peer}{}');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)));
    expect(projectIndex(completion).packages().has('amsmath')).toBe(true);
    expect(projectIndex(completion).definitions().map((d) => d.name)).toEqual(['peer']);
  });

  it('has no main path for a project without .tex files', () => {
    expect(projectWith({ 'notes.md': '' }, 'none').completion.mainPath()).toBeNull();
  });
});

describe('latexCompletionExtensions', () => {
  it('takes a project getter', () => {
    expect(latexCompletionExtensions(undefined, () => null)).toBeTruthy();
  });
});
