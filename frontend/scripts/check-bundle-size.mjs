/**
 * Checks the built app against two budgets (issue #127):
 *
 * 1. Initial load. Everything index.html needs before the editor is usable: the page itself,
 *    the entry script, its static imports and modulepreloads, and the stylesheets it links.
 *    The graph comes from dist/index.html and the Vite manifest (dist/.vite/manifest.json),
 *    not from file names. Going over the budget fails the build.
 *
 * 2. Lazy chunks. Dynamic imports and workers load later, in parallel, from the GitHub Pages
 *    CDN, so there's no total cap. Each chunk only has a sanity ceiling, and we check that
 *    none of them got pulled into the initial graph by a static import.
 *
 * How the initial budget is derived from "keep the initial load under a few hundred ms":
 * - Assume a typical connection of 10 Mbps (ordinary broadband or fast 4G), about 1.25 MB/s.
 * - Aim for about 300 ms from request to an interactive editor.
 * - Set aside about 100 ms for latency (one round trip for the HTML, then the assets over the
 *   same HTTP/2 connection) and for parsing and running the script on a mid-range device.
 * - That leaves about 200 ms of transfer, and 200 ms at 1.25 MB/s is 250 kB gzipped.
 * GitHub Pages serves gzip, so gzip size is what goes over the wire.
 * 250 kB is the ceiling. The budget itself sits lower, at the initial load after the trim that
 * moved P2P, lint, dialogs, Drive add files and zip behind dynamic imports (208.6 kB) plus about
 * 15 kB of headroom, so growth has to be a choice. Raise it only with a reason in the PR.
 *
 * Run from frontend/ after a build: node scripts/check-bundle-size.mjs
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, posix } from 'node:path';

/** Assumed download speed: 10 Mbps, in bytes per second. */
export const ASSUMED_BYTES_PER_SECOND = 1_250_000;
/** Assumed round trip to the CDN, added once to each load time estimate. */
export const ASSUMED_RTT_MS = 50;
/** Gzip budget for the initial load (index.html plus its JS and CSS). See the header comment. */
export const INITIAL_BUDGET_GZIP_BYTES = 225_000;
/** A lazy chunk above this prints a warning. About 0.85 s at the assumed speed. */
export const LAZY_WARN_GZIP_BYTES = 1_000_000;
/** A lazy chunk above this fails the build. About 4 s at the assumed speed. */
export const LAZY_FAIL_GZIP_BYTES = 5_000_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');

export const kb = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

/** Estimated load time in ms for this many gzipped bytes, at the assumed speed and latency. */
export function estimateLoadMs(gzipBytes, bytesPerSecond = ASSUMED_BYTES_PER_SECOND, rttMs = ASSUMED_RTT_MS) {
  return Math.round(rttMs + (gzipBytes / bytesPerSecond) * 1000);
}

/** Turn an href or src from dist/index.html into a path relative to dist/, or null if it's external. */
export function toDistPath(ref) {
  if (!ref || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(ref)) return null;
  const clean = ref.split(/[?#]/)[0].replace(/^\.?\//, '');
  return posix.normalize(clean);
}

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] ?? null;

/** Find the local module scripts, modulepreloads and stylesheets that index.html loads. */
export function parseIndexHtml(html) {
  const scripts = [];
  const modulepreloads = [];
  const stylesheets = [];
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = toDistPath(attr(tag, 'src'));
    if (src) scripts.push(src);
  }
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    const href = toDistPath(attr(tag, 'href'));
    if (!href) continue;
    if (rel.includes('modulepreload')) modulepreloads.push(href);
    else if (rel.includes('stylesheet')) stylesheets.push(href);
  }
  return { scripts, modulepreloads, stylesheets };
}

/**
 * Relative static imports in a built JS file (`import ... from "./x.js"`, `import "./x.js"`,
 * `export ... from "./x.js"`). Dynamic `import("./x.js")` is left out on purpose.
 */
