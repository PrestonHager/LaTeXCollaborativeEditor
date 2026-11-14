import { LATEX_JS_ASSET_BASE, latexJsAssetBase, latexJsAssetsBundled, publicLatexJsUrl } from './latexJsAssets';

describe('latexJsAssetBase', () => {
  it('uses the CDN unless the build bundles the assets', () => {
    expect(latexJsAssetsBundled({})).toBe(false);
    expect(latexJsAssetsBundled({ VITE_LATEXJS_ASSETS: 'bundled' })).toBe(true);
    expect(latexJsAssetBase()).toBe(LATEX_JS_ASSET_BASE);
    expect(latexJsAssetBase(false, 'tauri://localhost/index.html')).toBe(LATEX_JS_ASSET_BASE);
  });

  it("uses the app's own copy at the root of its origin, from the page or the worker", () => {
    expect(latexJsAssetBase(true, 'tauri://localhost/index.html')).toBe('tauri://localhost/latexjs/');
    expect(latexJsAssetBase(true, 'https://tauri.localhost/assets/compile.worker-abc.js')).toBe('https://tauri.localhost/latexjs/');
    expect(latexJsAssetBase(true, 'http://localhost:5173/?room=x')).toBe('http://localhost:5173/latexjs/');
  });

  it('falls back to the CDN without a usable location', () => {
    expect(latexJsAssetBase(true, '')).toBe(LATEX_JS_ASSET_BASE);
    expect(latexJsAssetBase(true, 'not a url')).toBe(LATEX_JS_ASSET_BASE);
  });
});

describe('publicLatexJsUrl', () => {
  it("moves links to the app's copy to the CDN", () => {
    const base = 'tauri://localhost/latexjs/';
    expect(publicLatexJsUrl(`${base}css/katex.css`, base)).toBe(`${LATEX_JS_ASSET_BASE}css/katex.css`);
    expect(publicLatexJsUrl('https://example.com/x.css', base)).toBe('https://example.com/x.css');
    expect(publicLatexJsUrl(`${LATEX_JS_ASSET_BASE}css/katex.css`)).toBe(`${LATEX_JS_ASSET_BASE}css/katex.css`);
  });
});
