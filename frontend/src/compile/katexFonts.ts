/**
 * LaTeX.js's base.css sets KaTeX math to "Computer Modern Serif" !important, with no
 * fallback. That web font lacks many glyphs KaTeX uses from its own fonts: \infty, \leq,
 * \in, \forall, \partial and more, plus the private-use slash KaTeX draws \not and \neq
 * with. Those then come from some system font with the wrong shape and size.
 *
 * We keep Computer Modern first and fall back to the matching KaTeX font, so any glyph
 * Computer Modern lacks comes from KaTeX instead. Same selectors and !important as
 * base.css, placed after it, so these rules win.
 */
export const KATEX_FONT_FALLBACK_CSS = [
  '.katex,.katex .mainrm,.katex .mathit,.katex .mathbf{font-family:"Computer Modern Serif",KaTeX_Main,"Times New Roman",serif!important}',
  '.katex .mathdefault,.katex .boldsymbol{font-family:"Computer Modern Serif",KaTeX_Math,KaTeX_Main,serif!important}',
  '.katex .mathsf,.katex .textsf,.katex .mathboldsf,.katex .textboldsf,.katex .mathitsf,.katex .textitsf{font-family:"Computer Modern Sans",KaTeX_SansSerif,KaTeX_Main,sans-serif!important}',
].join('\n');

/** Add the KaTeX font fallbacks to the end of a LaTeX.js document's head. */
export function addKatexFontFallbacks(doc: Document): void {
  const style = doc.createElement('style');
  style.className = 'lc-katex-fonts';
  style.textContent = KATEX_FONT_FALLBACK_CSS;
  doc.head.appendChild(style);
}
