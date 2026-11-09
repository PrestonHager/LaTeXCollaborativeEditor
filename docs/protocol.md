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

Project sync
- A share link shares the whole project, not one file.
- The Yjs doc holds the project:
  - `files` is a Y.Map from a stable file id to its path and kind (text, binary, or folder). Binary entries carry a SHA-256 content hash and size.
  - Each text file has its own top-level Y.Text named `file:<id>`.
  - `meta` holds the project name and the main file id.
- A rename or move writes one key in `files`, so ids (and open editors) survive it.
- Two renames of the same file at once settle on one of the names, the same on every peer.
- A rename and a delete of the same file at once keep the renamed file, so no work is lost.
- Two peers making the same path at once both keep their files. The one with the later id shows up as "name (2).ext" on every peer.
- A folder move is one change per file inside it. A file a peer adds to the old folder at the same moment stays under the old path.
- Docs from before projects (one Y.Text called `doc`) become a one-file project on the host. The text stays where it was, so old room links and saved sessions keep working.

File transfer
- Binary files (images, PDFs and so on) are not stored in the Yjs doc. Only their hash is.
- A peer missing a file sends `{ kind: 'file-request', hash }` on the document channel.
- Any peer that has it answers with binary chunks on a separate `file-chunk` action, each tagged with `{ hash, index, total, size }`.
- Chunks are 64 KB. The receiver sticks with the first peer that answers, shows progress, and checks the hash before keeping the file.
- If the sender stalls or leaves, the receiver asks again (a few tries, then it gives up).
- Files over 10 MB are not sent or accepted.
- File bytes only travel between peers over WebRTC, the same as document text. Nothing is uploaded to a server.
- Peers keep files they've seen in IndexedDB by hash, so a reload doesn't have to ask again.

LaTeX preview channel
- Preview rendering is performed locally in the browser using LaTeX.js.
- The preview reads the whole project, starting at the main file. `\input` and `\include` files are inlined, `\includegraphics` images go in as data URLs, and `\bibliography` gets a simple numbered reference list built from the .bib files.
- PDF and EPS figures can't be shown by LaTeX.js, so the preview puts a note in their place.
- Assets (CSS/fonts/scripts) may be loaded from public CDNs; document LaTeX content is never sent to a server for preview.

Security and privacy notes
- All document payloads are exchanged directly between peers.
- Rendezvous metadata contains only routing/session information, not document content.
- Preview rendering happens locally within a sandboxed iframe when possible.
