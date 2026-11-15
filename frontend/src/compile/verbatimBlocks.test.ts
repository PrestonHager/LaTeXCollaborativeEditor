import { latexSourceToPreviewHtml, projectToPreviewHtml } from './latexJsPreview';
import { extractVerbatim, insertVerbatimBlocks, LISTING_CLASS, LISTING_STYLE_ID, parseOptions } from './verbatimBlocks';

const doc = (body: string, preamble = '') => `\\documentclass{article}${preamble}\n\\begin{document}\n${body}\n\\end{document}`;

function render(source: string) {
  const result = latexSourceToPreviewHtml(source);
  // Info notes, like the one for \usepackage{listings}, are fine. Nothing worse is.
  expect(result.errors.filter((e) => e.severity !== 'info')).toEqual([]);
  return { ...result, dom: new DOMParser().parseFromString(result.html!, 'text/html') };
}

const SPECIALS = String.raw`\ { } % $ & # ^ _ ~ <b>&amp;</b>`;

describe('verbatim environments', () => {
  it('shows verbatim text exactly, with whitespace, tabs and special characters', () => {
    const body = `  if (a) {\n\tx = 1;   % not a comment\n  }\n${SPECIALS}`;
    const { dom, changes, html } = render(doc(`Before\n\\begin{verbatim}\n${body}\n\\end{verbatim}\nAfter`));
    const pre = dom.querySelector(`pre.${LISTING_CLASS}`)!;
    expect(pre.textContent).toBe(body);
    expect(pre.querySelector('b')).toBeNull();
    expect(html).not.toContain('<b>');
    expect(pre.parentElement?.tagName).not.toBe('P');
    expect(dom.body.textContent).toContain('Before');
    expect(dom.body.textContent).toContain('After');
    expect(dom.body.textContent).not.toContain('lcverb');
    expect(dom.getElementById(LISTING_STYLE_ID)).not.toBeNull();
    // Plain verbatim looks like it does in LaTeX, so there's nothing to report.
    expect(changes).toEqual([]);
  });

  it('shows spaces in verbatim* and \\verb*', () => {
    const { dom } = render(doc('\\begin{verbatim*}\na b\n\\end{verbatim*}\n\\verb*|c d| and \\verb|e  f|'));
    expect(dom.querySelector('pre')!.textContent).toBe('a\u2423b');
    const inline = Array.from(dom.querySelectorAll('code.lc-verb')).map((c) => c.textContent);
    expect(inline).toEqual(['c\u2423d', 'e  f']);
  });

  it('keeps \\verb text exactly, with any delimiter, and leaves it inline', () => {
    const { dom } = render(doc(String.raw`A \verb|\section{x} % $ & # ^ _ ~| B \verb+a|b+ C.`));
    const codes = Array.from(dom.querySelectorAll('code.lc-verb'));
    expect(codes.map((c) => c.textContent)).toEqual([String.raw`\section{x} % $ & # ^ _ ~`, 'a|b']);
    expect(codes[0].closest('p')?.textContent).toContain('A ');
    expect(dom.querySelector('h2')).toBeNull();
  });

  it('does not touch \\input, \\cite or commands inside verbatim', () => {
    const texts = new Map([
      ['main.tex', doc('\\begin{verbatim}\n\\input{other} \\cite{k} \\includegraphics{x}\n\\end{verbatim}\nSee \\cite{k}.\n\\bibliography{refs}', '')],
      ['other.tex', 'OTHER'],
      ['refs.bib', '@misc{k, title={T}, author={A. B}, year={2000}}'],
    ]);
    const result = projectToPreviewHtml({ mainPath: 'main.tex', texts, binaryPaths: [], imageUrls: new Map() });
    expect(result.errors).toEqual([]);
    const dom = new DOMParser().parseFromString(result.html!, 'text/html');
    expect(dom.querySelector('pre')!.textContent).toBe('\\input{other} \\cite{k} \\includegraphics{x}');
    expect(dom.body.textContent).not.toContain('OTHER');
    expect(dom.body.textContent).toContain('See [1].');
  });

  it('keeps line numbers of errors after a block', () => {
    const { errors } = latexSourceToPreviewHtml(doc('\\begin{verbatim}\na\nb\nc\n\\end{verbatim}\n\\unknownmacro'));
    expect(errors[0].line).toBe(8);
  });

  it('ignores a verbatim block that is commented out, and leaves one with no \\end for LaTeX.js to report', () => {
    const { dom } = render(doc('% \\begin{verbatim}\nText'));
    expect(dom.querySelector('pre')).toBeNull();
    expect(latexSourceToPreviewHtml(doc('\\begin{verbatim}\nx')).errors).not.toEqual([]);
  });

  it('hides the comment environment and shows fancyvrb Verbatim with line numbers', () => {
    const { dom } = render(doc('\\begin{comment}\nhidden\n\\end{comment}\n\\begin{Verbatim}[numbers=left,firstnumber=5]\nx\ny\n\\end{Verbatim}'));
    expect(dom.body.textContent).not.toContain('hidden');
    const numbers = Array.from(dom.querySelectorAll('pre .lc-ln')).map((n) => n.getAttribute('data-n'));
    expect(numbers).toEqual(['5', '6']);
    expect(dom.querySelector('pre')!.textContent).toBe('x\ny');
  });

  it('shows alltt as monospaced text that still runs commands', () => {
    const { dom, changes } = render(doc('\\begin{alltt}\na  \\textbf{b} $ & # ^ _ ~ %\n\nc\n\\end{alltt}'));
    expect(dom.querySelector('.bf')?.textContent).toBe('b');
    expect(dom.body.textContent).toContain('a\u00a0\u00a0b\u00a0$\u00a0&\u00a0#\u00a0^');
    expect(dom.body.textContent).toContain('~\u00a0%');
    expect(changes).toContain('Showed alltt as monospaced text.');
  });
});

