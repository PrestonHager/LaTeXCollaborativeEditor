# Serverless P2P Protocol

Overview
- This document describes the client-side, serverless peer-to-peer protocol used by the editor. It emphasizes privacy (document bodies stay peer-to-peer) and reliability (public rendezvous endpoints help peers bootstrap without a central signaling server).

Rendezvous and session bootstrap
- Session links include a room identifier, e.g. ?room=<id>.
- Peers join the same P2P topic/room via public rendezvous/bootstrap endpoints.
- No repository-owned signaling server is required.

Transport behavior
- The app uses a transport layer over a third-party rendezvous infrastructure (WebRTC-like semantics).
- ICE configuration starts with STUN, with optional TURN fallback for restricted NATs.
- UI surfaces connection states: Discovering, Dialing, Connected, Relayed, Reconnecting, Failed.

Document payload channel
- Document updates are exchanged peer-to-peer as action payloads.
- Rendezvous metadata does not carry document bodies.
- LaTeX source text remains entirely within peer-to-peer update messages.

LaTeX preview channel
- Preview rendering is performed locally in the browser using LaTeX.js.
- Assets (CSS/fonts/scripts) may be loaded from public CDNs; document LaTeX content is never sent to a server for preview.

Security and privacy notes
- All document payloads are exchanged directly between peers.
- Rendezvous metadata contains only routing/session information, not document content.
- Preview rendering happens locally within a sandboxed iframe when possible.
