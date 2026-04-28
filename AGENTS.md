# AGENTS

## Scope ownership
- `frontend/`: browser UI, networking, storage, and worker integrations.
- `rust-core/`: CRDT and protocol primitives exported to WebAssembly.
- `rust-tex/`: LaTeX compile facade exported to WebAssembly.
- `docs/`: protocol, deployment, and validation checklists.

## Guardrails
- Keep document content peer-to-peer over WebRTC only.
- Signaling server must only relay SDP/ICE metadata.
- Preserve static-hosting compatibility for the web app.

## Validation commands
- In `frontend/`: `npm run build`
- In `rust-core/`: `cargo test`
- In `rust-tex/`: `cargo test`

## Required docs updates
If signaling protocol, build steps, or storage provider behavior changes, update:
- `docs/protocol.md`
- `docs/deployment.md`
- `docs/dod-checklist.md`
