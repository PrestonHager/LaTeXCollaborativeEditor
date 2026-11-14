#!/usr/bin/env node
// Checks the desktop shell's settings that docs/desktop.md promises, so they don't drift:
// - the app loads the bundled frontend build, never a remote URL;
// - its version is frontend/package.json's;
// - the Content-Security-Policy is the web one: Tauri adds no header of its own, and the bundled
//   index.html still has the CSP <meta> tag (a desktop build must not use VITE_DISABLE_CSP=1);
// - the window's Tauri permissions are exactly the documented ones (docs/desktop.md, Security): the
//   https opener, and for local folder projects (#178) the folder dialog and a list of fs commands
//   with no path scope of their own, so only folders picked in the dialog are reachable. No remote
//   origin gets any;
// - the build bundles LaTeX.js for an offline preview (build:desktop), and the shell builds the
//   window itself so navigation away from the app is blocked and https links go to the browser.
// Run with `npm run check` in desktop/. The desktop workflow runs it before building.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = join(desktop, 'src-tauri');
const repo = resolve(desktop, '..');
const read = (path) => readFileSync(path, 'utf8');
const json = (path) => JSON.parse(read(path));

const errors = [];
const check = (ok, message) => {
  if (!ok) errors.push(message);
};

const conf = json(join(tauriDir, 'tauri.conf.json'));

check(conf.version === '../../frontend/package.json', 'tauri.conf.json "version" must be "../../frontend/package.json", the one app version.');
check(conf.build?.frontendDist === '../../frontend/dist', 'build.frontendDist must be "../../frontend/dist", the bundled web build.');
// The desktop build ships LaTeX.js's styles and fonts, so the preview works offline (issue #181).
check(
  /\brun build:desktop\b/.test(conf.build?.beforeBuildCommand ?? ''),
  'build.beforeBuildCommand must run "npm run build:desktop" in frontend/, which bundles the LaTeX.js assets.',
);
check(/\brun dev:desktop\b/.test(conf.build?.beforeDevCommand ?? ''), 'build.beforeDevCommand must run "npm run dev:desktop" in frontend/.');
for (const window of conf.app?.windows ?? []) {
  const url = window.url ?? 'index.html';
  check(!/^[a-z][a-z0-9+.-]*:/i.test(url), `Window "${window.label}" must load a bundled page, not ${url}.`);
  // Changing this moves IndexedDB and localStorage on Windows, losing every local project (docs/desktop.md).
  check(window.useHttpsScheme === true, `Window "${window.label}" must keep "useHttpsScheme": true.`);
  // src/lib.rs builds it, with the navigation guard and the CORS header for the LaTeX.js assets.
  check(window.create === false, `Window "${window.label}" must have "create": false: src-tauri/src/lib.rs builds it with its link guards.`);
}

