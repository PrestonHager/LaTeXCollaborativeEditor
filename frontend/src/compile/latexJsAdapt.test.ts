import { adaptLatexSourceForLatexJs } from './latexJsAdapt';
import { latexSourceToPreviewHtml } from './latexJsPreview';
// A made-up paper that uses every package and command the adapter handles.
import academicPaperTex from './__fixtures__/academic-paper.tex?raw';

describe('adaptLatexSourceForLatexJs', () => {
  it('strips unsupported packages and expands nomenclature for LaTeX.js', () => {
    const src = [
      '\\documentclass{article}',
      '\\usepackage{fontspec}',
      '\\usepackage{graphicx}',
      '\\begin{document}',
      'See \\nomenclature{$x$}{explanation}.',
      '\\end{document}',
    ].join('\n');
    const out = adaptLatexSourceForLatexJs(src);
    expect(out).not.toContain('fontspec');
    expect(out).toContain('See $x$.');
  });

  it('keeps the same number of lines as the original source', () => {
    const src = [
      '\\documentclass{article}',
      '',
      '\\usepackage{geometry}',
      '\\hypersetup{',
      '  colorlinks=true',
      '}',
      '\\pagestyle{fancy}',
      '\\author[1]',
      '{Ada}',
      '\\affil[1]{Somewhere}',
      '\\begin{document}',
      '\\begin{figure}',
      '  [H]',
      '\\caption',
      '{A cat}',
      '\\end{figure}',
      'Text\\footnote',
      '{note}\\vspace{1em',
      '}\\nomenclature',
      '{$x$}',
      '{explanation}',
      '\\printnomenclature',
      '',
      '\\end{document}',
    ].join('\n');
    const out = adaptLatexSourceForLatexJs(src);
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
    expect(out.split('\n').at(-1)).toBe('\\end{document}');
  });

  it('keeps the line count of the academic paper fixture', () => {
    const out = adaptLatexSourceForLatexJs(academicPaperTex);
    expect(out.split('\n')).toHaveLength(academicPaperTex.split(/\r?\n/).length);
  });

  it('reports errors on the original line after stripping a package above them', () => {
    const src = [
      '\\documentclass{article}',
      '\\usepackage{geometry}',
      '\\usepackage{fontspec}',
      '\\makenomenclature',
      '\\begin{document}',
      'Hello.',
      '\\invalidtokenalone',
      '\\end{document}',
    ].join('\n');
    const { html, errors } = latexSourceToPreviewHtml(src);
    expect(html).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(7);
  });

  it('previews a typical academic paper without parse errors', () => {
    const { html, errors } = latexSourceToPreviewHtml(academicPaperTex);
    expect(errors).toEqual([]);
    expect(html).toBeTruthy();
    expect(html).toContain('Crimson Comet');
  });
});
