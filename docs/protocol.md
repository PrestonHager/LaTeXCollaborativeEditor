# Serverless P2P Protocol

## Rendezvous and session bootstrap
- Session links include `?room=<id>`.
- Browser peers join the same P2P topic/room using public rendezvous bootstrap endpoints.
- No repository-owned signaling server is required.

## Transport behavior
- The application uses a transport adapter over third-party rendezvous infrastructure.
- ICE configuration uses STUN first with optional TURN fallback for restrictive NATs.
- Connection states surfaced to UI: `Discovering`, `Dialing`, `Connected`, `Relayed`, `Reconnecting`, `Failed`.

## Document payload channel
- Document updates are exchanged peer-to-peer as action payloads.
- Rendezvous metadata does not carry document bodies.
