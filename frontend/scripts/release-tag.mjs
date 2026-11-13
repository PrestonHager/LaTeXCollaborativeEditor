/**
 * Used by .github/workflows/tag-release.yml on every push to main that touches
 * frontend/package.json (issue #156). Decides whether the push is a release, so the workflow can
 * tag vX.Y.Z on it and run the release. A push is a release when:
 *   - the version in frontend/package.json went up, or
 *   - the commit message names a release/vX.Y.Z branch (a merged release PR) for the current
 *     version, which covers a push whose previous commit can't be read.
 * Prints the version, or nothing when it isn't a release.
 *
 *   node frontend/scripts/release-tag.mjs <version before the push> "<commit message>"
 *
 * See docs/versioning.md.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SEMVER_PATTERN } from './build-info.mjs';
import { compareSemver } from './prepare-release.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

/** The branch prepare-release.yml opens the release PR from. */
export function releaseBranch(version) {
  return `release/v${version}`;
}

/** "release/v0.2.0" in a merge commit message (or a squash title) -> "0.2.0". */
export function versionFromReleaseBranch(message) {
  const match = /(?:^|[\s/:('"`])release\/v(\S+?)(?=$|[\s'"`)\]])/m.exec(String(message ?? ''));
  return match && SEMVER_PATTERN.test(match[1]) ? match[1] : null;
}

/** The version to tag for this push, or null. */
export function detectRelease({ beforeVersion, afterVersion, message }) {
  if (!SEMVER_PATTERN.test(String(afterVersion ?? ''))) return null;
  if (SEMVER_PATTERN.test(String(beforeVersion ?? ''))) {
    // Only a bump counts. A revert to an older version isn't a release.
    if (compareSemver(afterVersion, beforeVersion) > 0) return afterVersion;
  }
  return versionFromReleaseBranch(message) === afterVersion ? afterVersion : null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const afterVersion = JSON.parse(readFileSync(join(REPO_ROOT, 'frontend/package.json'), 'utf8')).version;
  const version = detectRelease({ beforeVersion: process.argv[2], afterVersion, message: process.argv[3] });
  if (version) process.stdout.write(`${version}\n`);
}
