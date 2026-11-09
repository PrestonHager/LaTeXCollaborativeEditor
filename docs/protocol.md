# Serverless P2P Protocol

Overview
- This document describes the client-side, serverless peer-to-peer protocol used by the editor. It emphasizes privacy (document bodies stay peer-to-peer) and reliability (public rendezvous endpoints help peers bootstrap without a central signaling server).

Rendezvous and session bootstrap
- Session links include a room identifier, e.g. ?room=<id>.
- Peers join the same P2P topic/room via public rendezvous/bootstrap endpoints.
- No repository-owned signaling server is required.
- The host's room id is kept in the tab's sessionStorage after Share, so reloading the host tab rejoins the same room and guest links keep working.
- The room id is stored apart from the saved document, since it's rendezvous metadata and not content.
- The host can click New link to leave the current room and start a fresh one, which disconnects anyone on the old link.

Transport behavior
- The app uses a transport layer over a third-party rendezvous infrastructure (WebRTC-like semantics).
- ICE configuration starts with STUN, with optional TURN fallback for restricted NATs.
- UI surfaces connection states: Discovering, Dialing, Connected, Relayed, Reconnecting, Failed.

Document payload channel
- Document updates are exchanged peer-to-peer as action payloads.
- Rendezvous metadata does not carry document bodies.
- LaTeX source text remains entirely within peer-to-peer update messages.
- The host sends a full Yjs snapshot to each guest that joins, tagged with a doc id.
- The host saves its Yjs state and doc id with the local app session, so a reload resumes the same doc instead of starting a new one.
- This saved state lives in browser storage only and never goes into rendezvous metadata.
- A guest only accepts snapshots from the peer that is the host, and picks up the new host after the old one leaves.
- If the snapshot has the guest's doc id, the guest merges it and sends back any edits the host is missing.
- If the doc id is different, the guest throws away its doc and starts over from the snapshot, so its updates never point at items the host doesn't have.

LaTeX preview channel
- Preview rendering is performed locally in the browser using LaTeX.js.
- Assets (CSS/fonts/scripts) may be loaded from public CDNs; document LaTeX content is never sent to a server for preview.

Security and privacy notes
- All document payloads are exchanged directly between peers.
- Rendezvous metadata contains only routing/session information, not document content.
- Preview rendering happens locally within a sandboxed iframe when possible.
