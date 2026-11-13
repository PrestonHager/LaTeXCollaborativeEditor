# Versioning and releases

This page is for maintainers and contributors. It isn't in the published docs (see `exclude_docs` in `mkdocs.yml`).

## The scheme

We use [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

- Before 1.0, releases are `0.x.y`. The v1 Definition of Done (`docs/dod-checklist.md`, issue #19) ships as `1.0.0`.
- Pre-releases look like `1.0.0-rc.1`. They sort before `1.0.0`.

What counts as what here:

| Bump | When | Examples |
| --- | --- | --- |
| MAJOR | A change that breaks something people already have | A P2P message older peers can't read (a new `PROTOCOL_VERSION`); stored data or a project format an older build can't open; removing a feature people rely on |
| MINOR | A new feature, or a change people will notice | A new menu item or dialog; a new LaTeX feature in the preview; a new optional field in a peer message |
| PATCH | A fix with no new feature | A bug fix, a docs fix, a dependency update, a speed-up |

Before 1.0, a breaking change may go in a MINOR bump (`0.1.0` to `0.2.0`), as SemVer allows. Say so in the changelog.

## Source of truth

`frontend/package.json` `version` is the version.

- The root `package.json` (and both `package-lock.json` files) carry the same number. A test in `frontend/scripts/scripts.test.mjs` fails if they differ, and the release workflow checks both against the tag.
- The desktop app (`desktop/`, issue #122) takes its version from the same field: `desktop/src-tauri/tauri.conf.json` points `version` at `frontend/package.json`, so the web and desktop builds of one commit always share a number and Prepare release needs no extra step. Desktop-only fixes still bump PATCH for everyone. See `docs/desktop.md`.

## What the build bakes in

`frontend/vite.config.ts` calls `resolveBuildInfo` in `frontend/scripts/build-info.mjs`, which reads:

- `version` from `frontend/package.json`;
- `commit`, the short SHA from `git rev-parse --short HEAD`, falling back to `$GITHUB_SHA` (cut to 7 characters) and then to `dev`;
- `builtAt`, the build time as an ISO string;
- `env`, the deploy environment (only in `version.json`, not in the bundle's build info).

These go into the bundle as `import.meta.env.VITE_APP_VERSION`, `VITE_APP_COMMIT` and `VITE_APP_BUILT_AT`. App code reads them through `frontend/src/app/buildInfo.ts` (`BUILD_INFO`), never from `import.meta.env` directly. The full build is written the SemVer way, `0.1.0+abc1234` (`formatVersion`).

Where it shows up:

- **About dialog:** `Version 0.1.0 (commit abc1234, built 2026-11-13)`, with the commit linked to GitHub.
- **Footer:** `v0.1.0`, linked to the commit, with the full build in the tooltip.
- **Bug report form:** the `extra` field is prefilled with `App version: 0.1.0+abc1234`.
- **P2P hello message:** see below.
- **`dist/version.json`:** see below.

The docs site footer doesn't show the version yet.

### `version.json`

The Vite plugin `versionJsonPlugin` writes `dist/version.json` next to `index.html`:

```json
{
  "version": "0.1.0",
  "commit": "abc1234",
  "builtAt": "2026-11-13T10:00:00.000Z",
  "env": "production"
}
```

It only ever has these four fields. `env` is the deploy environment, `VITE_DEPLOY_ENV` (`production`, `staging` or `dev`, see `docs/deployment.md`). The update check ignores it: staging and production are separate sites, so a tab only ever sees its own site's file. The dev server serves the same file at `/version.json` with `Cache-Control: no-store`.

After `vite build`, `frontend/scripts/check-build-pages.mjs` fails the build if `version.json` is missing, isn't JSON, has a bad field (`env` included), or has a version that doesn't match `package.json`.

The update check fetches it, checks it with `parseVersionInfo`, and compares it with `BUILD_INFO` using `isDifferentBuild`. GitHub Pages sends `Cache-Control: max-age=600` and we can't change headers there, so the fetch bypasses the cache itself: `fetch('version.json?t=' + Date.now(), { cache: 'no-store' })`. There's no service worker, so nothing else caches it.

### The update prompt

- `frontend/src/app/updateCheck.ts` (`createUpdateChecker`) checks on load, every 15 minutes, and on window focus or `visibilitychange` to visible, at most once a minute. It only runs in production builds (`import.meta.env.PROD`).
- Any build that `isDifferentBuild` says differs counts as new, a rollback included. Each build is announced once, so **Later** holds until the next one.
- Failures are silent. Being offline, a network error, a bad status or malformed JSON double the wait, up to an hour. A 404 stops polling for the session.
- `frontend/src/app/updateFlow.ts` shows the card (`#update-prompt`, `ui/updatePrompt.ts`). **Reload to update** calls `flushBeforeReload`: it writes the session to localStorage, then runs `autosave.saveNow()` unless saving is paused. A failed save, a held conflict or files in flight stop the reload and offer **Reload anyway**. Guests only write their local state, since their edits are already in the host's doc.
- A lazy chunk that fails to load ("Failed to fetch dynamically imported module") shows the same card only when the browser is online and `version.json` names a newer build: that's an old tab missing a chunk the new deploy removed. Offline, or with the same build still live, it's the network, and a notice says so instead (see `lazyLoadFailed` in `main.ts` and `classifyLoadFailure` in `app/lazy.ts`).
- The leave prompt (`beforeunload`) is decided by `frontend/src/app/leaveGuard.ts` and is skipped for the update reload.

## Protocol and storage versions

### P2P protocol

Each peer sends a `hello` to every peer that joins: `{ kind: 'hello', protocol, appVersion, commit }` (details in `docs/protocol.md`).

- `PROTOCOL_VERSION` in `frontend/src/collab/messages.ts` is the protocol version. It's `2` now. It went from `1` to `2` with Trystero 0.26, whose new action wire format older peers can't read.
- Bump it only when an older peer would misread or break on the new messages. That's a MAJOR app bump too.
- Don't bump it for a new optional field or a new message kind. Peers already strip fields they don't know and drop kinds they don't know, so older peers just ignore them. That's how `hello` itself went in without a bump.
- `SessionController` compares each hello with its own build (`comparePeerBuild`): `same-build`, `different-build` or `incompatible-protocol`. It logs anything that isn't the same build, hands it to `onPeerVersion`, and lists it in `getPeerVersions()`. It never blocks a peer. Peers on builds from before `hello` don't send one, so they just don't show up.
- The update prompt uses that. A peer on a newer protocol shows the reload card ("A collaborator is on a newer version"), and a peer on an older one gets a notice asking them to reload. `different-build` alone shows nothing. Nothing is sent to the peer, and syncing isn't blocked yet.

### Stored data

Data in browser storage (IndexedDB `latex-editor`, `localStorage`, `sessionStorage`) and the project layout in the Yjs doc and in Drive don't have a version number of their own. They're migrated in place when an old shape is found:

- old localStorage documents move into one-file projects on first start;
- an old single `.tex` Drive file opens as a one-file project;
- a Yjs doc with only the old `doc` text becomes a one-file project on the host;
- the old `drive_access_token` in `localStorage` is deleted.

When you change a stored format:

1. Keep reading the old shape and convert it, like the list above. Never drop data an older build wrote.
2. If an older build can't read the new shape, that's a MAJOR bump. Add a `schemaVersion` field to the stored record at that point, so later migrations can tell shapes apart.
3. Write it down in `docs/deployment.md` and the changelog.

## Changelog

`CHANGELOG.md` at the repo root follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

- Add a line under `## [Unreleased]` in the PR that makes a user-facing change, under `### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed` or `### Security`.
- Write it for the people using the app, not as a commit message.
- Leave internal refactors and test-only changes out.
- The app shows this file in Help → About → View changelog. The build bundles it into a lazy chunk (`frontend/src/ui/changelogView.ts`), so there's still one copy. Its renderer only knows headings, `-` lists, paragraphs, `**bold**`, `` `code` `` and links (inline and reference-style), and shows raw HTML as text. Relative links go to the file on GitHub's `main`.
  The build also copies it to `dist/CHANGELOG.md`, and the update prompt's What's new fetches that one, so open tabs see what the new deploy changed.

## Cutting a release

PRs don't bump the version. They only add lines under `## [Unreleased]`, so parallel PRs don't fight over `package.json` and the changelog. A release bumps it once, in its own PR, made by a workflow.

`main` deploys to staging on every push. Production only gets releases, so every production deploy is a version (`docs/deployment.md`, "Staging and production").

1. Try `main` on staging. Pick the bump from the Unreleased section, using the table above.
2. Actions > **Prepare release** > Run workflow, on `main`. Choose `patch`, `minor` or `major`, or type an exact version (like `0.2.0` or `1.0.0-rc.1`). It runs `frontend/scripts/prepare-release.mjs`, which:
   - sets the version in both `package.json` files and both lockfiles;
   - renames `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` (today, UTC), puts a fresh empty `## [Unreleased]` above it, and updates the compare links at the bottom;
   - fails, changing nothing, if Unreleased is empty, the version isn't newer, or the changelog already has that version.

   Then it pushes the branch `release/vX.Y.Z` and opens the PR "Release vX.Y.Z" with the release notes in its description.
3. Check the PR. Edit the changelog wording on the branch if you like, but keep the version and the heading.
   A PR opened with `GITHUB_TOKEN` doesn't start other workflows, so its `pull_request` checks don't run on their own. Prepare release runs **Test and Coverage** on the branch itself (`workflow_dispatch`). If the checks still don't show on the PR, close and reopen it, or push a commit to the branch. Both start `pull_request` runs.
4. Merge it. `.github/workflows/tag-release.yml` runs on the push to `main`. It sees the release when `frontend/package.json`'s version went up, or the commit message names `release/vX.Y.Z` for the current version (`frontend/scripts/release-tag.mjs`). Then it:
   - tags `vX.Y.Z` (annotated) on that commit, unless the tag is already there;
   - calls `.github/workflows/release.yml`, which checks the tag is on `main`, matches both `package.json` files and has a changelog section (`frontend/scripts/release-notes.mjs`), runs the tests, builds with `VITE_DEPLOY_ENV=production`, deploys to GitHub Pages, and creates the GitHub release with that changelog section as the notes, marked as a pre-release if the version has a `-`.

   A normal PR that bumps the version by hand releases the same way when it merges.

If the release fails after tagging, fix it in a new PR, then Actions > **Release** > Run workflow on `main` with the tag to retry. That's also how to redeploy a release (for example after changing a Production variable): it deploys the tag again and refreshes the GitHub release's notes.
If the tagged commit itself is broken, release the fix as the next patch. Don't move a tag that's been deployed.

You can still tag by hand (`git tag -a vX.Y.Z -m vX.Y.Z && git push origin vX.Y.Z`) on a commit on `main` whose version already matches. That runs `release.yml` on the tag, which can only deploy if the github-pages environment allows `v*` tags (`docs/deployment.md`, one-time setup). Running Release on `main` with the tag needs no such rule.

Between releases, staging runs the last released version number from `main`, so the commit in `version.json` and the footer tells builds apart. `version.json`'s `env` says which site a build is for.

The first release under this flow is **v0.2.0**. Unreleased has the Trystero protocol break, which before 1.0 goes in a minor bump (see the scheme above).

## Not done yet

- The version in the docs site footer.
