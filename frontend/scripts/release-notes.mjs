/**
 * Used by .github/workflows/release.yml when a vX.Y.Z tag is pushed.
 * Checks the tag matches the version in frontend/package.json and the root package.json,
 * then prints that version's CHANGELOG.md section, which becomes the GitHub release notes.
 * Exits 1 with a message if anything doesn't line up.
 *
 *   node frontend/scripts/release-notes.mjs v0.1.0 > notes.md
 *
 * See docs/versioning.md.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SEMVER_PATTERN } from './build-info.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

/** "v0.1.0" -> "0.1.0", or null if the tag isn't v + SemVer. */
export function versionFromTag(tag) {
  const match = /^v(.+)$/.exec(String(tag ?? '').trim());
  return match && SEMVER_PATTERN.test(match[1]) ? match[1] : null;
}

/** The body of the "## [X.Y.Z]" section, without its heading, or null if there isn't one or it's empty. */
export function changelogSection(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const heading = `## [${version}]`;
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  // The section ends at the next version heading or at the link references at the bottom.
  const end = rest.findIndex((line) => line.startsWith('## ') || /^\[[^\]]+\]:\s/.test(line));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
  return body || null;
}

/** Check everything for a tag. Returns { ok, errors, notes, prerelease }. */
export function prepareRelease({ tag, frontendVersion, rootVersion, changelog }) {
  const version = versionFromTag(tag);
  if (!version) return { ok: false, errors: [`Tag "${tag}" is not v followed by a SemVer version, like v0.1.0.`] };
  const errors = [];
  if (frontendVersion !== version) errors.push(`Tag ${tag} doesn't match frontend/package.json (${frontendVersion}).`);
  if (rootVersion !== version) errors.push(`Tag ${tag} doesn't match the root package.json (${rootVersion}).`);
  const notes = changelogSection(changelog, version);
  if (!notes) errors.push(`CHANGELOG.md has no "## [${version}]" section with notes in it.`);
  return { ok: errors.length === 0, errors, notes, prerelease: version.includes('-') };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const readJson = (path) => JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8'));
  const result = prepareRelease({
    tag: process.argv[2] ?? process.env.GITHUB_REF_NAME,
    frontendVersion: readJson('frontend/package.json').version,
    rootVersion: readJson('package.json').version,
    changelog: readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8'),
  });
  if (!result.ok) {
    result.errors.forEach((line) => console.error(`ERROR: ${line}`));
    process.exit(1);
  }
  process.stdout.write(`${result.notes}\n`);
}