describe('listings and minted', () => {
  it('reads lstlisting options: language, caption, label, numbers, firstline and lastline', () => {
    const source = doc(
      [
        'See Listing~\\ref{lst:a}.',
        '\\begin{lstlisting}[language=Python, caption={Sum, with $x_i$}, label=lst:a, numbers=left, firstline=2, lastline=3, basicstyle=\\ttfamily\\small]',
        'skip',
        'def f(x):',
        '\treturn {x} % 2',
        'skip too',
        '\\end{lstlisting}',
      ].join('\n'),
      '\\usepackage{listings}\n\\lstset{basicstyle=\\ttfamily, breaklines=true}',
    );
    const { dom, changes } = render(source);
    const pre = dom.querySelector('pre')!;
    expect(pre.textContent).toBe('def f(x):\n\treturn {x} % 2');
    expect(pre.getAttribute('data-language')).toBe('python');
    expect(Array.from(pre.querySelectorAll('.lc-ln')).map((n) => n.getAttribute('data-n'))).toEqual(['2', '3']);
    const caption = pre.previousElementSibling!;
    expect(caption.textContent).toContain('Listing 1: Sum, with');
    expect(caption.querySelector('.katex')).not.toBeNull();
    const ref = dom.querySelector('a[href^="#lclisting"]')!;
    expect(ref.textContent).toBe('1');
    expect(dom.getElementById(ref.getAttribute('href')!.slice(1))).not.toBeNull();
    expect(changes).toEqual([
      'Showed code listings as plain text, without syntax highlighting or style options.',
      'Removed listings, minted and fancyvrb setup commands.',
      "Removed packages the preview can't load: listings.",
    ]);
  });

  it('applies \\lstset defaults and numbers captions in order', () => {
    const body = '\\begin{lstlisting}[caption=One]\na\n\\end{lstlisting}\n\\begin{lstlisting}[title=Plain title,label={lst:b}]\nb\n\\end{lstlisting}\n\\begin{lstlisting}[caption=Two,numbers=none]\nc\n\\end{lstlisting}';
    const { dom } = render(doc(body, '\\lstset{numbers=left}'));
    const pres = Array.from(dom.querySelectorAll('pre'));
    expect(pres.map((p) => p.querySelectorAll('.lc-ln').length)).toEqual([1, 1, 0]);
    expect(dom.body.textContent).toContain('Listing 1: One');
    expect(dom.body.textContent).toContain('Plain title');
    expect(dom.body.textContent).toContain('Listing 2: Two');
  });

  it('shows \\lstinline in either form', () => {
    const { dom } = render(doc('Call \\lstinline[language=C]!printf("%d\\n", x);! or \\lstinline{a{b}c}.'));
    const codes = Array.from(dom.querySelectorAll('code.lc-verb'));
    expect(codes.map((c) => c.textContent)).toEqual(['printf("%d\\n", x);', 'a{b}c']);
    expect(codes[0].getAttribute('data-language')).toBe('c');
  });

  it('reads \\lstinputlisting and \\inputminted from the project, and lists missing files', () => {
    const texts = new Map([
      ['paper/main.tex', doc('\\lstinputlisting[firstline=2,caption=Code]{code/a.py}\n\\inputminted{rust}{code/b.rs}\n\\lstinputlisting{nope.c}', '\\usepackage{minted}')],
      ['paper/code/a.py', 'one\n  two <script>\nthree\n'],
      ['code/b.rs', 'fn main() {}\n'],
    ]);
    const result = projectToPreviewHtml({ mainPath: 'paper/main.tex', texts, binaryPaths: [], imageUrls: new Map() });
    expect(result.errors).toEqual([
      { path: 'paper/main.tex', line: 1, severity: 'info', message: 'The preview uses a stand-in for the minted package. Code shows in plain code blocks.' },
    ]);
    expect(result.missing).toEqual(['nope.c']);
    const dom = new DOMParser().parseFromString(result.html!, 'text/html');
    const pres = Array.from(dom.querySelectorAll('pre'));
    expect(pres.map((p) => p.textContent)).toEqual(['  two <script>\nthree', 'fn main() {}']);
    expect(pres[1].getAttribute('data-language')).toBe('rust');
    expect(dom.body.querySelector('script')).toBeNull();
    expect(dom.body.textContent).toMatch(/Listing .{1,4}le nope\.c isn.t in the project\./);
  });

  it('shows minted, \\mintinline, newminted environments and the listing float with a caption', () => {
    const body = [
      '\\begin{listing}[H]',
      '\\begin{minted}[linenos, firstnumber=10, autogobble]{python}',
      '    x = "a b"',
      '      y = 2',
      '\\end{minted}',
      '\\caption{Example}\\label{lst:m}',
      '\\end{listing}',
      'Inline \\mintinline{js}|let a = {};| and \\mintinline{c}{int b;}.',
      '\\begin{pycode}',
      'print(1)',
      '\\end{pycode}',
      '\\begin{shcode*}{linenos}',
      'ls',
      '\\end{shcode*}',
      'Ref \\ref{lst:m}.',
    ].join('\n');
    const { dom } = render(doc(body, '\\usepackage{minted}\n\\setminted{fontsize=\\small}\n\\usemintedstyle{monokai}\n\\newminted[pycode]{python}{}\n\\newminted{sh}{}'));
    const pres = Array.from(dom.querySelectorAll('pre'));
    expect(pres.map((p) => p.textContent)).toEqual(['x = "a b"\n  y = 2', 'print(1)', 'ls']);
    expect(pres.map((p) => p.getAttribute('data-language'))).toEqual(['python', 'python', 'sh']);
    expect(pres[0].querySelector('.lc-ln')?.getAttribute('data-n')).toBe('10');
    expect(pres[2].querySelectorAll('.lc-ln')).toHaveLength(1);
    expect(dom.body.textContent).toContain('Listing 1: Example');
    expect(dom.querySelector('a[href="#lclisting-1"]')?.textContent).toBe('1');
    expect(Array.from(dom.querySelectorAll('code.lc-verb')).map((c) => c.textContent)).toEqual(['let a = {};', 'int b;']);
  });

  it('shows custom environments from \\lstnewenvironment, \\DefineVerbatimEnvironment and \\newenvironment', () => {
    const preamble = [
      '\\lstnewenvironment{py}[1][]{\\lstset{language=Python,#1}}{}',
      '\\DefineVerbatimEnvironment{Code}{Verbatim}{numbers=left}',
      '\\newenvironment{plain}{\\verbatim}{\\endverbatim}',
    ].join('\n');
    const { dom } = render(doc('\\begin{py}[caption=Py]\na\n\\end{py}\n\\begin{Code}\nb\n\\end{Code}\n\\begin{plain}\nc\n\\end{plain}', preamble));
    expect(Array.from(dom.querySelectorAll('pre')).map((p) => p.textContent)).toEqual(['a', 'b', 'c']);
    expect(dom.body.textContent).toContain('Listing 1: Py');
  });
});

