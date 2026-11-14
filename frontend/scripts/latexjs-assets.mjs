// Ships LaTeX.js's styles, fonts and script inside the build, for the desktop app (issue #181).
// Only when VITE_LATEXJS_ASSETS=bundled (`npm run build:desktop` / `npm run dev:desktop`): the web
// build keeps loading them from jsDelivr (src/compile/latexJsAssets.ts, docs/desktop.md).
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize, resolve, sep } from 'node:path';

/** The folders of latex.js/dist the preview's generated document loads. */
export const LATEXJS_ASSET_DIRS = ['css', 'fonts', 'js'];
/** Where they go in dist/, and where the dev server serves them. Matches LATEX_JS_BUNDLED_PATH. */
export const LATEXJS_OUT_DIR = 'latexjs';

const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export const latexJsDist = (root) => join(root, 'node_modules', 'latex.js', 'dist');

export const assetsBundled = (env) => String(env?.VITE_LATEXJS_ASSETS ?? '') === 'bundled';

/** Copy the asset folders into `<outDir>/latexjs/`. Returns the folders copied. */
export function copyLatexJsAssets(distDir, outDir) {
  const target = join(outDir, LATEXJS_OUT_DIR);
  for (const dir of LATEXJS_ASSET_DIRS) {
    const from = join(distDir, dir);
    if (!existsSync(from)) throw new Error(`latex.js assets missing: ${from}. Run npm ci in frontend/.`);
    cpSync(from, join(target, dir), { recursive: true });
  }
  return target;
}

/**
 * Map a request path under /latexjs/ to a file in latex.js/dist, or null. Never leaves the asset
 * folders, whatever the path says.
 */
export function resolveAssetPath(distDir, urlPath) {
  const prefix = `/${LATEXJS_OUT_DIR}/`;
  if (!urlPath.startsWith(prefix)) return null;
  let rel;
  try {
    rel = decodeURIComponent(urlPath.slice(prefix.length).split(/[?#]/)[0]);
  } catch {
    return null;
  }
  const file = resolve(distDir, normalize(rel));
  const allowed = LATEXJS_ASSET_DIRS.some((dir) => file.startsWith(resolve(distDir, dir) + sep));
  return allowed ? file : null;
}

/** The Vite plugin: copies the assets on build and serves them in dev, only when bundling is on. */
export function bundledLatexJsPlugin(root = fileURLToPath(new URL('..', import.meta.url))) {
  let enabled = false;
  let outDir = '';
  const distDir = latexJsDist(root);
  return {
    name: 'bundled-latexjs',
    configResolved(config) {
      enabled = assetsBundled(config.env) || assetsBundled(process.env);
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      if (!enabled) return;
      server.middlewares.use((req, res, next) => {
        const file = resolveAssetPath(distDir, req.url ?? '');
        if (!file || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
        // The preview frame has an opaque origin, and fonts load with CORS.
        res.setHeader('Access-Control-Allow-Origin', '*');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      if (enabled) copyLatexJsAssets(distDir, outDir);
    },
  };
}
