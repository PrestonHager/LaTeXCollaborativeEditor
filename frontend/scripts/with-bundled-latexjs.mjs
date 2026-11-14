#!/usr/bin/env node
// Runs an npm script of frontend/ with VITE_LATEXJS_ASSETS=bundled, so the build ships LaTeX.js's
// styles and fonts (scripts/latexjs-assets.mjs). The desktop app's tauri.conf.json uses it through
// `npm run build:desktop` and `npm run dev:desktop`; a plain env prefix wouldn't work on Windows.
import { spawnSync } from 'node:child_process';

const script = process.argv[2];
if (!script) {
  console.error('Usage: node scripts/with-bundled-latexjs.mjs <npm script>');
  process.exit(2);
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['run', script], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, VITE_LATEXJS_ASSETS: 'bundled' },
});
process.exit(result.status ?? 1);
