import { KATEX_FONT_FALLBACK_CSS } from './katexFonts';
import { latexSourceToPreviewHtml } from './latexJsPreview';

/** Map each selector to its font-family value, for rules that set one. */
function fontFamilies(css: string): Map<string, string> {
  const families = new Map<string, string>();
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selectors, body] of withoutComments.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const family = /font-family:\s*([^;]+)/.exec(body)?.[1].trim();
    if (!family) continue;
    for (const selector of selectors.split(',')) families.set(selector.trim().replace(/\s+/g, ' '), family);
  }
  return families;
}

describe('KaTeX font fallbacks', () => {
  it('goes after the LaTeX.js stylesheets in the preview head', () => {
    const { html } = latexSourceToPreviewHtml('\\documentclass{article}\\begin{document}$\\infty \\neq 0$\\end{document}');
    const head = html!.slice(0, html!.indexOf('</head>'));
    const style = head.indexOf('<style class="lc-katex-fonts">');
    expect(style).toBeGreaterThan(head.lastIndexOf('<link'));
    expect(head).toContain(KATEX_FONT_FALLBACK_CSS);
  });

  it('covers every KaTeX font rule in LaTeX.js base.css, keeping its first font', async () => {
    // LaTeX.js sets these to Computer Modern alone, which lacks \infty, \leq, the \not slash and more.
    // Vitest turns CSS imports into empty strings, so we read the file. The app has no Node types.
    const fs = (await import('node:fs' as string)) as { readFileSync(path: string, encoding: 'utf8'): string };
    const latexJsBaseCss = fs.readFileSync('node_modules/latex.js/dist/css/base.css', 'utf8');
    const base = [...fontFamilies(latexJsBaseCss)].filter(([selector]) => selector.startsWith('.katex'));
    const ours = fontFamilies(KATEX_FONT_FALLBACK_CSS);
    expect(base.length).toBeGreaterThan(5);
    for (const [selector, family] of base) {
      const fallback = ours.get(selector);
      expect(fallback, selector).toBeDefined();
      const first = family.replace(/\s*!important$/, '');
      expect(fallback!.startsWith(`${first},KaTeX_`), selector).toBe(true);
      expect(fallback!.endsWith('!important'), selector).toBe(true);
    }
  });
});
