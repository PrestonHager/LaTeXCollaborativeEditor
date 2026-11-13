/**
 * Checks that dist/ has every page the app links to and none of the dev-only pages.
 * Vite only builds index.html unless vite.config.ts lists more inputs, which is how
 * the Privacy and ToS links ended up 404ing on the live site (issue #110).
 * Fails the build (exit 1) when something is wrong.
 * Run from frontend/ after a build: node scripts/check-build-pages.mjs
 */
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** Pages that must ship. index.html links to privacy.html and tos.html. */
export const REQUIRED_PAGES = ['index.html', 'privacy.html', 'tos.html'];

/** Dev-only pages and folders that must never ship (see AGENTS.md). */
export const FORBIDDEN_PATHS = ['regression.html', 'dev'];

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');

/** Compare the top-level entries of dist/ to the required and forbidden lists. */
export function checkPages(entries, required = REQUIRED_PAGES, forbidden = FORBIDDEN_PATHS) {
  const present = new Set(entries);
  const missing = required.filter((page) => !present.has(page));
  const unexpected = forbidden.filter((page) => present.has(page));
  const errors = [
    ...missing.map((page) => `dist/${page} is missing. Add it to BUILD_PAGES in vite.config.ts.`),
    ...unexpected.map((page) => `dist/${page} is dev-only and must not ship.`),
  ];
  return { ok: errors.length === 0, missing, unexpected, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(DIST_DIR)) {
    console.error('No dist folder. Run the build first.');
    process.exit(1);
  }
  const result = checkPages(readdirSync(DIST_DIR));
  if (!result.ok) {
    result.errors.forEach((line) => console.error(`ERROR: ${line}`));
    process.exit(1);
  }
  console.log(`Build pages OK: ${REQUIRED_PAGES.join(', ')}`);
}
