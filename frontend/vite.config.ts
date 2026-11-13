import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { changelogFilePlugin, resolveBuildInfo, versionJsonPlugin } from './scripts/build-info.mjs';
import { addConnectSources, removeCspMeta } from './src/security/csp';

// The version, commit and build time go in the About dialog, the footer, the bug report form,
// the P2P hello message and dist/version.json. package.json is the source of truth (docs/versioning.md).
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const buildInfo = resolveBuildInfo({ version });
const CHANGELOG_PATH = fileURLToPath(new URL('../CHANGELOG.md', import.meta.url));

// Every HTML page that ships. Vite only builds index.html unless told otherwise, so the
// Privacy and ToS pages linked from the footer and About dialog must be listed here.
// regression.html is dev-only and stays off this list (scripts/check-build-pages.mjs checks both).
const BUILD_PAGES = ['index.html', 'privacy.html', 'tos.html'] as const;

/**
 * Build-time tweaks to the CSP <meta> tags in the pages.
 * - VITE_DISABLE_CSP=1 drops the tag from every page, as a rollback switch (docs/deployment.md).
 * - The CSP in index.html allows the default trackers. If VITE_P2P_RENDEZVOUS lists others,
 *   add them to connect-src too, or the browser would block them.
 */
function cspPlugin(): Plugin {
  let disabled = false;
  let urls: string[] = [];
  return {
    name: 'csp',
    configResolved(config) {
      disabled = String(config.env.VITE_DISABLE_CSP ?? '') === '1';
      const rendezvous = String(config.env.VITE_P2P_RENDEZVOUS ?? '');
      urls = rendezvous.split(',').map((url) => url.trim()).filter(Boolean);
    },
    transformIndexHtml(html) {
      if (disabled) return removeCspMeta(html);
      return urls.length ? addConnectSources(html, urls) : html;
    },
  };
}

export default defineConfig({
  base: './',
  // The repo-root CHANGELOG.md also goes to dist/ (issue #140), for the update prompt's What's new.
  plugins: [tailwindcss(), versionJsonPlugin(buildInfo), changelogFilePlugin(CHANGELOG_PATH), cspPlugin()],
  build: {
    // scripts/check-bundle-size.mjs reads dist/.vite/manifest.json to find the initial-load graph.
    manifest: true,
    rolldownOptions: {
      input: Object.fromEntries(
        BUILD_PAGES.map((page) => [page.replace(/\.html$/, ''), fileURLToPath(new URL(`./${page}`, import.meta.url))]),
      ),
    },
  },
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(buildInfo.version),
    'import.meta.env.VITE_APP_COMMIT': JSON.stringify(buildInfo.commit),
    'import.meta.env.VITE_APP_BUILT_AT': JSON.stringify(buildInfo.builtAt),
  },
  server: {
    // Google OAuth checks the exact origin, so always serve dev on localhost:5173.
    host: 'localhost',
    port: 5173,
    strictPort: true,
    // The changelog dialog bundles ../CHANGELOG.md (issue #140), which sits above the app root.
    fs: {
      allow: [searchForWorkspaceRoot(fileURLToPath(new URL('.', import.meta.url))), CHANGELOG_PATH],
    },
  },
});
