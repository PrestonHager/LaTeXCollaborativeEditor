// @vitest-environment node
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { LATEXJS_ASSET_DIRS, assetsBundled, bundledLatexJsPlugin, copyLatexJsAssets, latexJsDist, resolveAssetPath } from './latexjs-assets.mjs';

/** A fake app root with node_modules/latex.js/dist in it. */
function fakeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'latexjs-assets-'));
  const dist = latexJsDist(root);
  for (const dir of LATEXJS_ASSET_DIRS) mkdirSync(join(dist, dir, 'Serif'), { recursive: true });
  writeFileSync(join(dist, 'css', 'katex.css'), '.katex{}');
  writeFileSync(join(dist, 'fonts', 'Serif', 'cmun serif.woff'), 'woff');
  writeFileSync(join(dist, 'js', 'base.js'), '// js');
  writeFileSync(join(dist, 'latex.mjs'), '// the library itself, not an asset');
  return { root, dist };
}

describe('latexjs-assets', () => {
  let root;
  let dist;
  beforeEach(() => ({ root, dist } = fakeRoot()));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('is on only with VITE_LATEXJS_ASSETS=bundled', () => {
    expect(assetsBundled({ VITE_LATEXJS_ASSETS: 'bundled' })).toBe(true);
    expect(assetsBundled({ VITE_LATEXJS_ASSETS: 'cdn' })).toBe(false);
    expect(assetsBundled(undefined)).toBe(false);
  });

  it('copies the styles, fonts and script into dist/latexjs', () => {
    const out = join(root, 'out');
    copyLatexJsAssets(dist, out);
    expect(readFileSync(join(out, 'latexjs', 'css', 'katex.css'), 'utf8')).toBe('.katex{}');
    expect(existsSync(join(out, 'latexjs', 'fonts', 'Serif', 'cmun serif.woff'))).toBe(true);
    expect(existsSync(join(out, 'latexjs', 'js', 'base.js'))).toBe(true);
    expect(existsSync(join(out, 'latexjs', 'latex.mjs'))).toBe(false);
  });

  it('fails clearly when latex.js is not installed', () => {
    expect(() => copyLatexJsAssets(join(root, 'missing'), join(root, 'out'))).toThrow(/latex.js assets missing/);
  });

  it('only maps paths inside the asset folders', () => {
    expect(resolveAssetPath(dist, '/latexjs/fonts/Serif/cmun%20serif.woff?v=1')).toBe(join(dist, 'fonts', 'Serif', 'cmun serif.woff'));
    expect(resolveAssetPath(dist, '/latexjs/latex.mjs')).toBeNull();
    expect(resolveAssetPath(dist, '/latexjs/css/../../../package.json')).toBeNull();
    expect(resolveAssetPath(dist, '/latexjs/%E0%A4%A')).toBeNull();
    expect(resolveAssetPath(dist, '/src/main.ts')).toBeNull();
  });

  const resolved = (env, outDir = 'dist') => ({ env, root, build: { outDir } });

  it('copies on build only when bundling is on', () => {
    const off = bundledLatexJsPlugin(root);
    off.configResolved(resolved({}, 'off'));
    off.closeBundle();
    expect(existsSync(join(root, 'off'))).toBe(false);

    const on = bundledLatexJsPlugin(root);
    on.configResolved(resolved({ VITE_LATEXJS_ASSETS: 'bundled' }, 'on'));
    on.closeBundle();
    expect(existsSync(join(root, 'on', 'latexjs', 'css', 'katex.css'))).toBe(true);
  });

  it('serves the assets in dev with CORS for the preview frame', async () => {
    const use = vi.fn();
    const off = bundledLatexJsPlugin(root);
    off.configResolved(resolved({}));
    off.configureServer({ middlewares: { use } });
    expect(use).not.toHaveBeenCalled();

    const plugin = bundledLatexJsPlugin(root);
    plugin.configResolved(resolved({ VITE_LATEXJS_ASSETS: 'bundled' }));
    plugin.configureServer({ middlewares: { use } });
    const middleware = use.mock.calls[0][0];

    const next = vi.fn();
    middleware({ url: '/latexjs/css/missing.css' }, {}, next);
    middleware({ url: '/latexjs/css' }, {}, next);
    middleware({ url: '/index.html' }, {}, next);
    middleware({}, {}, next);
    expect(next).toHaveBeenCalledTimes(4);

    const headers = {};
    const res = Object.assign(new PassThrough(), { setHeader: (name, value) => (headers[name] = value) });
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    const done = new Promise((resolve) => res.on('finish', resolve));
    middleware({ url: '/latexjs/css/katex.css' }, res, next);
    await done;
    expect(Buffer.concat(chunks).toString()).toBe('.katex{}');
    expect(headers).toEqual({ 'Content-Type': 'text/css; charset=utf-8', 'Access-Control-Allow-Origin': '*' });

    const fontHeaders = {};
    const fontRes = Object.assign(new PassThrough(), { setHeader: (name, value) => (fontHeaders[name] = value) });
    fontRes.resume();
    const fontDone = new Promise((resolve) => fontRes.on('finish', resolve));
    middleware({ url: '/latexjs/fonts/Serif/cmun%20serif.woff' }, fontRes, next);
    await fontDone;
    expect(fontHeaders['Content-Type']).toBe('font/woff');
  });
});
