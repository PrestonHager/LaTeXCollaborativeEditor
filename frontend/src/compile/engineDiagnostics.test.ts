import { engineDiagnostics } from './engineDiagnostics';
import { projectToPreviewHtml } from './latexJsPreview';

const lines = (source: string, path = 'main.tex') => source.split('\n').map((_, index) => ({ path, line: index + 1 }));

describe('engine diagnostics (#199)', () => {
  it('warns about fontspec under pdfLaTeX, on the line that loads it', () => {
    const source = '\\documentclass{article}\n\\usepackage[no-math]{fontspec}\n';
    const found = engineDiagnostics('main.tex', source, undefined, source, lines(source));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ path: 'main.tex', line: 2, severity: 'warning' });
    expect(found[0].message).toContain('pdfLaTeX');
  });

  it('expects fontspec under XeLaTeX, from the setting or a magic comment', () => {
    const source = '\\documentclass{article}\n\\usepackage{fontspec}\n';
    expect(engineDiagnostics('main.tex', source, 'xelatex', source, lines(source))).toEqual([]);
    const magic = `% !TEX program = lualatex\n${source}`;
    expect(engineDiagnostics('main.tex', magic, undefined, magic, lines(magic))).toEqual([]);
  });

  it('skips commented-out packages, keeps \\% text, and reports each package once', () => {
    const source = '% \\usepackage{fontspec}\n50\\% \\usepackage{luacode,fontspec}\n\\RequirePackage{fontspec}\n';
    const found = engineDiagnostics('main.tex', source, 'pdflatex', source, lines(source));
    expect(found.map((d) => [d.line, d.message.split(' ')[1]])).toEqual([
      [2, 'luacode'],
      [2, 'fontspec'],
    ]);
  });

  it('flags a program it does not know, and maps lines back through \\input', () => {
    const main = '% !TEX program = context\n\\input{preamble}\n';
    const found = engineDiagnostics('main.tex', main, undefined, '\\usepackage{fontspec}', [{ path: 'preamble.tex', line: 4 }]);
    expect(found[0]).toMatchObject({ path: 'main.tex', line: 1, severity: 'warning' });
    expect(found[0].message).toContain('"context"');
    expect(found[1]).toMatchObject({ path: 'preamble.tex', line: 4 });
    // No line map entry falls back to the main file.
    expect(engineDiagnostics('main.tex', undefined, undefined, '\\usepackage{fontspec}', [])[0]).toMatchObject({ path: 'main.tex', line: 1 });
  });

  it('comes through projectToPreviewHtml with the engine from the input', () => {
    const texts = new Map([['main.tex', '\\documentclass{article}\n\\usepackage{fontspec}\n\\begin{document}\nHi\n\\end{document}\n']]);
    const input = { mainPath: 'main.tex', texts, binaryPaths: [], imageUrls: new Map() };
    const underPdf = projectToPreviewHtml(input).errors.filter((e) => e.message.includes('needs XeLaTeX'));
    expect(underPdf).toHaveLength(1);
    expect(projectToPreviewHtml({ ...input, engine: 'xelatex' }).errors.filter((e) => e.message.includes('needs XeLaTeX'))).toEqual([]);
  });
});
