import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolveBuildInfo, versionJsonPlugin } from './scripts/build-info.mjs';

// The version, commit and build time go in the About dialog, the footer, the bug report form,
// the P2P hello message and dist/version.json. package.json is the source of truth (docs/versioning.md).
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const buildInfo = resolveBuildInfo({ version });

// Every HTML page that ships. Vite only builds index.html unless told otherwise, so the
// Privacy and ToS pages linked from the footer and About dialog must be listed here.
// regression.html is dev-only and stays off this list (scripts/check-build-pages.mjs checks both).
const BUILD_PAGES = ['index.html', 'privacy.html', 'tos.html'] as const;

export default defineConfig({
  base: './',
  plugins: [tailwindcss(), versionJsonPlugin(buildInfo)],
  build: {
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
  },
});
