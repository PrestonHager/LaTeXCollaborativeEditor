import { expandProjectSource } from './projectSource';
import { projectToPreviewHtml } from './latexJsPreview';

const files = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe('expandProjectSource', () => {
  it('inlines \\input and \\include files and maps lines back to their files', () => {
    const texts = files({
      'main.tex': 'A\nbefore \\input{chapters/intro} after\n% \\input{ignored}\n\\include{chapters/end.tex}\nZ',
      'chapters/intro.tex': 'intro 1\nintro 2',
      'chapters/end.tex': 'end',
    });
    const out = expandProjectSource('main.tex', texts, []);
    expect(out.source.split('\n')).toEqual(['A', 'before ', 'intro 1', 'intro 2', ' after', '% \\input{ignored}', '', 'end', '', 'Z']);
    expect(out.lineMap[2]).toEqual({ path: 'chapters/intro.tex', line: 1 });
    expect(out.lineMap[4]).toEqual({ path: 'main.tex', line: 2 });
    expect(out.lineMap[9]).toEqual({ path: 'main.tex', line: 5 });
    expect(out.missing).toEqual([]);
  });

  it('skips missing files and loops', () => {
    const texts = files({ 'main.tex': '\\input{a}\\input{nope}', 'a.tex': '\\input{a}x' });
    const out = expandProjectSource('main.tex', texts, []);
    expect(out.source).toBe('\nx\n');
    expect(out.missing).toEqual(['nope']);
  });

  it('swaps project images for tokens, with \\graphicspath and widths', () => {
    const texts = files({
      'main.tex': '\\graphicspath{{figures/}}\n\\includegraphics[width=0.5\\textwidth]{plot}\n\\includegraphics{diagram.pdf}\n\\includegraphics{gone.png}',
    });
    const out = expandProjectSource('main.tex', texts, ['figures/plot.png', 'diagram.pdf']);
    expect(out.source.split('\n')).toEqual(['', '\\includegraphics[]{lcimg1}', '\\includegraphics{diagram.pdf}', '\\includegraphics{gone.png}']);
    expect(out.images.get('lcimg1')).toEqual({ path: 'figures/plot.png', style: 'max-width:100%;width:50%;' });
    expect(out.missing).toEqual(['gone.png']);
  });

  it('numbers citations and builds a reference list from .bib files', () => {
    const texts = files({
      'main.tex': 'See \\cite{knuth,lamport} and \\citep[p.~2]{knuth}, \\cite{nope}.\n\\bibliographystyle{plain}\n\\bibliography{refs,missing}',
      'refs.bib': '@book{knuth, author = {Donald Knuth}, title = {The {TeX}book}, year = 1984}\n@article{lamport, author = "Leslie Lamport", title = "LaTeX", journal = {J}, year = {1986}}\n@comment{skip}',
    });
    const out = expandProjectSource('main.tex', texts, []);
    const lines = out.source.split('\n');
    expect(lines[0]).toBe('See [1, 2] and [1, p.~2], [?].');
    expect(lines[1]).toBe('');
    expect(lines[2]).toContain('\\section*{References}');
    expect(lines[2]).toContain('\\noindent [1] Donald Knuth. \\emph{The {TeX}book}. 1984.\\par');
    expect(lines[2]).toContain('\\noindent [2] Leslie Lamport. Latex. \\emph{J}, 1986.\\par');
    expect(out.missing).toEqual(['missing.bib']);
    // A .bib is missing, so the unknown key isn't reported on its own.
    expect(out.diagnostics).toEqual([]);
  });

  it('leaves the source alone without \\bibliography', () => {
    const out = expandProjectSource('main.tex', files({ 'main.tex': '\\cite{a}' }), []);
    expect(out.source).toBe('\\cite{a}');
    expect(out.diagnostics).toEqual([]);
  });

  const bib = [
    '@book{knuth, author = {Donald E. Knuth}, title = {The TeXbook}, publisher = {Addison-Wesley}, year = 1984}',
    '@book{lamport, author = {Leslie Lamport}, title = {LaTeX}, publisher = {Addison-Wesley}, year = 1994}',
    '@article{zed, author = {Ann Zed and Bo Young}, title = {Last Article}, journal = {J}, year = 1984}',
  ].join('\n');

  it('follows \\bibliographystyle for order and labels', () => {
    const main = (style: string) => `\\cite{zed} \\cite{knuth}\n\\bibliographystyle{${style}}\n\\bibliography{refs}`;
    const run = (style: string) => expandProjectSource('main.tex', files({ 'main.tex': main(style), 'refs.bib': bib }), []).source.split('\n');
    expect(run('plain')[0]).toBe('[2] [1]');
    expect(run('unsrt')[0]).toBe('[1] [2]');
    expect(run('unsrt')[2]).toMatch(/\[1\] Ann Zed and Bo Young\. Last article\..*\[2\] Donald E\. Knuth\./);
    expect(run('alpha')[0]).toBe('[ZY84] [Knu84]');
    expect(run('abbrv')[2]).toContain('[1] D.~E. Knuth.');
    expect(run('ieeetr')[2]).toContain("[1] A. Zed and B. Young, ``Last article,'' \\emph{J}, 1984.");
    expect(run('apalike')[0]).toBe('[Zed and Young, 1984] [Knuth, 1984]');
    expect(run('apalike')[2]).toContain('\\noindent Knuth, D. E. (1984). \\emph{The TeXbook}. Addison-Wesley.\\par');
  });

  it('falls back to plain for an unknown style, with an info note on its line', () => {
    const texts = files({ 'main.tex': '\\input{body}\n\\bibliographystyle{fancy}\n\\bibliography{refs}', 'body.tex': 'x\n\\cite{knuth,ghost}', 'refs.bib': bib });
    const out = expandProjectSource('main.tex', texts, []);
    expect(out.source.split('\n')[2]).toBe('[1, ?]');
    expect(out.diagnostics).toEqual([
      { path: 'body.tex', line: 2, severity: 'warning', message: 'Citation "ghost" isn\'t in the bibliography.' },
      expect.objectContaining({ path: 'main.tex', line: 2, severity: 'info', message: expect.stringContaining('"fancy"') }),
    ]);
  });

  it('handles natbib and biblatex cite commands, \\nocite and \\printbibliography', () => {
    const texts = files({
      'main.tex': [
        '\\usepackage[style=authoryear]{biblatex}',
        '\\addbibresource{refs.bib}',
        '\\textcite[p.~5]{knuth} and \\parencite[see][]{lamport,knuth}.',
        '\\citeauthor{zed}, \\citeyear{zed}, \\citealp{zed}, \\citealt{zed}, \\Citet{zed}. % \\nocite{*}',
        '\\nocite{zed}',
        '\\printbibliography',
      ].join('\n'),
      'refs.bib': bib,
    });
    const lines = expandProjectSource('main.tex', texts, []).source.split('\n');
    expect(lines[0]).toBe('\\usepackage[style=authoryear]{biblatex}');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('Knuth (1984, p.~5) and (see Lamport, 1994; Knuth, 1984).');
    expect(lines[3]).toBe('Zed and Young, 1984, Zed and Young, 1984, Zed and Young 1984, Zed and Young (1984). % \\nocite{*}');
    expect(lines[4]).toBe('');
    expect(lines[5]).toMatch(/^\\section\*\{References\} \\noindent Knuth.*\\noindent Lamport.*\\noindent Zed/);
  });

  it('numbers natbib styles with the numbers option, and \\nocite{*} lists every entry', () => {
    const texts = files({
      'main.tex': '\\usepackage[numbers]{natbib}\n\\citet{lamport} \\citep{knuth}\\nocite{*}\n\\bibliographystyle{unsrtnat}\n\\bibliography{refs}',
      'refs.bib': bib,
    });
    const lines = expandProjectSource('main.tex', texts, []).source.split('\n');
    expect(lines[1]).toBe('Lamport [1] [2]');
    expect(lines[3]).toContain('[3] Ann Zed');
  });

  it('maps biblatex style options and finds the .bib next to the main file', () => {
    const run = (options: string) =>
      expandProjectSource(
        'paper/main.tex',
        files({ 'paper/main.tex': `\\usepackage[${options}]{biblatex}\n\\addbibresource{refs.bib}\n\\cite{zed,knuth}`, 'paper/refs.bib': bib }),
        [],
      ).source.split('\n')[2];
    expect(run('style=alphabetic')).toBe('[ZY84, Knu84]');
    expect(run('style=numeric')).toBe('[2, 1]');
    expect(run('style=numeric,sorting=none')).toBe('[1, 2]');
    expect(run('backend=biber')).toBe('[2, 1]');
  });
});

