#!/usr/bin/env node
// Gets the desktop installers ready for a GitHub release (issue #179, docs/desktop.md "Updates"):
// copies them out of the build artifacts with names GitHub keeps as they are, writes
// SHA256SUMS.txt, and, when the build signed them for the updater, latest.json.
//
// Usage: node scripts/release-assets.mjs <artifacts dir> <out dir> --version 0.2.0 --tag v0.2.0
//          [--notes-file notes.md] [--repo owner/name]
// The release job (.github/workflows/desktop.yml, publish) then uploads everything in <out dir>.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Installers people download, and what the updater calls each kind (its bundle type). */
const KINDS = [
  { test: /\.AppImage$/, os: 'linux', bundle: 'appimage' },
  { test: /\.deb$/, os: 'linux', bundle: 'deb' },
  { test: /\.rpm$/, os: 'linux', bundle: 'rpm' },
  { test: /\.msi$/, os: 'windows', bundle: 'msi' },
  { test: /\.exe$/, os: 'windows', bundle: 'nsis' },
  { test: /\.app\.tar\.gz$/, os: 'darwin', bundle: 'app' },
  // The .dmg is for first installs only; the updater uses the .app.tar.gz.
  { test: /\.dmg$/, os: 'darwin', bundle: null },
];

/** The updater's default bundle per OS, for `{os}-{arch}` keys an older app looks up. */
const DEFAULT_BUNDLE = { linux: 'appimage', windows: 'nsis', darwin: 'app' };

export function kindOf(name) {
  return KINDS.find((kind) => kind.test.test(name)) ?? null;
}

/** The CPU archs a file is for, from its name. A macOS file without one is the universal app. */
export function archsOf(name, os) {
  if (/aarch64|arm64/i.test(name)) return ['aarch64'];
  if (/x86_64|amd64|x64/i.test(name)) return ['x86_64'];
  if (os === 'darwin') return ['x86_64', 'aarch64'];
  return ['x86_64'];
}

/** GitHub turns spaces in asset names into dots; pick the name ourselves so the URLs match. */
export const assetName = (name) => name.replace(/\s+/g, '-');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    // A macOS .app is a folder; the .app.tar.gz next to it is what ships.
    if (entry.isDirectory()) {
      if (!entry.name.endsWith('.app')) out.push(...walk(path));
    } else out.push(path);
  }
  return out;
}

/**
 * Collect installers (and their .sig files) from the artifacts, copy them to outDir and build the
 * updater manifest. Returns { files, manifest }; manifest is null when nothing was signed.
 */
export function prepareReleaseAssets({ artifactsDir, outDir, version, tag, repo, notes = '', now = new Date() }) {
  mkdirSync(outDir, { recursive: true });
  const files = [];
  const platforms = {};
  const seen = new Set();
  for (const path of walk(artifactsDir).sort()) {
    const name = basename(path);
    const kind = kindOf(name);
    if (!kind) continue;
    const asset = assetName(name);
    if (seen.has(asset)) throw new Error(`Two installers would both be called ${asset}.`);
    seen.add(asset);
    copyFileSync(path, join(outDir, asset));
    files.push(asset);
    const sigPath = `${path}.sig`;
    if (!kind.bundle || !existsSync(sigPath)) continue;
    copyFileSync(sigPath, join(outDir, `${asset}.sig`));
    files.push(`${asset}.sig`);
    const entry = {
      signature: readFileSync(sigPath, 'utf8').trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(asset)}`,
    };
    for (const arch of archsOf(name, kind.os)) {
      platforms[`${kind.os}-${arch}-${kind.bundle}`] = entry;
      if (DEFAULT_BUNDLE[kind.os] === kind.bundle) platforms[`${kind.os}-${arch}`] = entry;
    }
  }
  const sums = files
    .filter((file) => !file.endsWith('.sig'))
    .map((file) => `${createHash('sha256').update(readFileSync(join(outDir, file))).digest('hex')}  ${file}`);
  if (sums.length) {
    writeFileSync(join(outDir, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
    files.push('SHA256SUMS.txt');
  }
  let manifest = null;
  if (Object.keys(platforms).length) {
    manifest = { version: version.replace(/^v/, ''), notes, pub_date: now.toISOString(), platforms };
    writeFileSync(join(outDir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    files.push('latest.json');
  }
  return { files, manifest };
}

function arg(args, name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const [artifactsDir, outDir] = args;
  const tag = arg(args, 'tag');
  const version = arg(args, 'version', tag);
  const notesFile = arg(args, 'notes-file');
  if (!artifactsDir || !outDir || !tag || !statSync(artifactsDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error('Usage: node scripts/release-assets.mjs <artifacts dir> <out dir> --tag vX.Y.Z [--version X.Y.Z] [--notes-file f] [--repo owner/name]');
    process.exit(1);
  }
  const { files, manifest } = prepareReleaseAssets({
    artifactsDir,
    outDir,
    version,
    tag,
    repo: arg(args, 'repo', process.env.GITHUB_REPOSITORY ?? 'PrestonHager/LaTeXCollaborativeEditor'),
    notes: notesFile ? readFileSync(notesFile, 'utf8').trim() : '',
  });
  console.log(files.join('\n'));
  if (!files.length) {
    console.error('No installers found.');
    process.exit(1);
  }
  if (!manifest) console.warn('::warning title=No updater files::Nothing was signed for the updater, so latest.json was not written. Set TAURI_SIGNING_PRIVATE_KEY and TAURI_UPDATER_PUBKEY (docs/desktop.md, Updates).');
}
