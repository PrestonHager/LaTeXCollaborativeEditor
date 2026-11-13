# AGENTS

## Scope ownership
- `frontend/`: browser UI, networking, storage, and worker integrations.
- `docs/`: protocol, deployment, and validation checklists.
- `frontend/dev/regression/`: the dev-only regression checklist and test LaTeX project. Never import it from production code paths.

## Guardrails
- Keep document content peer-to-peer over WebRTC only.
- Do not introduce a repository-owned signaling server.
- Keep rendezvous/bootstrap metadata separate from document payload content.
- Preserve static-hosting compatibility for the web app.

## Validation commands
- Root: `npm test`, `npm run test:coverage` (frontend coverage), `npm run test:load-time` (optional, throttled load time; see `docs/qa-runbook.md`)
- In `frontend/`: `npm run build` (fails if the initial load is over the 250 kB gzip budget or a lazy chunk is over 5 MB; see `scripts/check-bundle-size.mjs`), `npm run test:run` (vitest), `npm run test:coverage` (see `vitest.config.ts` for global thresholds: 80% lines/statements/functions, 65% branches)

## Required docs updates
If P2P protocol, bootstrap/build steps, or storage provider behavior changes, update:
- `docs/protocol.md`
- `docs/deployment.md`
- `docs/dod-checklist.md`

## Versioning
- The version is `frontend/package.json` `version` (SemVer). The root `package.json` follows it.
- Add a line under `## [Unreleased]` in `CHANGELOG.md` for user-facing changes.
- Bump `PROTOCOL_VERSION` in `frontend/src/collab/messages.ts` only for a P2P change older peers can't handle.
- Releases are a `vX.Y.Z` tag on `main`; `.github/workflows/release.yml` makes the GitHub release. Only maintainers tag.
- Details: `docs/versioning.md`.

## Regression checklist
When a PR adds, changes, or removes a user-facing feature, update `frontend/dev/regression/checklist.md` in the same PR.
If the preview can render something new, add it to the test project in `frontend/dev/regression/project/` with a `% Expect:` comment.
Both only load in `npm run dev` (palette: **Open regression test project** and **Open regression checklist**), so `npm run build` must not include them.
