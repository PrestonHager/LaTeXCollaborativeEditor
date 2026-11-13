/**
 * Build metadata: the app version, the short commit SHA, the build time and the deploy environment.
 * vite.config.ts bakes these into the bundle and writes them to dist/version.json,
 * which the update check (issue #121) polls to see if a newer build is live.
 * check-build-pages.mjs uses isValidVersionInfo to fail the build if the file is wrong.
 * See docs/versioning.md.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Name of the file written next to index.html. */
export const VERSION_FILE = 'version.json';

/**
 * The repo-root CHANGELOG.md, copied next to index.html at build time (issue #140), so an open
 * tab's update prompt can show what the new deploy changed. It's read from the root file each
 * build, never kept as a second copy in the repo.
 */
export const CHANGELOG_FILE = 'CHANGELOG.md';

/** SemVer 2.0 without build metadata, e.g. 0.1.0 or 1.0.0-rc.1. */
export const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** A short or full hex SHA, or "dev" when the build couldn't find one. */
export const COMMIT_PATTERN = /^(?:[0-9a-f]{7,40}|dev)$/;

/**
 * Where a build is going (VITE_DEPLOY_ENV, issue #156). main deploys to staging, a vX.Y.Z tag
 * to production, and `npm run dev` is dev. See docs/deployment.md.
 */
export const DEPLOY_ENVS = ['production', 'staging', 'dev'];

/** The P2P app id the app uses when VITE_P2P_APP_ID isn't set (src/net/bootstrapConfig.ts). */
export const DEFAULT_P2P_APP_ID = 'latex-collaborative-editor';

/** The comment in index.html that a staging build swaps for the "Staging" badge. */
export const DEPLOY_ENV_BADGE_MARKER = '<!-- deploy-env-badge -->';

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

/**
 * The deploy environment from VITE_DEPLOY_ENV. When it's unset, the dev server is "dev" and a
 * build is "production", so a plain `npm run build` behaves as it always has.
 * Throws on anything else, so a typo like "stage" fails the build instead of shipping unmarked.
 */
export function resolveDeployEnv(value, command = 'build') {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return command === 'serve' ? 'dev' : 'production';
  if (!DEPLOY_ENVS.includes(text)) {
    throw new Error(`VITE_DEPLOY_ENV must be one of ${DEPLOY_ENVS.join(', ')}, got ${JSON.stringify(value)}.`);
  }
  return text;
}

/**
 * The P2P app id for a staging build. Peers only meet peers with the same app id, so staging
 * always gets one with "staging" in it, even if the staging environment inherited production's
 * VITE_P2P_APP_ID from a repository variable.
 */
export function stagingP2pAppId(appId) {
  const id = String(appId ?? '').trim() || DEFAULT_P2P_APP_ID;
  return /staging/i.test(id) ? id : `${id}-staging`;
}

/** The small header badge a staging build shows. Basecoat's badge classes, no new styles. */
export function deployEnvBadgeHtml() {
  return '<span id="deploy-env-badge" class="badge" data-variant="secondary" data-tooltip="Staging build of main. Projects here are separate from the live site." data-side="bottom">Staging</span>';
}

/** Rewrite an HTML page for a deploy environment. Only staging changes anything. */
export function transformHtmlForDeployEnv(html, deployEnv) {
  if (deployEnv !== 'staging') return html.replace(DEPLOY_ENV_BADGE_MARKER, '');
  const withBadge = html.replace(DEPLOY_ENV_BADGE_MARKER, deployEnvBadgeHtml());
  // Search engines shouldn't index staging. robots.txt covers the docs too.
  return withBadge.replace(/<head>/i, '<head>\n    <meta name="robots" content="noindex" />');
}

/** robots.txt for staging, which blocks every crawler. Production ships none. */
export const STAGING_ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

/**
 * Vite plugin for VITE_DEPLOY_ENV. It defines import.meta.env.VITE_DEPLOY_ENV, gives staging its
 * own P2P app id, adds the badge and noindex to staging pages and writes a staging robots.txt.
 * `api.env` is the resolved value, for versionJsonPlugin.
 */
export function deployEnvPlugin(loadEnvVars = () => process.env) {
  let deployEnv = 'production';
  return {
    name: 'app-deploy-env',
    api: {
      get env() {
        return deployEnv;
      },
    },
    config(_config, { command, mode }) {
      const env = loadEnvVars(mode);
      deployEnv = resolveDeployEnv(env.VITE_DEPLOY_ENV, command);
      const define = { 'import.meta.env.VITE_DEPLOY_ENV': JSON.stringify(deployEnv) };
      if (deployEnv === 'staging') define['import.meta.env.VITE_P2P_APP_ID'] = JSON.stringify(stagingP2pAppId(env.VITE_P2P_APP_ID));
      return { define };
    },
    transformIndexHtml(html) {
      return transformHtmlForDeployEnv(html, deployEnv);
    },
    generateBundle() {
      if (deployEnv === 'staging') this.emitFile({ type: 'asset', fileName: 'robots.txt', source: STAGING_ROBOTS_TXT });
    },
  };
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
  if (!DEPLOY_ENVS.includes(value.env)) {
    errors.push(`"env" must be one of ${DEPLOY_ENVS.join(', ')}, got ${JSON.stringify(value.env)}`);
  }
  return errors;
}

export function isValidVersionInfo(value) {
  return versionInfoErrors(value).length === 0;
}

/** The exact text of version.json. Only these four fields, so nothing else leaks into it. */
export function versionJson(info) {
  return `${JSON.stringify({ version: info.version, commit: info.commit, builtAt: info.builtAt, env: info.env }, null, 2)}\n`;
}

/** Copy the CHANGELOG.md at `sourcePath` into dist/, and serve it in dev, uncached like version.json. */
export function changelogFilePlugin(sourcePath) {
  return {
    name: 'app-changelog-file',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || req.url.split('?')[0] !== `/${CHANGELOG_FILE}`) return next();
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(readFileSync(sourcePath, 'utf8'));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: CHANGELOG_FILE, source: readFileSync(sourcePath, 'utf8') });
    },
  };
}

/**
 * Vite plugin that writes dist/version.json and serves /version.json from the dev server,
 * so the update check works the same in `npm run dev`. `getEnv` returns the deploy environment
 * (deployEnvPlugin's `api.env`), read when the file is written.
 */
export function versionJsonPlugin(info, getEnv = () => 'production') {
  const text = () => versionJson({ ...info, env: getEnv() });
  return {
    name: 'app-version-json',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || req.url.split('?')[0] !== `/${VERSION_FILE}`) return next();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(text());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: VERSION_FILE, source: text() });
    },
  };
}
