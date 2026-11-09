import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { adaptLatexSourceForLatexJs } from './latexJsAdapt';
import { latexSourceToPreviewHtml } from './latexJsPreview';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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

  it('allows repository example.tex to preview without parse errors', () => {
    const tex = readFileSync(join(rootDir, 'example.tex'), 'utf8');
    const { html, errors } = latexSourceToPreviewHtml(tex);
    expect(errors).toEqual([]);
    expect(html).toBeTruthy();
    expect(html).toContain('Crimson Comet');
  });
});