export function findStaticImports(code) {
  const specifiers = new Set();
  const pattern = /(?:^|[^.\w$])(?:import|export)\s*(?:[^"'();]*?\bfrom\s*)?["'](\.{1,2}\/[^"']+)["']/g;
  for (const match of code.matchAll(pattern)) specifiers.add(match[1]);
  return [...specifiers];
}

/**
 * Work out the initial-load graph: every file index.html pulls in before first paint, found by
 * following the manifest's static `imports` (and their `css`) from each script and preload.
 */
export function findInitialGraph(htmlRefs, manifest) {
  const byFile = new Map(Object.values(manifest).map((chunk) => [chunk.file, chunk]));
  const files = new Set();
  const visit = (chunk) => {
    if (!chunk || files.has(chunk.file)) return;
    files.add(chunk.file);
    (chunk.css ?? []).forEach((css) => files.add(css));
    (chunk.imports ?? []).forEach((key) => visit(manifest[key]));
  };
  for (const ref of [...htmlRefs.scripts, ...htmlRefs.modulepreloads]) {
    if (byFile.has(ref)) visit(byFile.get(ref));
    else files.add(ref);
  }
  htmlRefs.stylesheets.forEach((css) => files.add(css));
  return files;
}

/**
 * Check a measured build. `assets` are the JS and CSS files in dist/ as
 * { path, bytes, gzipBytes, staticImports }, with `path` relative to dist/.
 */
export function checkBuild({ html, htmlGzipBytes, manifest, assets }, limits = {}) {
  const {
    initialBudget = INITIAL_BUDGET_GZIP_BYTES,
    lazyWarn = LAZY_WARN_GZIP_BYTES,
    lazyFail = LAZY_FAIL_GZIP_BYTES,
  } = limits;
  const errors = [];
  const warnings = [];
  const lines = [];
  const byPath = new Map(assets.map((asset) => [asset.path, asset]));
  const initial = findInitialGraph(parseIndexHtml(html), manifest);

  for (const path of initial) {
    if (!byPath.has(path)) errors.push(`index.html loads ${path}, but it isn't in dist/.`);
  }

  // A static import from the initial graph to a file outside it means the graph above is wrong,
  // or a chunk meant to be lazy is being loaded up front.
  for (const path of initial) {
    for (const spec of byPath.get(path)?.staticImports ?? []) {
      const target = posix.normalize(posix.join(posix.dirname(path), spec));
      if (!initial.has(target)) errors.push(`${path} statically imports ${target}, so that lazy chunk loads up front.`);
    }
  }

  // A dynamic import that landed in the initial graph isn't lazy any more.
  for (const [key, chunk] of Object.entries(manifest)) {
    if (chunk.isDynamicEntry && initial.has(chunk.file)) {
      errors.push(`${key} is imported dynamically, but ${chunk.file} is also in the initial load. Remove its static imports.`);
    }
  }

  const initialAssets = assets.filter((asset) => initial.has(asset.path));
  const initialGzip = htmlGzipBytes + initialAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
  lines.push('Initial load (index.html and what it loads before first paint):');
  lines.push(`  index.html: gzip ${kb(htmlGzipBytes)}`);
  initialAssets.forEach((asset) => lines.push(`  ${asset.path}: ${kb(asset.bytes)} (gzip ${kb(asset.gzipBytes)})`));
  lines.push(`  total gzip: ${kb(initialGzip)} of ${kb(initialBudget)} budget, about ${estimateLoadMs(initialGzip)} ms at 10 Mbps`);
  if (initialGzip > initialBudget) {
    errors.push(`Initial load is ${kb(initialGzip)} gzipped, over the ${kb(initialBudget)} budget. Move something behind a dynamic import.`);
  }

  const lazyAssets = assets.filter((asset) => !initial.has(asset.path));
  lines.push('Lazy chunks (dynamic imports and workers, loaded on demand and in parallel):');
  if (lazyAssets.length === 0) lines.push('  none');
  for (const asset of lazyAssets) {
    lines.push(`  ${asset.path}: ${kb(asset.bytes)} (gzip ${kb(asset.gzipBytes)}), about ${estimateLoadMs(asset.gzipBytes)} ms at 10 Mbps`);
    if (asset.gzipBytes > lazyFail) errors.push(`${asset.path} is ${kb(asset.gzipBytes)} gzipped, over the ${kb(lazyFail)} limit for one lazy chunk.`);
    else if (asset.gzipBytes > lazyWarn) warnings.push(`${asset.path} is ${kb(asset.gzipBytes)} gzipped, over ${kb(lazyWarn)}. Consider splitting it.`);
  }

  return { initial: [...initial], initialGzip, lazy: lazyAssets.map((asset) => asset.path), errors, warnings, lines };
}

/** Measure every .js and .css file under a folder, with paths relative to `root`. */
export function measureAssets(dir, root = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '.vite') out.push(...measureAssets(full, root));
      continue;
    }
    const ext = extname(entry.name);
    if (!['.js', '.css'].includes(ext)) continue;
    const content = readFileSync(full);
    out.push({
      path: posix.normalize(full.slice(root.length + 1).split(/[\\/]/).join('/')),
      bytes: content.length,
      gzipBytes: gzipSync(content).length,
      staticImports: ext === '.js' ? findStaticImports(content.toString('utf8')) : [],
    });
  }
  return out;
}

/** Read dist/ and check it. */
export function checkDist(distDir = DIST_DIR) {
  const htmlBuffer = readFileSync(join(distDir, 'index.html'));
  const manifest = JSON.parse(readFileSync(join(distDir, '.vite', 'manifest.json'), 'utf8'));
  return checkBuild({
    html: htmlBuffer.toString('utf8'),
    htmlGzipBytes: gzipSync(htmlBuffer).length,
    manifest,
    assets: measureAssets(distDir),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(join(DIST_DIR, 'index.html')) || !existsSync(join(DIST_DIR, '.vite', 'manifest.json'))) {
    console.error('No dist/index.html or dist/.vite/manifest.json. Run the build first (build.manifest must be on).');
    process.exit(1);
  }
  const result = checkDist();
  result.lines.forEach((line) => console.log(line));
  // GitHub Actions turns these formats into annotations on the run.
  const ci = Boolean(process.env.GITHUB_ACTIONS);
  result.warnings.forEach((line) => console.warn(`${ci ? '::warning title=Bundle size::' : 'WARNING: '}${line}`));
  result.errors.forEach((line) => console.error(`${ci ? '::error title=Bundle size::' : 'ERROR: '}${line}`));
  if (result.errors.length > 0) process.exit(1);
}
