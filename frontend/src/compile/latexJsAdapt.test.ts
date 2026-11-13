import { adaptLatexSource, adaptLatexSourceForLatexJs, findVerbatimEnvironments } from './latexJsAdapt';
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

// Wrap a body in a small document, so line 1 is the \documentclass.
const doc = (...body: string[]) => ['\\documentclass{article}', ...body].join('\n');

describe('adaptLatexSource rewrites', () => {
  it('strips each unsupported package and lists them in one note', () => {
    const { source, changes } = adaptLatexSource(
      doc('\\usepackage[margin=1in]{geometry}', '\\usepackage{float} % for [H]', '\\usepackage{amsmath}'),
    );
    expect(source).toBe(doc('', '', '\\usepackage{amsmath}'));
    expect(changes).toEqual(["Removed packages the preview can't load: geometry, float."]);
  });

  it('strips fancyhdr and nomencl setup lines', () => {
    const { source, changes } = adaptLatexSource(
      doc(
        '\\makenomenclature',
        '\\pagestyle{fancy}',
        '\\fancyhf{}',
        '\\fancyhead[L]{Left}',
        '\\renewcommand{\\headrulewidth}{0.4pt}',
        '\\renewcommand{\\nomname}{\\large{Symbols}}',
        'Kept.',
      ),
    );
    expect(source).toBe(doc('', '', '', '', '', '', 'Kept.'));
    expect(changes).toEqual(['Removed fancyhdr and nomencl setup commands.']);
  });

  it('strips \\hypersetup, \\geometry, and \\setmainfont groups', () => {
    const { source, changes } = adaptLatexSource(
      doc('\\hypersetup{colorlinks={true}}', '\\geometry{a4paper}', '\\setmainfont{Times}', 'Kept.'),
    );
    expect(source).toBe(doc('', '', '', 'Kept.'));
    expect(changes).toEqual(['Removed \\hypersetup.', 'Removed \\geometry.', 'Removed \\setmainfont.']);
  });

  it('turns authblk \\author and \\affil into plain text', () => {
    const { source, changes } = adaptLatexSource(doc('\\author[1,2]{Ada}', '\\affil[1]{Lab}'));
    expect(source).toBe(doc('\\author {Ada}', '\\par {\\small Lab}\\par '));
    expect(changes).toEqual(['Showed authblk \\author and \\affil as plain text.']);
  });

  it('turns figure and [H] into a center block', () => {
    const { source, changes } = adaptLatexSource(doc('\\begin{figure}[H]', 'x', '\\end{figure}'));
    expect(source).toBe(doc('\\begin{center}', 'x', '\\end{center}'));
    expect(changes).toEqual(['Showed figures in place instead of floating.']);
  });

  it('expands \\nomenclature and drops \\printnomenclature', () => {
    const { source, changes } = adaptLatexSource(doc('\\printnomenclature', 'Use \\nomenclature{$v$}{speed} here.'));
    expect(source).toBe(doc('', 'Use $v$ here.'));
    expect(changes).toEqual(['Showed \\nomenclature entries as plain text and dropped \\printnomenclature.']);
  });

  it('swaps \\textcopyright for the sign without a note', () => {
    const { source, changes } = adaptLatexSource(doc('\\textcopyright{} 2024 and \\textcopyright'));
    expect(source).toBe(doc('© 2024 and ©'));
    expect(changes).toEqual([]);
  });

  it('puts a note in place of images that are not project images', () => {
    const { source, changes } = adaptLatexSource(doc('\\includegraphics[width=2in]{plot_1.pdf}', '\\includegraphics{lcimg0}'));
    expect(source).toBe(
      doc("\\par\\noindent\\textit{Figure \\texttt{plot1.pdf} can't be shown in the browser preview.}\\par", '\\includegraphics{lcimg0}'),
    );
    expect(changes).toEqual(["Put a note in place of images the browser can't show."]);
  });

  it('leaves project images alone without a note', () => {
    const { changes } = adaptLatexSource(doc('\\includegraphics{lcimg3}'));
    expect(changes).toEqual([]);
  });

  it('turns \\caption into bold text', () => {
    const { source, changes } = adaptLatexSource(doc('\\caption{A cat}'));
    expect(source).toBe(doc('\\par\\noindent\\textbf{A cat}\\par'));
    expect(changes).toEqual(['Showed \\caption as bold text.']);
  });

  it('inlines footnotes in parentheses', () => {
    const { source, changes } = adaptLatexSource(doc('Text\\footnote{a {b} c}.'));
    expect(source).toBe(doc('Text\\textit{(a {b} c)}.'));
    expect(changes).toEqual(['Showed footnotes inline in parentheses.']);
  });

  it('strips \\vspace and \\vspace*', () => {
    const { source, changes } = adaptLatexSource(doc('a\\vspace{1em}b\\vspace*{2cm}c'));
    expect(source).toBe(doc('abc'));
    expect(changes).toEqual(['Removed \\vspace.']);
  });

  it('strips \\addcontentsline', () => {
    const { source, changes } = adaptLatexSource(doc('\\addcontentsline{toc}{section}{Intro}Kept.'));
    expect(source).toBe(doc('Kept.'));
    expect(changes).toEqual(['Removed \\addcontentsline.']);
  });

  it('makes no notes for a document that needs no changes', () => {
    const src = doc('\\usepackage{amsmath}', '\\begin{document}', 'Hi.', '\\end{document}');
    expect(adaptLatexSource(src)).toEqual({ source: src, changes: [] });
  });
});

