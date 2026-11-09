import { expandProjectSource, parseBib } from './projectSource';
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
    expect(out.images.get('lcimg1')).toEqual({ path: 'figures/plot.png', widthPercent: 50 });
    expect(out.missing).toEqual(['gone.png']);
  });

  it('numbers citations and builds a reference list from .bib files', () => {
    const texts = files({
      'main.tex': 'See \\cite{knuth,lamport} and \\citep[p.~2]{knuth}, \\cite{nope}.\n\\bibliographystyle{plain}\n\\bibliography{refs,missing}',
      'refs.bib': '@book{knuth, author = {Donald Knuth}, title = {The {TeX}book}, year = 1984}\n@article{lamport, author = "Leslie Lamport", title = "LaTeX", journal = {J}, year = {1986}}\n@comment{skip}',
    });
    const out = expandProjectSource('main.tex', texts, []);
    const lines = out.source.split('\n');
    expect(lines[0]).toBe('See [1, 2] and [1], [?].');
    expect(lines[1]).toBe('');
    expect(lines[2]).toContain('\\section*{References}');
    expect(lines[2]).toContain('[1] Donald Knuth. \\textit{The TeXbook}. 1984.');
    expect(lines[2]).toContain('[2] Leslie Lamport. \\textit{LaTeX}. J. 1986.');
    expect(out.missing).toEqual(['missing.bib']);
  });

  it('leaves the source alone without \\bibliography', () => {
    const out = expandProjectSource('main.tex', files({ 'main.tex': '\\cite{a}' }), []);
    expect(out.source).toBe('\\cite{a}');
  });
});

describe('parseBib', () => {
  it('reads braced, quoted and bare fields', () => {
    expect(parseBib('@misc{k, title={A {B} C}, note="q", year=2020,\n month = jan}')).toEqual([
      { key: 'k', fields: { title: 'A B C', note: 'q', year: '2020', month: 'jan' } },
    ]);
  });
});

describe('projectToPreviewHtml', () => {
  it('puts project images into the preview and maps errors to their file', () => {
    const texts = files({
      'main.tex': '\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n\\input{body}\n\\end{document}',
      'body.tex': 'Hello\n\\includegraphics[width=\\textwidth]{a.png}\n\\includegraphics{late.png}',
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
