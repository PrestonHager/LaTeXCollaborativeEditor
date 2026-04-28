# Signaling and P2P Protocol

## Signaling messages (WebSocket)
- `join`: join a room by ID
- `offer`: forward SDP offer to room peers
- `answer`: forward SDP answer to room peers
- `ice`: forward ICE candidates

Signaling servers are metadata relays only. Document text is not sent via signaling.

## Data channel payload
- Current MVP sends whole-document snapshots as UTF-8 strings for interoperability.
- Planned optimization: send compact CRDT ops encoded from `rust-core`.
