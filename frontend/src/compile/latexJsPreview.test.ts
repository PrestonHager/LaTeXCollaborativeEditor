import { addChangesNote, isDangerousUrl, latexSourceToPreviewHtml, LATEX_JS_ASSET_BASE } from './latexJsPreview';

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

  it('adds no note when nothing was changed', () => {
    const { html, changes } = latexSourceToPreviewHtml(
      '\\documentclass{article}\\begin{document}Hi\\end{document}',
    );
    expect(changes).toEqual([]);
    expect(html).not.toContain('lc-preview-note');
  });

  it('adds a note listing what was stripped or rewritten', () => {
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
    const doc = new DOMParser().parseFromString(html ?? '', 'text/html');
    const note = doc.body.firstElementChild;
    expect(note?.className).toBe('lc-preview-note');
    expect(note?.querySelector('summary')?.textContent).toBe('Preview is approximate: 2 changes made for LaTeX.js.');
    expect(Array.from(note?.querySelectorAll('li') ?? [], (li) => li.textContent)).toEqual(changes);
  });

  it('keeps the change notes when the parse fails', () => {
    const { html, changes } = latexSourceToPreviewHtml('\\usepackage{geometry}\n\\invalidtokenalone');
    expect(html).toBeNull();
    expect(changes).toEqual(["Removed packages the preview can't load: geometry."]);
  });

  it('says "change" for a single change', () => {
    const doc = new DOMParser().parseFromString('<html><body><p>x</p></body></html>', 'text/html');
    addChangesNote(doc, ['Removed \\vspace.']);
    expect(doc.querySelector('summary')?.textContent).toBe('Preview is approximate: 1 change made for LaTeX.js.');
    expect(doc.body.lastElementChild?.tagName).toBe('P');
  });

  it('takes the note colors from the preview theme, with light fallbacks', () => {
    const doc = new DOMParser().parseFromString('<html><body><p>x</p></body></html>', 'text/html');
    addChangesNote(doc, ['Removed \\vspace.']);
    const style = doc.querySelector('.lc-preview-note')?.getAttribute('style') ?? '';
    expect(style).toContain('color:var(--lc-note-text,#555)');
    expect(style).toContain('background:var(--lc-note-bg,#f6f6f6)');
    expect(style).toContain('border:1px solid var(--lc-note-border,#ddd)');
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
