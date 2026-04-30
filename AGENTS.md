# AGENTS

## Scope ownership
- `frontend/`: browser UI, networking, storage, and worker integrations.
- `docs/`: protocol, deployment, and validation checklists.

## Guardrails
- Keep document content peer-to-peer over WebRTC only.
- Do not introduce a repository-owned signaling server.
- Keep rendezvous/bootstrap metadata separate from document payload content.
- Preserve static-hosting compatibility for the web app.

## Validation commands
- Root: `npm test`, `npm run test:coverage` (frontend coverage)
- In `frontend/`: `npm run build`, `npm run test:run` (vitest), `npm run test:coverage` (see `vitest.config.ts` for global thresholds: 80% lines/statements/functions, 65% branches)

## Required docs updates
If P2P protocol, bootstrap/build steps, or storage provider behavior changes, update:
- `docs/protocol.md`
- `docs/deployment.md`
- `docs/dod-checklist.md`
