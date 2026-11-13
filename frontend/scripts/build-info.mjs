/**
 * Build metadata: the app version, the short commit SHA and the build time.
 * vite.config.ts bakes these into the bundle and writes them to dist/version.json,
 * which the update check (issue #121) polls to see if a newer build is live.
 * check-build-pages.mjs uses isValidVersionInfo to fail the build if the file is wrong.
 * See docs/versioning.md.
 */
import { execFileSync } from 'node:child_process';

/** Name of the file written next to index.html. */
export const VERSION_FILE = 'version.json';

/** SemVer 2.0 without build metadata, e.g. 0.1.0 or 1.0.0-rc.1. */
export const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** A short or full hex SHA, or "dev" when the build couldn't find one. */
export const COMMIT_PATTERN = /^(?:[0-9a-f]{7,40}|dev)$/;

/** Short SHA length, the same as `git rev-parse --short` usually prints. */
const SHORT_SHA_LENGTH = 7;

function runGit() {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
}

/**
 * The short commit SHA: `git rev-parse --short HEAD`, then $GITHUB_SHA, then "dev".
 * `git` is a parameter so tests can fake it.
 */
export function resolveCommit(env = process.env, git = runGit) {
  try {
    const sha = String(git()).trim().toLowerCase();
    if (COMMIT_PATTERN.test(sha) && sha !== 'dev') return sha;
  } catch {
    // No git, or not a checkout (a source tarball). Fall through.
  }
  const fromEnv = (env.GITHUB_SHA ?? '').trim().toLowerCase();
  if (/^[0-9a-f]{7,40}$/.test(fromEnv)) return fromEnv.slice(0, SHORT_SHA_LENGTH);
  return 'dev';
}

/** Everything the build bakes in. `now` is a parameter so tests get a fixed time. */
export function resolveBuildInfo({ version, env = process.env, git = runGit, now = new Date() }) {
  return { version, commit: resolveCommit(env, git), builtAt: now.toISOString() };
}

/** Check the shape of a parsed version.json. Returns a list of problems, empty when it's fine. */
export function versionInfoErrors(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['it is not a JSON object'];
  const errors = [];
  if (typeof value.version !== 'string' || !SEMVER_PATTERN.test(value.version)) {
    errors.push(`"version" must be a SemVer string like 0.1.0, got ${JSON.stringify(value.version)}`);
  }
  if (typeof value.commit !== 'string' || !COMMIT_PATTERN.test(value.commit)) {
    errors.push(`"commit" must be a hex SHA or "dev", got ${JSON.stringify(value.commit)}`);
  }
  if (typeof value.builtAt !== 'string' || Number.isNaN(Date.parse(value.builtAt))) {
    errors.push(`"builtAt" must be an ISO date, got ${JSON.stringify(value.builtAt)}`);
  }
  return errors;
}

export function isValidVersionInfo(value) {
  return versionInfoErrors(value).length === 0;
}

/** The exact text of version.json. Only these three fields, so nothing else leaks into it. */
export function versionJson(info) {
  return `${JSON.stringify({ version: info.version, commit: info.commit, builtAt: info.builtAt }, null, 2)}\n`;
}

/**
 * Vite plugin that writes dist/version.json and serves /version.json from the dev server,
 * so the update check works the same in `npm run dev`.
 */
export function versionJsonPlugin(info) {
  return {
    name: 'app-version-json',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || req.url.split('?')[0] !== `/${VERSION_FILE}`) return next();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(versionJson(info));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: VERSION_FILE, source: versionJson(info) });
    },
  };
}
