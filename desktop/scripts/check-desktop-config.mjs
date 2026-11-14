#!/usr/bin/env node
// Checks the desktop shell's settings that docs/desktop.md promises, so they don't drift:
// - the app loads the bundled frontend build, never a remote URL;
// - its version is frontend/package.json's;
// - the Content-Security-Policy is the web one: Tauri adds no header of its own, and the bundled
//   index.html still has the CSP <meta> tag (a desktop build must not use VITE_DISABLE_CSP=1);
// - the window's Tauri permissions are exactly the documented ones (docs/desktop.md, Security): the
//   https opener, and for local folder projects (#178) the folder dialog and a list of fs commands
//   with no path scope of their own, so only folders picked in the dialog are reachable, and for
//   Google sign-in (#177) the app's three sign-in commands, and its two update commands (#179),
//   with the updater config only added at release time. No remote origin gets any;
// - the build bundles LaTeX.js for an offline preview (build:desktop), and the shell builds the
//   window itself so navigation away from the app is blocked and https links go to the browser.
// Run with `npm run check` in desktop/. The desktop workflow runs it before building.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  // Google sign-in through the system browser (#177): the app's own commands in src/google_auth.rs.
  // They hand the page short-lived access tokens; the refresh token stays in the OS keychain.
  'allow-google-sign-in',
  'allow-google-access-token',
  'allow-google-sign-out',
  // App updates (#179): the app's two update commands in src/updates.rs. The page gets no
  // updater:* permission; Rust checks signatures and installs.
  'allow-update-check',
  'allow-update-install',
];
// The app commands build.rs may declare, each with its allow-* permission above.
const APP_COMMANDS = ['google_sign_in', 'google_access_token', 'google_sign_out', 'update_check', 'update_install'];


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

// Google sign-in (#177, docs/desktop.md "Google sign-in").
const buildRs = read(join(tauriDir, 'build.rs'));
const declared = [...(buildRs.match(/\.commands\(&\[([^\]]*)\]/)?.[1] ?? '').matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
check(
  JSON.stringify(declared) === JSON.stringify(APP_COMMANDS),
  `build.rs must declare exactly the app commands ${APP_COMMANDS.join(', ')} in its AppManifest, so each needs a permission.`,
);
const handlers = [...(libRs.match(/generate_handler!\[([\s\S]*?)\]/)?.[1] ?? '').matchAll(/(?:google_auth|updates)::([a-z_]+)/g)].map((match) => match[1]);
check(JSON.stringify(handlers) === JSON.stringify(APP_COMMANDS), 'src/lib.rs may only register the Google sign-in and update commands with invoke_handler.');
const authRs = read(join(tauriDir, 'src', 'google_auth.rs'));
const accessTokenStruct = authRs.match(/pub struct AccessToken \{([^}]*)\}/)?.[1] ?? '';
check(
  /access_token/.test(accessTokenStruct) && !/refresh/i.test(accessTokenStruct),
  'src/google_auth.rs: what the page gets (AccessToken) must never carry the refresh token.',
);
check(/const SCOPE: &str = "https:\/\/www\.googleapis\.com\/auth\/drive\.file";/.test(authRs), 'src/google_auth.rs must ask for the drive.file scope only, like the web app.');
// The only script the shell puts in the page says whether sign-in is set up, never the client.
check(
  (libRs.match(/initialization_script/g) ?? []).length === 1 && /\.initialization_script\(desktop_info_script\(/.test(libRs),
  'src/lib.rs may only add the desktop_info_script initialization script.',
);
// No OAuth client in the repository: it comes from the build environment (desktop.yml secrets).
for (const [name, text] of [['tauri.conf.json', JSON.stringify(conf)], ['src/google_auth.rs', authRs], ['src/lib.rs', libRs]]) {
  check(!/\d{6,}-[a-z0-9]{16,}\.apps\.googleusercontent\.com/.test(text), `${name} must not hold a Google OAuth client id; it comes from GOOGLE_DESKTOP_CLIENT_ID.`);
  check(!/GOCSPX-/.test(text), `${name} must not hold a Google client secret.`);
}

// Updates (#179): the updater config only comes from scripts/updater-config.mjs at release time,
// pointing at GitHub Releases over https, so builds without the signing key have no updater.
check(!conf.plugins?.updater, 'plugins.updater must not be in tauri.conf.json: release builds add it with scripts/updater-config.mjs.');
check(conf.bundle?.createUpdaterArtifacts !== true, 'bundle.createUpdaterArtifacts stays off in tauri.conf.json: the release overlay turns it on with the signing key.');
const { updaterConfig, UPDATER_ENDPOINT } = await import(pathToFileURL(join(desktop, 'scripts', 'updater-config.mjs')).href);
check(
  UPDATER_ENDPOINT === 'https://github.com/PrestonHager/LaTeXCollaborativeEditor/releases/latest/download/latest.json',
  'The updater endpoint must be the latest GitHub release\'s latest.json (docs/desktop.md, Updates).',
);
const overlay = updaterConfig('test-key');
check(
  JSON.stringify(overlay.plugins.updater.endpoints) === JSON.stringify([UPDATER_ENDPOINT]) && !overlay.plugins.updater.dangerousInsecureTransportProtocol,
  'The updater overlay may only use the https GitHub Releases endpoint.',
);
check(/\.plugin\(tauri_plugin_updater::Builder::new\(\)\.build\(\)\)/.test(libRs) && /if updater \{/.test(libRs), 'src/lib.rs must register the updater only when the release config has it.');

const security = conf.app?.security ?? {};
check(security.csp === null, 'app.security.csp must stay null: the CSP <meta> tag in frontend/index.html is the policy (docs/desktop.md, Security).');
check(!security.dangerousDisableAssetCspModification, 'dangerousDisableAssetCspModification only matters with a Tauri CSP, which this app does not set.');
check(!security.assetProtocol?.enable, 'The asset protocol stays off until a feature needs it.');
check(conf.app?.withGlobalTauri !== true, 'withGlobalTauri stays off: the frontend reaches Tauri through __TAURI_INTERNALS__ and the plugin packages in lazy chunks.');

const indexHtml = read(join(repo, 'frontend', 'index.html'));
check(/<meta\s+http-equiv=["']Content-Security-Policy["']/i.test(indexHtml), 'frontend/index.html must keep its CSP <meta> tag.');

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
console.log(`Desktop config OK: version ${version}, bundled frontend and LaTeX.js, web CSP, https opener, picked-folder access, Google sign-in and update commands only, links guarded.`);