describe('helpers', () => {
  it('parses key=value options with braces', () => {
    expect([...parseOptions('a=1, b={x, y}, c, ,d = {z}')]).toEqual([
      ['a', '1'],
      ['b', 'x, y'],
      ['c', 'true'],
      ['d', 'z'],
    ]);
  });

  it('leaves \\usepackage lines to the adapter, which says what it removed', () => {
    const source = '\\usepackage{listings}\n\\usepackage[newfloat]{minted}\n\\begin{document}\\verb|x|\\end{document}';
    const { texts } = extractVerbatim('main.tex', new Map([['main.tex', source]]));
    expect(texts.get('main.tex')).toMatch(/^\\usepackage\{listings\}\n\\usepackage\[newfloat\]\{minted\}\n/);
  });

  it('returns the files unchanged when nothing is verbatim', () => {
    const texts = new Map([['main.tex', 'Hello']]);
    expect(extractVerbatim('main.tex', texts)).toEqual({ texts, blocks: [], changes: [], missing: [] });
  });

  it('does nothing to a document without tokens', () => {
    const dom = new DOMParser().parseFromString('<p>x</p>', 'text/html');
    insertVerbatimBlocks(dom, []);
    expect(dom.getElementById(LISTING_STYLE_ID)).toBeNull();
  });
});
