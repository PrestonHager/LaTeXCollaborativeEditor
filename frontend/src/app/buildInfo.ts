// The version, commit and build time baked in by vite.config.ts (scripts/build-info.mjs).
// The About dialog, the footer, the bug form and the P2P hello message read them from here,
// and the update check (issue #121) compares them with a freshly fetched version.json.
// See docs/versioning.md.
import { REPO_URL } from '../ui/issueLinks';

export type BuildInfo = {
  /** SemVer from frontend/package.json, e.g. 0.1.0. */
  version: string;
  /** Short commit SHA, or "dev" when the build couldn't find one. */
  commit: string;
  /** ISO time of the build, or "" outside a Vite build (tests). */
  builtAt: string;
};

/** Where the build writes version.json, relative to index.html. */
export const VERSION_JSON_PATH = 'version.json';

/** Same patterns as scripts/build-info.mjs, which checks dist/version.json at build time. */
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const COMMIT_PATTERN = /^(?:[0-9a-f]{7,40}|dev)$/;

type BuildEnv = { VITE_APP_VERSION?: unknown; VITE_APP_COMMIT?: unknown; VITE_APP_BUILT_AT?: unknown };

/** Read the build info out of import.meta.env, falling back to "dev" for anything missing. */
export function readBuildInfo(env: BuildEnv): BuildInfo {
  const text = (value: unknown, fallback: string) => (typeof value === 'string' && value ? value : fallback);
  return {
    version: text(env.VITE_APP_VERSION, 'dev'),
    commit: text(env.VITE_APP_COMMIT, 'dev'),
    builtAt: text(env.VITE_APP_BUILT_AT, ''),
  };
}

/** This build. */
export const BUILD_INFO: BuildInfo = readBuildInfo(import.meta.env as BuildEnv);

/** "0.1.0+abc1234", the SemVer way to write a version with its build. Just the version when there's no commit. */
export function formatVersion(info: BuildInfo): string {
  return info.commit === 'dev' ? info.version : `${info.version}+${info.commit}`;
}

/** Link to the commit on GitHub, or null for a build without one. */
export function commitUrl(commit: string): string | null {
  return /^[0-9a-f]{7,40}$/.test(commit) ? `${REPO_URL}/commit/${commit}` : null;
}

/** Link to the GitHub release for a version (it exists once the vX.Y.Z tag is pushed). */
export function releaseUrl(version: string): string {
  return `${REPO_URL}/releases/tag/v${version}`;
}

/** The build date as YYYY-MM-DD, or "" if there isn't a usable one. */
export function formatBuildDate(builtAt: string): string {
  const time = Date.parse(builtAt);
  return Number.isNaN(time) ? '' : new Date(time).toISOString().slice(0, 10);
}

/** Check a fetched version.json and return just its three fields, or null if it's malformed. */
export function parseVersionInfo(value: unknown): BuildInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { version, commit, builtAt } = value as Record<string, unknown>;
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) return null;
  if (typeof commit !== 'string' || !COMMIT_PATTERN.test(commit)) return null;
  if (typeof builtAt !== 'string' || Number.isNaN(Date.parse(builtAt))) return null;
  return { version, commit, builtAt };
}

/**
 * Compare two SemVer strings: negative if a is older, 0 if equal, positive if a is newer.
 * Build metadata (+abc1234) is ignored, as SemVer says. Returns null if either isn't SemVer.
 */
export function compareVersions(a: string, b: string): number | null {
  const pa = SEMVER_PATTERN.exec(a.split('+')[0]);
  const pb = SEMVER_PATTERN.exec(b.split('+')[0]);
  if (!pa || !pb) return null;
  for (let i = 1; i <= 3; i++) {
    const diff = Number(pa[i]) - Number(pb[i]);
    if (diff !== 0) return Math.sign(diff);
  }
  return comparePrerelease(pa[4], pb[4]);
}

/** A version without a pre-release tag is newer than one with it (1.0.0-rc.1 < 1.0.0). */
function comparePrerelease(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const as = a.split('.');
  const bs = b.split('.');
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    if (as[i] === undefined) return -1;
    if (bs[i] === undefined) return 1;
    if (as[i] === bs[i]) continue;
    const an = /^\d+$/.test(as[i]);
    const bn = /^\d+$/.test(bs[i]);
    if (an && bn) return Math.sign(Number(as[i]) - Number(bs[i]));
    if (an !== bn) return an ? -1 : 1;
    return as[i] < bs[i] ? -1 : 1;
  }
  /* v8 ignore next */
  return 0;
}

/** True when two builds differ: another version, or the same version from another commit. */
export function isDifferentBuild(a: BuildInfo, b: BuildInfo): boolean {
  return a.version !== b.version || (a.commit !== 'dev' && b.commit !== 'dev' && a.commit !== b.commit);
}
