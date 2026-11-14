#!/usr/bin/env node
// Checks the desktop shell's settings that docs/desktop.md promises, so they don't drift:
// - the app loads the bundled frontend build, never a remote URL;
// - its version is frontend/package.json's;
// - the Content-Security-Policy is the web one: Tauri adds no header of its own, and the bundled
//   index.html still has the CSP <meta> tag (a desktop build must not use VITE_DISABLE_CSP=1);
// - the window's only Tauri permission opens https links in the browser, and no remote origin gets any.
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
for (const window of conf.app?.windows ?? []) {
  const url = window.url ?? 'index.html';
  check(!/^[a-z][a-z0-9+.-]*:/i.test(url), `Window "${window.label}" must load a bundled page, not ${url}.`);
  // Changing this moves IndexedDB and localStorage on Windows, losing every local project (docs/desktop.md).
  check(window.useHttpsScheme === true, `Window "${window.label}" must keep "useHttpsScheme": true.`);
}

const security = conf.app?.security ?? {};
check(security.csp === null, 'app.security.csp must stay null: the CSP <meta> tag in frontend/index.html is the policy (docs/desktop.md, Security).');
check(!security.dangerousDisableAssetCspModification, 'dangerousDisableAssetCspModification only matters with a Tauri CSP, which this app does not set.');
check(!security.assetProtocol?.enable, 'The asset protocol stays off until a feature needs it.');
check(conf.app?.withGlobalTauri !== true, 'withGlobalTauri stays off: the frontend only calls the opener, through __TAURI_INTERNALS__ (frontend/src/app/desktopShell.ts).');

const indexHtml = read(join(repo, 'frontend', 'index.html'));
check(/<meta\s+http-equiv=["']Content-Security-Policy["']/i.test(indexHtml), 'frontend/index.html must keep its CSP <meta> tag.');

const capabilitiesDir = join(tauriDir, 'capabilities');
const capabilityFiles = readdirSync(capabilitiesDir).filter((name) => name.endsWith('.json'));
check(capabilityFiles.length > 0, 'Expected at least one capability file in src-tauri/capabilities.');
for (const name of capabilityFiles) {
  const capability = json(join(capabilitiesDir, name));
  check(!capability.remote, `${name}: no remote origin may get Tauri permissions.`);
  // The only permission: open https links in the system browser (issue #205).
  const permissions = Array.isArray(capability.permissions) ? capability.permissions : [];
  const onlyHttpsOpener =
    permissions.length === 1 &&
    permissions[0]?.identifier === 'opener:allow-open-url' &&
    JSON.stringify(permissions[0].allow) === JSON.stringify([{ url: 'https://*' }]) &&
    !permissions[0].deny;
  check(onlyHttpsOpener, `${name}: the main window's only permission is opener:allow-open-url for https://*. Adding one needs docs/desktop.md updated.`);
  check((security.capabilities ?? []).includes(capability.identifier), `${name}: list "${capability.identifier}" in app.security.capabilities.`);
}

if (errors.length) {
  console.error(`Desktop config check failed:\n${errors.map((error) => `  - ${error}`).join('\n')}`);
  process.exit(1);
}
const version = json(join(repo, 'frontend', 'package.json')).version;
console.log(`Desktop config OK: version ${version}, bundled frontend, web CSP, only the https opener.`);
