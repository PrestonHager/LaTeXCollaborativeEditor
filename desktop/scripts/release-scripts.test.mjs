// Tests for the release scripts (issue #179). Run with `npm test` in desktop/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UPDATER_ENDPOINT, updaterConfig } from './updater-config.mjs';
import { archsOf, assetName, kindOf, prepareReleaseAssets } from './release-assets.mjs';

test('the updater overlay needs a public key and only points at GitHub Releases', () => {
  assert.throws(() => updaterConfig(''), /TAURI_UPDATER_PUBKEY/);
  assert.throws(() => updaterConfig(undefined), /TAURI_UPDATER_PUBKEY/);
  const config = updaterConfig(' KEY \n');
  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.equal(config.plugins.updater.pubkey, 'KEY');
  assert.deepEqual(config.plugins.updater.endpoints, [UPDATER_ENDPOINT]);
  assert.match(UPDATER_ENDPOINT, /^https:\/\/github\.com\/PrestonHager\/LaTeXCollaborativeEditor\/releases\/latest\/download\/latest\.json$/);
});

test('installers are named and sorted by OS, bundle and arch', () => {
  assert.equal(kindOf('App_0.2.0_amd64.AppImage').bundle, 'appimage');
  assert.equal(kindOf('App_0.2.0_x64-setup.exe').bundle, 'nsis');
  assert.equal(kindOf('App_0.2.0_x64_en-US.msi').bundle, 'msi');
  assert.equal(kindOf('App.app.tar.gz').os, 'darwin');
  assert.equal(kindOf('App_0.2.0_universal.dmg').bundle, null);
  assert.equal(kindOf('notes.txt'), null);
  assert.deepEqual(archsOf('App_0.2.0_amd64.deb', 'linux'), ['x86_64']);
  assert.deepEqual(archsOf('App-0.2.0-1.aarch64.rpm', 'linux'), ['aarch64']);
  assert.deepEqual(archsOf('App.app.tar.gz', 'darwin'), ['x86_64', 'aarch64']);
  assert.equal(assetName('LaTeX Collaborative Editor_0.2.0_amd64.AppImage'), 'LaTeX-Collaborative-Editor_0.2.0_amd64.AppImage');
});

function fakeArtifacts(signed) {
  const root = mkdtempSync(join(tmpdir(), 'lce-release-'));
  const put = (path, text) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const files = [
    'desktop-linux-unsigned/release/bundle/appimage/LaTeX Collaborative Editor_0.2.0_amd64.AppImage',
    'desktop-linux-unsigned/release/bundle/deb/LaTeX Collaborative Editor_0.2.0_amd64.deb',
    'desktop-windows-unsigned/release/bundle/nsis/LaTeX Collaborative Editor_0.2.0_x64-setup.exe',
    'desktop-windows-unsigned/release/bundle/msi/LaTeX Collaborative Editor_0.2.0_x64_en-US.msi',
    'desktop-macos-unsigned/universal-apple-darwin/release/bundle/macos/LaTeX Collaborative Editor.app.tar.gz',
    'desktop-macos-unsigned/universal-apple-darwin/release/bundle/dmg/LaTeX Collaborative Editor_0.2.0_universal.dmg',
  ];
  for (const file of files) {
    put(file, `bytes of ${file}`);
    if (signed && !file.endsWith('.dmg') && !file.endsWith('.deb')) put(`${file}.sig`, `sig-${file.split('.').pop()}\n`);
  }
  // The .app folder next to the tarball is not an asset.
  put('desktop-macos-unsigned/universal-apple-darwin/release/bundle/macos/LaTeX Collaborative Editor.app/Contents/Info.plist', 'plist');
  return root;
}

test('a signed release gets every installer, its .sig, checksums and latest.json', () => {
  const artifactsDir = fakeArtifacts(true);
  const outDir = join(artifactsDir, 'out');
  const { files, manifest } = prepareReleaseAssets({
    artifactsDir,
    outDir,
    version: 'v0.2.0',
    tag: 'v0.2.0',
    repo: 'PrestonHager/LaTeXCollaborativeEditor',
    notes: 'Fixed things.',
    now: new Date('2026-11-14T00:00:00Z'),
  });
  assert.ok(files.includes('latest.json'));
  assert.ok(files.includes('SHA256SUMS.txt'));
  assert.ok(!files.some((file) => file.includes(' ')));
  assert.ok(!files.some((file) => file.includes('Info.plist')));
  assert.deepEqual(readdirSync(outDir).sort(), [...files].sort());
  assert.equal(manifest.version, '0.2.0');
  assert.equal(manifest.notes, 'Fixed things.');
  assert.equal(manifest.pub_date, '2026-11-14T00:00:00.000Z');
  const keys = Object.keys(manifest.platforms).sort();
  assert.deepEqual(keys, [
    'darwin-aarch64',
    'darwin-aarch64-app',
    'darwin-x86_64',
    'darwin-x86_64-app',
    'linux-x86_64',
    'linux-x86_64-appimage',
    'windows-x86_64',
    'windows-x86_64-msi',
    'windows-x86_64-nsis',
  ]);
  assert.equal(manifest.platforms['linux-x86_64'].signature, 'sig-AppImage');
  assert.equal(
    manifest.platforms['windows-x86_64'].url,
    'https://github.com/PrestonHager/LaTeXCollaborativeEditor/releases/download/v0.2.0/LaTeX-Collaborative-Editor_0.2.0_x64-setup.exe',
  );
  assert.equal(manifest.platforms['darwin-aarch64'], manifest.platforms['darwin-x86_64']);
  const sums = readFileSync(join(outDir, 'SHA256SUMS.txt'), 'utf8');
  assert.match(sums, /^[0-9a-f]{64} {2}LaTeX-Collaborative-Editor_0\.2\.0_amd64\.AppImage$/m);
  assert.ok(!/\.sig$/m.test(sums));
});

test('an unsigned release still gets installers and checksums, but no latest.json', () => {
  const artifactsDir = fakeArtifacts(false);
  const { files, manifest } = prepareReleaseAssets({ artifactsDir, outDir: join(artifactsDir, 'out'), version: '0.2.0', tag: 'v0.2.0', repo: 'o/r' });
  assert.equal(manifest, null);
  assert.ok(!files.includes('latest.json'));
  assert.ok(files.includes('SHA256SUMS.txt'));
  assert.equal(files.filter((file) => file.endsWith('.sig')).length, 0);
});
