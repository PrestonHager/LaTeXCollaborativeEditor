/**
 * Checks the gzipped size of the built JS and CSS against a budget, so the app stays quick
 * to load on slow networks. Going over only prints a warning, it never fails the build.
 * Run from frontend/ after a build: node scripts/check-bundle-size.mjs
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

// Budget for all JS and CSS together, gzipped. Raise it on purpose, not by accident.
export const BUDGET_GZIP_BYTES = 400 * 1024;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, '..', 'dist', 'assets');

/** Measure every .js and .css file in a folder. */
export function measureAssets(dir) {
  return readdirSync(dir)
    .filter((name) => ['.js', '.css'].includes(extname(name)))
    .map((name) => {
      const content = readFileSync(join(dir, name));
      return { name, bytes: content.length, gzipBytes: gzipSync(content).length };
    });
}

/** Compare the measured files to the budget and build the lines to print. */
export function checkBudget(files, budget = BUDGET_GZIP_BYTES) {
  const totalGzip = files.reduce((sum, file) => sum + file.gzipBytes, 0);
  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
  const lines = files.map((file) => `  ${file.name}: ${kb(file.bytes)} (gzip ${kb(file.gzipBytes)})`);
  lines.push(`  total gzip: ${kb(totalGzip)} of ${kb(budget)} budget`);
  return { totalGzip, overBudget: totalGzip > budget, lines, summary: `Bundle is ${kb(totalGzip)} gzipped, over the ${kb(budget)} budget.` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(ASSETS_DIR)) {
    console.warn('No dist/assets folder, so skipping the bundle size check. Run the build first.');
    process.exit(0);
  }
  const result = checkBudget(measureAssets(ASSETS_DIR));
  console.log('Bundle size:');
  result.lines.forEach((line) => console.log(line));
  if (result.overBudget) {
    // GitHub Actions turns this format into a warning annotation on the run.
    const prefix = process.env.GITHUB_ACTIONS ? '::warning title=Bundle size::' : 'WARNING: ';
    console.warn(`${prefix}${result.summary}`);
  }
}