describe('adaptLatexSource protected text', () => {
  it('leaves commented-out commands alone', () => {
    const src = doc(
      '% \\usepackage{geometry}',
      'Text % \\footnote{not a footnote} \\vspace{1em}',
      '%\\begin{figure}',
      '50\\% off\\footnote{real}',
    );
    const { source, changes } = adaptLatexSource(src);
    expect(source).toBe(
      doc('% \\usepackage{geometry}', 'Text % \\footnote{not a footnote} \\vspace{1em}', '%\\begin{figure}', '50\\% off\\textit{(real)}'),
    );
    expect(changes).toEqual(['Showed footnotes inline in parentheses.']);
  });

  it('keeps a trailing comment on a stripped package line from blocking the strip', () => {
    const { source } = adaptLatexSource(doc('\\usepackage{geometry} % margins {'));
    expect(source).toBe(doc(''));
  });

  it('ignores braces inside comments when matching groups', () => {
    const { source } = adaptLatexSource(doc('A\\footnote{one % }', 'two}B'));
    expect(source).toBe(doc('A\\textit{(one % }', 'two)}B'));
  });

  it('leaves verbatim-like environments alone', () => {
    for (const env of ['verbatim', 'verbatim*', 'lstlisting', 'comment']) {
      const src = doc(
        `\\begin{${env}}`,
        '\\usepackage{geometry}',
        '\\footnote{x} \\vspace{1em} \\begin{figure}',
        `\\end{${env}} after\\vspace{1em}`,
      );
      const { source, changes } = adaptLatexSource(src);
      expect(source).toBe(doc(`\\begin{${env}}`, '\\usepackage{geometry}', '\\footnote{x} \\vspace{1em} \\begin{figure}', `\\end{${env}} after`));
      expect(changes).toEqual(['Removed \\vspace.']);
    }
  });

  it('leaves a one-line verbatim block alone', () => {
    const src = doc('\\begin{verbatim}\\caption{x}\\end{verbatim}\\caption{y}');
    expect(adaptLatexSource(src).source).toBe(doc('\\begin{verbatim}\\caption{x}\\end{verbatim}\\par\\noindent\\textbf{y}\\par'));
  });

  it('leaves \\verb text alone', () => {
    const src = doc('\\verb|\\footnote{x}| and \\verb*+%\\vspace{1em}+ and \\footnote{y}');
    const { source } = adaptLatexSource(src);
    expect(source).toBe(doc('\\verb|\\footnote{x}| and \\verb*+%\\vspace{1em}+ and \\textit{(y)}'));
  });

  it('hides the rest of the line after an unclosed \\verb', () => {
    const src = doc('\\verb|\\footnote{x}', '\\footnote{y}');
    expect(adaptLatexSource(src).source).toBe(doc('\\verb|\\footnote{x}', '\\textit{(y)}'));
  });

  it('keeps line numbers when verbatim and comments mix with rewrites', () => {
    const src = doc('\\begin{verbatim}', '% not a comment', '\\end{verbatim}', '\\hypersetup{', '% x }', '}', 'End.');
    const { source } = adaptLatexSource(src);
    expect(source.split('\n')).toHaveLength(src.split('\n').length);
    expect(source).toBe(doc('\\begin{verbatim}', '% not a comment', '\\end{verbatim}', '', '', '', 'End.'));
  });
});

