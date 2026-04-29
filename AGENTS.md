# AGENTS

## Scope ownership
- `frontend/`: browser UI, networking, storage, and worker integrations.
- `rust-core/`: CRDT and protocol primitives exported to WebAssembly.
- `rust-tex/`: LaTeX compile facade exported to WebAssembly.
- `docs/`: protocol, deployment, and validation checklists.

## Guardrails
- Keep document content peer-to-peer over WebRTC only.
- Do not introduce a repository-owned signaling server.
- Keep rendezvous/bootstrap metadata separate from document payload content.
- Preserve static-hosting compatibility for the web app.

## Validation commands
- Root: `npm test` (runs all test suites), `npm run test:coverage` (all coverage)
- In `frontend/`: `npm run build`, `npm run test:run` (vitest), `npm run test:coverage` (79% line threshold)
- In `rust-core/`: `cargo test`, `cargo llvm-cov --fail-under-lines 97`
- In `rust-tex/`: `cargo test`, `cargo llvm-cov --fail-under-lines 87`

## Required docs updates
If P2P protocol, bootstrap/build steps, or storage provider behavior changes, update:
- `docs/protocol.md`
- `docs/deployment.md`
- `docs/dod-checklist.md`
