#!/usr/bin/env node
// The updater config a release build adds with `tauri build --config <file>` (issue #179,
// docs/desktop.md "Updates"). It isn't in tauri.conf.json, so a build without the signing key
// (local, or a pull request) has no updater and no updater artifacts instead of failing.
//
// Usage: TAURI_UPDATER_PUBKEY=<public key> node scripts/updater-config.mjs > updater.conf.json
// The public key is the maintainer's (`tauri signer generate`), kept in the Actions variable
// TAURI_UPDATER_PUBKEY. Only the private key and its password are secrets.
import { fileURLToPath } from 'node:url';

/**
 * Where installed apps look for updates: the latest.json attached to the newest GitHub release.
 * GitHub's "latest" skips pre-releases, so -rc builds never reach users.
 */
export const UPDATER_ENDPOINT = 'https://github.com/PrestonHager/LaTeXCollaborativeEditor/releases/latest/download/latest.json';

/** The --config overlay for a public key. Throws without one. */
export function updaterConfig(pubkey) {
  const key = (pubkey ?? '').trim();
  if (!key) throw new Error('TAURI_UPDATER_PUBKEY is empty: the updater needs the public key from `tauri signer generate`.');
  return {
    bundle: { createUpdaterArtifacts: true },
    plugins: {
      updater: {
        pubkey: key,
        endpoints: [UPDATER_ENDPOINT],
        // Windows: the installer shows its progress but asks nothing.
        windows: { installMode: 'passive' },
      },
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(updaterConfig(process.env.TAURI_UPDATER_PUBKEY), null, 2)}\n`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
