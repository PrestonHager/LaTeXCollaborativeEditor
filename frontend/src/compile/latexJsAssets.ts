// Kept apart from latexJsPreview.ts so the app can name the asset URL without bundling LaTeX.js itself.

/** LaTeX.js static assets (CSS, fonts, JS) on the CDN — same version as the `latex.js` npm dependency. */
export const LATEX_JS_ASSET_BASE = 'https://cdn.jsdelivr.net/npm/latex.js@0.12.6/dist/';

/**
 * Where a build with bundled LaTeX.js assets serves them (issue #181). Only the desktop app's build
 * bundles them (`npm run build:desktop`, which sets LATEXJS_ASSETS=bundled and copies
 * latex.js/dist/{css,fonts,js} here), so its preview works offline. The desktop page always sits
 * at the root of its origin (tauri://localhost/, tauri.localhost on Windows, or the dev server), so a
 * root path is right from the page and from the compile worker alike.
 */
export const LATEX_JS_BUNDLED_PATH = '/latexjs/';

/**
 * Set by scripts/latexjs-assets.mjs through Vite's `define`: true in the desktop build. It's a
 * lone constant rather than a VITE_ variable, so it doesn't grow the import.meta.env object that
 * the initial bundle carries. Undefined where Vite didn't define it (tests).
 */
declare const __LATEXJS_BUNDLED__: boolean | undefined;

/** True in a build that ships the LaTeX.js assets itself (the desktop build). */
export const latexJsAssetsBundled = (flag: unknown = typeof __LATEXJS_BUNDLED__ === 'undefined' ? false : __LATEXJS_BUNDLED__): boolean =>
  flag === true;

/**
 * The base URL the preview loads LaTeX.js styles and fonts from: the bundled copy in the desktop
 * build, the CDN otherwise. `here` is the page's or the worker's own URL.
 */
export function latexJsAssetBase(bundled = latexJsAssetsBundled(), here: string | undefined = globalThis.location?.href): string {
  if (!bundled || !here) return LATEX_JS_ASSET_BASE;
  try {
    return new URL(LATEX_JS_BUNDLED_PATH, here).href;
  } catch {
    return LATEX_JS_ASSET_BASE;
  }
}

/**
 * An exported file must not point at the app's own copy, which only exists inside the app, so
 * links to it are moved to the same files on the CDN.
 */
export function publicLatexJsUrl(url: string, base = latexJsAssetBase()): string {
  return base !== LATEX_JS_ASSET_BASE && url.startsWith(base) ? LATEX_JS_ASSET_BASE + url.slice(base.length) : url;
}
