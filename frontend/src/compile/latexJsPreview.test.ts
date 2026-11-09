import { isDangerousUrl, latexSourceToPreviewHtml, LATEX_JS_ASSET_BASE } from './latexJsPreview';

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

  it('returns structured error when parse fails', () => {
    const { html, errors } = latexSourceToPreviewHtml('\\invalidtokenalone');
    expect(html).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(1);
    expect(errors[0].severity).toBe('error');
    expect(errors[0].message.length).toBeGreaterThan(0);
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