describe('projectToPreviewHtml', () => {
  it('puts project images into the preview and maps errors to their file', () => {
    const texts = files({
      'main.tex': '\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n\\input{body}\n\\end{document}',
      'body.tex': 'Hello\n\\includegraphics[width=\\textwidth]{a.png}\n\\includegraphics[width=3cm]{late.png}',
    });
    const result = projectToPreviewHtml({
      mainPath: 'main.tex',
      texts,
      binaryPaths: ['a.png', 'late.png'],
      imageUrls: new Map([['a.png', 'data:image/png;base64,AAAA']]),
    });
    expect(result.errors).toEqual([]);
    const doc = new DOMParser().parseFromString(result.html!, 'text/html');
    const images = Array.from(doc.querySelectorAll('img'));
    expect(images[0].getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(images[0].getAttribute('style')).toContain('width:100%');
    expect(images[1].hasAttribute('src')).toBe(false);
    expect(images[1].getAttribute('alt')).toBe('late.png');
    expect(images[1].getAttribute('style')).toBe('max-width:100%;width:3cm;');
  });

  it('points an error in an \\input file at that file', () => {
    const texts = files({
      'main.tex': '\\documentclass{article}\n\\begin{document}\n\\input{body}\n\\end{document}',
      'body.tex': 'fine\n\\begin{itemize}',
    });
    const result = projectToPreviewHtml({ mainPath: 'main.tex', texts, binaryPaths: [], imageUrls: new Map() });
    expect(result.html).toBeNull();
    expect(result.errors[0].path).toBeTruthy();
  });
});
