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

  it('previews a typical academic paper without parse errors', () => {
    const { html, errors } = latexSourceToPreviewHtml(academicPaperTex);
    expect(errors).toEqual([]);
    expect(html).toBeTruthy();
    expect(html).toContain('Crimson Comet');
  });
});
