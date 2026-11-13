/**
 * Used by .github/workflows/prepare-release.yml to cut a release (issue #156).
 * Bumps the version in both package.json files and both lockfiles, and turns CHANGELOG.md's
 * "## [Unreleased]" section into "## [X.Y.Z] - YYYY-MM-DD" with a fresh empty Unreleased above it
 * and the compare links at the bottom updated. Prints the new version. Exits 1 with a message
 * if anything doesn't line up, and writes nothing in that case.
 *
 *   node frontend/scripts/prepare-release.mjs minor
 *   node frontend/scripts/prepare-release.mjs 0.2.0 --date 2026-11-20
 *
 * See docs/versioning.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SEMVER_PATTERN } from './build-info.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

export const BUMPS = ['patch', 'minor', 'major'];

/** Files whose version moves together. The lockfiles also carry it under packages[""]. */
export const VERSION_FILES = ['package.json', 'package-lock.json', 'frontend/package.json', 'frontend/package-lock.json'];

const REPO_URL = 'https://github.com/PrestonHager/LaTeXCollaborativeEditor';

function parse(version) {
  const match = SEMVER_PATTERN.exec(version);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: version.includes('-') };
}

/** Compare two SemVer strings by their numbers, then a pre-release sorts before its release. */
export function compareSemver(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return Math.sign(pa[key] - pb[key]);
  }
  if (a === b) return 0;
  if (pa.prerelease !== pb.prerelease) return pa.prerelease ? -1 : 1;
  return a < b ? -1 : 1;
}

/**
 * The next version: `bump` is patch, minor, major, or an exact SemVer version newer than `current`.
 * From a pre-release it finishes that release first, like `npm version` (1.0.0-rc.1 + patch = 1.0.0).
 */
export function nextVersion(current, bump) {
  const now = parse(current);
  if (!now) throw new Error(`The current version "${current}" isn't SemVer.`);
  const wanted = String(bump ?? '').trim().replace(/^v/, '');
  if (!BUMPS.includes(wanted)) {
    if (!parse(wanted)) throw new Error(`"${bump}" isn't patch, minor, major or a version like 0.2.0.`);
    if (compareSemver(wanted, current) <= 0) throw new Error(`${wanted} isn't newer than the current version ${current}.`);
    return wanted;
  }
  let { major, minor, patch } = now;
  if (wanted === 'major') {
    if (!(now.prerelease && minor === 0 && patch === 0)) major += 1;
    minor = 0;
    patch = 0;
  } else if (wanted === 'minor') {
    if (!(now.prerelease && patch === 0)) minor += 1;
    patch = 0;
  } else if (!now.prerelease) {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

/** Set the version in package.json or package-lock.json text. Keeps npm's 2-space format. */
export function setPackageVersion(text, version) {
  const json = JSON.parse(text);
  json.version = version;
  if (json.packages?.['']) json.packages[''].version = version;
  return `${JSON.stringify(json, null, 2)}\n`;
}

/**
 * Move the Unreleased notes to a new "## [version] - date" section and update the links.
 * Throws if there's no Unreleased section, it's empty, or the version already has one.
 */
export function releaseChangelog(changelog, version, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`The date "${date}" isn't YYYY-MM-DD.`);
  const text = changelog.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  if (lines.some((line) => line === `## [${version}]` || line.startsWith(`## [${version}] `))) {
    throw new Error(`CHANGELOG.md already has a section for ${version}.`);
  }
  const start = lines.indexOf('## [Unreleased]');
  if (start === -1) throw new Error('CHANGELOG.md has no "## [Unreleased]" section.');
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## ') || /^\[[^\]]+\]:\s/.test(line));
  const body = (end === -1 ? rest : rest.slice(0, end)).filter((line) => line.trim() && !line.startsWith('### '));
  if (body.length === 0) throw new Error('The Unreleased section in CHANGELOG.md is empty, so there is nothing to release.');
  lines.splice(start, 1, '## [Unreleased]', '', `## [${version}] - ${date}`);

  const linkIndex = lines.findIndex((line) => line.startsWith('[Unreleased]: '));
  if (linkIndex === -1) throw new Error('CHANGELOG.md has no "[Unreleased]: " compare link at the bottom.');
  const previous = /\/compare\/v(.+)\.\.\.HEAD\s*$/.exec(lines[linkIndex])?.[1];
  const base = /^\[Unreleased\]: (\S+?)\/compare\//.exec(lines[linkIndex])?.[1] ?? REPO_URL;
  const versionLink = previous ? `[${version}]: ${base}/compare/v${previous}...v${version}` : `[${version}]: ${base}/releases/tag/v${version}`;
  lines.splice(linkIndex, 1, `[Unreleased]: ${base}/compare/v${version}...HEAD`, versionLink);
  return lines.join('\n');
}

/** Today in UTC as YYYY-MM-DD. */
export function today(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Work out every file change for a release from the current file texts.
 * `files` maps each path in VERSION_FILES, plus CHANGELOG.md, to its text.
 * Returns { version, files } with the new texts, or throws.
 */
export function prepareReleaseFiles(files, bump, date) {
  const current = JSON.parse(files['frontend/package.json']).version;
  const version = nextVersion(current, bump);
  const out = { 'CHANGELOG.md': releaseChangelog(files['CHANGELOG.md'], version, date) };
  for (const path of VERSION_FILES) out[path] = setPackageVersion(files[path], version);
  return { version, previous: current, files: out };
}

/** Read argv: the bump, then an optional --date. */
export function parseArgs(argv) {
  const args = [...argv];
  const dateAt = args.indexOf('--date');
  const date = dateAt === -1 ? today() : args[dateAt + 1];
  if (dateAt !== -1) args.splice(dateAt, 2);
  return { bump: args[0], date };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { bump, date } = parseArgs(process.argv.slice(2));
  const paths = [...VERSION_FILES, 'CHANGELOG.md'];
  const files = Object.fromEntries(paths.map((path) => [path, readFileSync(join(REPO_ROOT, path), 'utf8')]));
  try {
    const result = prepareReleaseFiles(files, bump, date);
    for (const [path, text] of Object.entries(result.files)) writeFileSync(join(REPO_ROOT, path), text);
    process.stdout.write(`${result.version}\n`);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}
