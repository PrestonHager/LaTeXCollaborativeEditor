import { MAX_LOG_DIAGNOSTICS, parseTexLog, projectPathFromLog, sortDiagnostics } from './texLog';

const projectPaths = new Set(['main.tex', 'chapters/intro.tex', 'refs.bib']);
const parse = (log: string) => parseTexLog(log, { mainPath: 'main.tex', projectPaths });

describe('TeX log diagnostics (#242)', () => {
  it('maps log paths to project files', () => {
    expect(projectPathFromLog('./chapters/intro.tex', projectPaths)).toBe('chapters/intro.tex');
    expect(projectPathFromLog('"chapters/intro"', projectPaths)).toBe('chapters/intro.tex');
    expect(projectPathFromLog('/texlive/2026/texmf-dist/tex/latex/base/article.cls', projectPaths)).toBeNull();
  });

  it('places an error in the file that was open, on its l. line', () => {
    const log = [
      'This is pdfTeX, Version 3.141592653',
      '(./main.tex (/texlive/tex/latex/base/article.cls',
      'Document Class: article) (./chapters/intro.tex',
      '! Undefined control sequence.',
      'l.7 \\foo',
      '        {bar}',
      ')',
      '! Missing $ inserted.',
      '<inserted text>',
      'l.20 x^',
      ')',
    ].join('\n');
    expect(parse(log)).toEqual([
      { path: 'chapters/intro.tex', line: 7, severity: 'error', message: 'Undefined control sequence. (at \\foo)' },
      { path: 'main.tex', line: 20, severity: 'error', message: 'Missing $ inserted. (at x^)' },
    ]);
  });

  it('reads file:line:error style, and puts outside files on the main file', () => {
    expect(parse('./chapters/intro.tex:12: Undefined control sequence.\n/texlive/x.sty:3: Oops')).toEqual([
      { path: 'chapters/intro.tex', line: 12, severity: 'error', message: 'Undefined control sequence.' },
      { path: 'main.tex', line: 1, severity: 'error', message: 'Oops' },
    ]);
  });

  it('reads warnings with their continuation lines, and boxes as info', () => {
    const log = [
      '(./main.tex',
      "LaTeX Warning: Reference `fig:x' on page 1 undefined on input line 14.",
      'Package natbib Warning: Citation `knuth84\' on page 1 undefined on input',
      '(natbib)                line 22.',
      'Overfull \\hbox (12.3pt too wide) in paragraph at lines 30--32',
      'Underfull \\vbox (badness 10000) has occurred while \\output is active',
      ')',
    ].join('\n');
    expect(parse(log)).toEqual([
      { path: 'main.tex', line: 14, severity: 'warning', message: "Reference `fig:x' on page 1 undefined" },
      { path: 'main.tex', line: 22, severity: 'warning', message: "Citation `knuth84' on page 1 undefined" },
      { path: 'main.tex', line: 30, severity: 'info', message: 'Overfull \\hbox (12.3pt too wide)' },
      { path: 'main.tex', line: 1, severity: 'info', message: 'Underfull \\vbox (badness 10000)' },
    ]);
  });

  it('says a missing package is not in the engine build', () => {
    const [missing] = parse("(./main.tex\n! LaTeX Error: File `minted.sty' not found.\n\nl.3 \\usepackage\n");
    expect(missing).toMatchObject({ path: 'main.tex', line: 3, severity: 'error' });
    expect(missing.message).toContain("minted.sty isn't in the project or in this site's TeX engine build");
  });

  it('joins lines TeX wrapped at 79 characters', () => {
    const long = `(./${'c'.repeat(76)}`;
    expect(long.length).toBe(79);
    const paths = new Set([...projectPaths, `${'c'.repeat(76)}dir/deep.tex`]);
    const out = parseTexLog(`${long}\ndir/deep.tex\n! Oops.\nl.5 x\n`, { mainPath: 'main.tex', projectPaths: paths });
    expect(out[0].path).toBe(`${'c'.repeat(76)}dir/deep.tex`);
  });

  it('skips repeats, caps the count, and handles an error with no line', () => {
    const repeated = Array.from({ length: 3 }, () => '! Same.\nl.1 x').join('\n');
    expect(parse(repeated)).toHaveLength(1);
    const many = Array.from({ length: MAX_LOG_DIAGNOSTICS + 20 }, (_, i) => `! Error ${i}.\nl.${i + 1} x`).join('\n');
    expect(parse(many)).toHaveLength(MAX_LOG_DIAGNOSTICS);
    expect(parse('! Emergency stop.\n! Another.\n')).toEqual([
      { path: 'main.tex', line: 1, severity: 'error', message: 'Emergency stop.' },
      { path: 'main.tex', line: 1, severity: 'error', message: 'Another.' },
    ]);
    expect(parse('No pages of output.\r\n')).toEqual([]);
  });

  it('sorts errors before warnings before info, keeping log order', () => {
    const d = (severity: 'error' | 'warning' | 'info', line: number) => ({ path: 'main.tex', line, severity, message: '' });
    expect(sortDiagnostics([d('info', 1), d('warning', 2), d('error', 3), d('error', 4)]).map((x) => x.line)).toEqual([3, 4, 2, 1]);
  });
});