// The guards in src/lib.rs (docs/desktop.md, "Links"). A text check, since cargo needs WebKitGTK.
const libRs = read(join(tauriDir, 'src', 'lib.rs'));
check(/\.on_navigation\(/.test(libRs), 'src/lib.rs must keep the on_navigation guard that blocks leaving the app.');
check(/\.on_new_window\([\s\S]*?NewWindowResponse::Deny/.test(libRs), 'src/lib.rs must keep denying new windows (https goes to the browser).');
check(/fn open_https[\s\S]*?scheme\(\) != "https"/.test(libRs), 'src/lib.rs must only open https URLs in the browser.');
check(
  /ACCESS_CONTROL_ALLOW_ORIGIN/.test(libRs) && /const LATEXJS_PATH: &str = "\/latexjs\/";/.test(libRs),
  'src/lib.rs may only widen CORS for the bundled LaTeX.js assets under /latexjs/.',
);

// No static fs scope: tauri.conf.json must not grant paths through plugins.fs either.
check(!conf.plugins?.fs?.scope, 'plugins.fs.scope must stay unset: only folders picked in the dialog are reachable (#178).');
// The plugins the folder permissions belong to are registered, and persisted-scope after fs.
check(
  /tauri_plugin_dialog::init\(\)[\s\S]*tauri_plugin_fs::init\(\)[\s\S]*tauri_plugin_persisted_scope::init\(\)/.test(libRs),
  'src/lib.rs must register the dialog, fs and persisted-scope plugins, in that order.',
);

const security = conf.app?.security ?? {};
check(security.csp === null, 'app.security.csp must stay null: the CSP <meta> tag in frontend/index.html is the policy (docs/desktop.md, Security).');
check(!security.dangerousDisableAssetCspModification, 'dangerousDisableAssetCspModification only matters with a Tauri CSP, which this app does not set.');
check(!security.assetProtocol?.enable, 'The asset protocol stays off until a feature needs it.');
check(conf.app?.withGlobalTauri !== true, 'withGlobalTauri stays off: the frontend reaches Tauri through __TAURI_INTERNALS__ and the plugin packages in lazy chunks.');

const indexHtml = read(join(repo, 'frontend', 'index.html'));
check(/<meta\s+http-equiv=["']Content-Security-Policy["']/i.test(indexHtml), 'frontend/index.html must keep its CSP <meta> tag.');

// Local folder projects (#178): the dialog picks a folder and adds it to the fs scope at runtime.
// None of these carry a path of their own, and fs:deny-default keeps the app's webview data out
// even if someone picks a folder that holds it. No fs:default, no scope-* sets, no write-text-file.
const ALLOWED_PLAIN_PERMISSIONS = [
  'dialog:allow-open',
  'fs:deny-default',
  'fs:allow-exists',
  'fs:allow-stat',
  'fs:allow-read-dir',
  'fs:allow-read-file',
  'fs:allow-write-file',
  'fs:allow-mkdir',
  'fs:allow-rename',
  'fs:allow-remove',
  'fs:allow-watch',
  'fs:allow-unwatch',
];

const capabilitiesDir = join(tauriDir, 'capabilities');
const capabilityFiles = readdirSync(capabilitiesDir).filter((name) => name.endsWith('.json'));
check(capabilityFiles.length > 0, 'Expected at least one capability file in src-tauri/capabilities.');
for (const name of capabilityFiles) {
  const capability = json(join(capabilitiesDir, name));
  check(!capability.remote, `${name}: no remote origin may get Tauri permissions.`);
  // Exactly these, in this order. Adding one needs docs/desktop.md updated (Security) and this list.
  const permissions = Array.isArray(capability.permissions) ? capability.permissions : [];
  const opener = permissions[0];
  check(
    opener?.identifier === 'opener:allow-open-url' && JSON.stringify(opener.allow) === JSON.stringify([{ url: 'https://*' }]) && !opener.deny,
    `${name}: the first permission must be opener:allow-open-url for https://* only.`,
  );
  const rest = permissions.slice(1);
  // Plain strings only: an object form could add a path scope ({ identifier, allow: [{ path }] }).
  check(
    JSON.stringify(rest) === JSON.stringify(ALLOWED_PLAIN_PERMISSIONS),
    `${name}: after the opener, the permissions must be exactly ${ALLOWED_PLAIN_PERMISSIONS.join(', ')}, with no path scopes. Adding one needs docs/desktop.md updated.`,
  );
  check((security.capabilities ?? []).includes(capability.identifier), `${name}: list "${capability.identifier}" in app.security.capabilities.`);
}

if (errors.length) {
  console.error(`Desktop config check failed:\n${errors.map((error) => `  - ${error}`).join('\n')}`);
  process.exit(1);
}
const version = json(join(repo, 'frontend', 'package.json')).version;
console.log(`Desktop config OK: version ${version}, bundled frontend and LaTeX.js, web CSP, https opener and picked-folder access only, links guarded.`);
