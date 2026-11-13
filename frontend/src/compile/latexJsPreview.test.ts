import { isDangerousUrl, latexSourceToPreviewHtml, projectToPreviewHtml, LATEX_JS_ASSET_BASE } from './latexJsPreview';

describe('latexSourceToPreviewHtml', () => {
  it('returns HTML for minimal valid LaTeX', () => {
    const { html, errors } = latexSourceToPreviewHtml(
      '\\documentclass{article}\\begin{document}Hi\\end{document}',
    );
    expect(errors).toEqual([]);
    expect(html).toBeTruthy();
    expect(html).toContain(LATEX_JS_ASSET_BASE);
  });

  it('strips javascript: and similar URLs from \\href and \\url', () => {
    const { html, errors } = latexSourceToPreviewHtml(
      String.raw`\documentclass{article}\usepackage{hyperref}\begin{document}` +
        String.raw`\href{javascript:alert(1)}{a} \url{JaVaScript:alert(2)} ` +
        String.raw`\href{vbscript:x}{b} \href{data:text/html,hi}{c} ` +
        String.raw`\href{https://ok.example}{d}\end{document}`,
    );
    expect(errors).toEqual([]);
    // The \url text still shows the URL, so we only check the href attributes.
    expect(html).not.toMatch(/href="\s*(javascript|vbscript|data):/i);
    expect(html).toContain('>a</a>');
    expect(html).toContain('href="https://ok.example"');
    expect(html).toContain(LATEX_JS_ASSET_BASE);
  });

  it('keeps \\ref as an in-page link but leaves an unknown label as plain ??', () => {
    const { html, errors } = latexSourceToPreviewHtml(
      String.raw`\documentclass{article}\begin{document}` +
        String.raw`\section{A}\label{a}See \ref{b} and \ref{missing}.\section{B}\label{b}\end{document}`,
    );
    expect(errors).toEqual([]);
    expect(html).toContain('<a href="#sec-2">2</a>');
    expect(html).toContain('id="sec-2"');
    expect(html).not.toContain('href="#"');
    expect(html).toContain('<a>??</a>');
  });

  it('reports no changes when nothing was changed', () => {
    const { html, changes } = latexSourceToPreviewHtml(
      '\\documentclass{article}\\begin{document}Hi\\end{document}',
    );
    expect(changes).toEqual([]);
    expect(html).not.toContain('lc-preview-note');
  });

  it('lists what was stripped or rewritten, but keeps the list out of the document', () => {
    const { html, errors, changes } = latexSourceToPreviewHtml(
      [
        '\\documentclass{article}',
        '\\usepackage{geometry}',
        '\\begin{document}',
        'Hi\\footnote{x}.',
        '\\end{document}',
      ].join('\n'),
    );
    expect(errors).toEqual([]);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toBe("Removed packages the preview can't load: geometry.");
    expect(html).not.toContain('Preview is approximate');
    expect(html).not.toContain('lc-preview-note');
    expect(html).not.toContain('<details');
  });

  it('keeps the change notes when the parse fails', () => {
    const { html, changes } = latexSourceToPreviewHtml('\\usepackage{geometry}\n\\invalidtokenalone');
    expect(html).toBeNull();
    expect(changes).toEqual(["Removed packages the preview can't load: geometry."]);
  });

  it('returns the changes for a whole project, with or without a document', () => {
    const texts = new Map([['main.tex', '\\documentclass{article}\n\\usepackage{geometry}\n\\begin{document}Hi\\end{document}']]);
    const ok = projectToPreviewHtml({ mainPath: 'main.tex', texts, binaryPaths: [], imageUrls: new Map() });
    expect(ok.changes).toEqual(["Removed packages the preview can't load: geometry."]);
    expect(ok.html).not.toContain('Preview is approximate');
    texts.set('main.tex', '\\usepackage{geometry}\n\\invalidtokenalone');
    const failed = projectToPreviewHtml({ mainPath: 'main.tex', texts, binaryPaths: [], imageUrls: new Map() });
    expect(failed.html).toBeNull();
    expect(failed.changes).toEqual(["Removed packages the preview can't load: geometry."]);
  });

  it('returns structured error when parse fails', () => {
    const { html, errors } = latexSourceToPreviewHtml('\\invalidtokenalone');
    expect(html).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(1);
    expect(errors[0].severity).toBe('error');
    expect(errors[0].message.length).toBeGreaterThan(0);
  });

  it('uses the line from the LaTeX.js error location', () => {
    const { errors } = latexSourceToPreviewHtml(
      '\\documentclass{article}\n\\begin{document}\nHi\n\\invalidtokenalone\n\\end{document}',
    );
    expect(errors[0].line).toBe(4);
  });

  it('clamps error lines to the end of the source', () => {
    const { errors } = latexSourceToPreviewHtml(
      '\\documentclass{article}\n\\begin{document}\n\\begin{itemize}',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBeGreaterThanOrEqual(1);
    expect(errors[0].line).toBeLessThanOrEqual(3);
  });
});

describe('isDangerousUrl', () => {
  it('flags script and data schemes, even with odd casing or whitespace', () => {
    expect(isDangerousUrl('javascript:alert(1)')).toBe(true);
    expect(isDangerousUrl(' JaVa\tScRipt:alert(1)')).toBe(true);
    expect(isDangerousUrl('vbscript:msgbox')).toBe(true);
    expect(isDangerousUrl('data:text/html,<script>')).toBe(true);
  });

  it('allows normal links', () => {
    expect(isDangerousUrl('https://example.com')).toBe(false);
    expect(isDangerousUrl('mailto:a@example.com')).toBe(false);
    expect(isDangerousUrl('#section')).toBe(false);
  });
});
