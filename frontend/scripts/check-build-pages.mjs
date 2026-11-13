/**
 * Checks that dist/ has every page the app links to and none of the dev-only pages.
 * Vite only builds index.html unless vite.config.ts lists more inputs, which is how
 * the Privacy and ToS links ended up 404ing on the live site (issue #110).
 * Also checks dist/version.json, which the update check polls (issues #120, #121).
 * Fails the build (exit 1) when something is wrong.
 * Run from frontend/ after a build: node scripts/check-build-pages.mjs
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VERSION_FILE, versionInfoErrors } from './build-info.mjs';

/** Pages that must ship. index.html links to privacy.html and tos.html. */
export const REQUIRED_PAGES = ['index.html', 'privacy.html', 'tos.html'];

/** Dev-only pages and folders that must never ship (see AGENTS.md). */
export const FORBIDDEN_PATHS = ['regression.html', 'dev'];

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');
const PACKAGE_JSON = join(__dirname, '..', 'package.json');

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

/**
 * Check the text of dist/version.json (or null when the file is missing).
 * It has to parse, have the right fields, and carry the version from package.json.
 */
export function checkVersionFile(text, expectedVersion) {
  if (text === null) {
    return { ok: false, errors: [`dist/${VERSION_FILE} is missing. versionJsonPlugin in vite.config.ts writes it.`] };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, errors: [`dist/${VERSION_FILE} is not valid JSON.`] };
  }
  const errors = versionInfoErrors(value).map((problem) => `dist/${VERSION_FILE}: ${problem}.`);
  if (errors.length === 0 && expectedVersion && value.version !== expectedVersion) {
    errors.push(`dist/${VERSION_FILE} says ${value.version} but package.json says ${expectedVersion}.`);
  }
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(DIST_DIR)) {
    console.error('No dist folder. Run the build first.');
    process.exit(1);
  }
  const result = checkPages(readdirSync(DIST_DIR));
  const versionPath = join(DIST_DIR, VERSION_FILE);
  const { version } = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
  const versionResult = checkVersionFile(existsSync(versionPath) ? readFileSync(versionPath, 'utf8') : null, version);
  const errors = [...result.errors, ...versionResult.errors];
  if (errors.length > 0) {
    errors.forEach((line) => console.error(`ERROR: ${line}`));
    process.exit(1);
  }
  console.log(`Build pages OK: ${REQUIRED_PAGES.join(', ')}, ${VERSION_FILE}`);
}
