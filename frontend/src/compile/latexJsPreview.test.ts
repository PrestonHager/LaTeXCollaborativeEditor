import { latexSourceToPreviewHtml, LATEX_JS_ASSET_BASE } from './latexJsPreview';

describe('latexSourceToPreviewHtml', () => {
  it('returns HTML for minimal valid LaTeX', () => {
    const { html, errors } = latexSourceToPreviewHtml(
      '\\documentclass{article}\\begin{document}Hi\\end{document}',
    );
    expect(errors).toEqual([]);
    expect(html).toBeTruthy();
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
