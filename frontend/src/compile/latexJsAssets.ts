// Kept apart from latexJsPreview.ts so the app can name the asset URL without bundling LaTeX.js itself.

/** LaTeX.js static assets (CSS, fonts, JS) — same version as the `latex.js` npm dependency. */
export const LATEX_JS_ASSET_BASE = 'https://cdn.jsdelivr.net/npm/latex.js@0.12.6/dist/';