describe('findVerbatimEnvironments', () => {
  it('always knows the built-in verbatim-like environments', () => {
    const found = findVerbatimEnvironments('');
    for (const env of ['verbatim', 'verbatim*', 'Verbatim', 'BVerbatim', 'LVerbatim', 'lstlisting', 'minted', 'comment']) {
      expect(found.has(env)).toBe(true);
    }
    expect(found.has('itemize')).toBe(false);
  });

  it('picks up \\lstnewenvironment, fancyvrb and tcolorbox definitions', () => {
    const found = findVerbatimEnvironments(
      [
        '\\lstnewenvironment{pycode}[1][]{\\lstset{language=Python,#1}}{}',
        '\\DefineVerbatimEnvironment{ console }{Verbatim}{frame=single}',
        '\\CustomVerbatimEnvironment{shell}{Verbatim}{}',
        '\\newtcblisting{boxcode}{listing only}',
      ].join('\n'),
    );
    for (const env of ['pycode', 'console', 'shell', 'boxcode']) expect(found.has(env)).toBe(true);
  });

  it('picks up \\newminted with and without a custom name', () => {
    const found = findVerbatimEnvironments('\\newminted{python}{linenos}\n\\newminted[jscode]{javascript}{}');
    expect(found.has('pythoncode')).toBe(true);
    expect(found.has('pythoncode*')).toBe(true);
    expect(found.has('jscode')).toBe(true);
    expect(found.has('javascriptcode')).toBe(false);
  });

  it('picks up \\newenvironment wrappers around verbatim environments', () => {
    const found = findVerbatimEnvironments(
      [
        '\\newenvironment{plain}{\\verbatim}{\\endverbatim}',
        '\\newenvironment*{boxed}[1][x]{\\VerbatimEnvironment\\begin{Verbatim}[label=#1]}{\\end{Verbatim}}',
        '\\renewenvironment{listing}{\\lstlisting}{\\endlstlisting}',
        // A wrapper around a wrapper, defined before the one it wraps.
        '\\newenvironment{outer}{\\begin{inner}}{\\end{inner}}',
        '\\lstnewenvironment{inner}{}{}',
        '\\newenvironment{note}{\\begin{quote}\\verbatimfont}{\\end{quote}}',
      ].join('\n'),
    );
    for (const env of ['plain', 'boxed', 'listing', 'outer', 'inner']) expect(found.has(env)).toBe(true);
    expect(found.has('note')).toBe(false);
  });

  it('ignores commented-out definitions', () => {
    const found = findVerbatimEnvironments('% \\lstnewenvironment{gone}{}{}\n50\\% \\lstnewenvironment{kept}{}{}');
    expect(found.has('gone')).toBe(false);
    expect(found.has('kept')).toBe(true);
  });

  it('skips a \\newenvironment whose begin code never closes', () => {
    expect(findVerbatimEnvironments('\\newenvironment{broken}{\\verbatim').has('broken')).toBe(false);
  });
});

describe('adaptLatexSource user-defined verbatim environments', () => {
  const body = ['\\footnote{x} \\vspace{1em} \\caption{c}', '\\usepackage{geometry}'];

  it.each([
    ['\\lstnewenvironment{pycode}{}{}', 'pycode'],
    ['\\DefineVerbatimEnvironment{console}{Verbatim}{}', 'console'],
    ['\\newminted{python}{}', 'pythoncode'],
    ['\\newminted[jscode]{javascript}{}', 'jscode'],
    ['\\newenvironment{plain}{\\verbatim}{\\endverbatim}', 'plain'],
    ['\\newenvironment{boxed}{\\VerbatimEnvironment\\begin{Verbatim}}{\\end{Verbatim}}', 'boxed'],
    ['', 'BVerbatim'],
    ['', 'minted'],
  ])('leaves the body of %s (%s) alone', (definition, env) => {
    const src = doc(definition, `\\begin{${env}}`, ...body, `\\end{${env}}\\vspace{1em}`);
    const { source, changes } = adaptLatexSource(src);
    expect(source).toBe(doc(definition, `\\begin{${env}}`, ...body, `\\end{${env}}`));
    expect(changes).toEqual(['Removed \\vspace.']);
  });

  it('still rewrites the body of an environment that only looks like code', () => {
    const src = doc('\\newenvironment{code}{\\begin{quote}}{\\end{quote}}', '\\begin{code}', '\\vspace{1em}x', '\\end{code}');
    expect(adaptLatexSource(src).source).toBe(doc('\\newenvironment{code}{\\begin{quote}}{\\end{quote}}', '\\begin{code}', 'x', '\\end{code}'));
  });

  it('still rewrites a body when the definition is commented out', () => {
    const src = doc('% \\lstnewenvironment{pycode}{}{}', '\\begin{pycode}', '\\vspace{1em}x', '\\end{pycode}');
    expect(adaptLatexSource(src).source).toBe(doc('% \\lstnewenvironment{pycode}{}{}', '\\begin{pycode}', 'x', '\\end{pycode}'));
  });

  it('handles a begin and end in the middle of a line', () => {
    const src = doc(
      '\\lstnewenvironment{pycode}{}{}',
      'Before\\vspace{1em} \\begin{pycode}\\footnote{a}',
      '\\vspace{2em}',
      'x = 1\\end{pycode} after\\footnote{b}',
      'A \\begin {verbatim}\\caption{k}\\end{verbatim} B',
    );
    expect(adaptLatexSource(src).source).toBe(
      doc(
        '\\lstnewenvironment{pycode}{}{}',
        'Before \\begin{pycode}\\footnote{a}',
        '\\vspace{2em}',
        'x = 1\\end{pycode} after\\textit{(b)}',
        'A \\begin {verbatim}\\caption{k}\\end{verbatim} B',
      ),
    );
  });

  it('only ends the block at its own \\end', () => {
    const src = doc('\\begin{pythoncode}', '\\end{verbatim}\\vspace{1em}', '\\end{pythoncode}', '\\newminted{python}{}');
    expect(adaptLatexSource(src).source).toBe(src);
  });

  it('keeps \\verb inline text alone next to a custom block', () => {
    const src = doc(
      '\\lstnewenvironment{pycode}{}{}',
      'Use \\verb!\\footnote{x}! and \\verb|\\vspace{1em}|.',
      '\\begin{pycode}',
      '\\verb|\\caption{x}|',
      '\\end{pycode}',
    );
    expect(adaptLatexSource(src)).toEqual({ source: src, changes: [] });
  });
});
