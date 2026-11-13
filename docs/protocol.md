# Serverless P2P Protocol

Overview
- This document describes the client-side, serverless peer-to-peer protocol used by the editor. It emphasizes privacy (document bodies stay peer-to-peer) and reliability (public rendezvous endpoints help peers bootstrap without a central signaling server).

Rendezvous and session bootstrap
- Session links include a room identifier, e.g. ?room=<id>.
- Peers join the same P2P topic/room via public rendezvous/bootstrap endpoints.
- Those endpoints are WebTorrent trackers, used through Trystero's torrent strategy.
  The list comes from `VITE_P2P_RENDEZVOUS` and is passed to Trystero as `relayConfig.urls`, so Trystero never falls back to its own relay list.
- Trackers only see the hashed room topic and WebRTC offers and answers, never document content.
- No repository-owned signaling server is required.
- The host's room id is kept in the tab's sessionStorage after Share, so reloading the host tab rejoins the same room and guest links keep working.
- The room id is stored apart from the saved document, since it's rendezvous metadata and not content.
- The host can click New link to leave the current room and start a fresh one, which disconnects anyone on the old link.

Transport behavior
- The app uses a transport layer over a third-party rendezvous infrastructure (WebRTC-like semantics).
- ICE configuration starts with STUN, with optional TURN fallback for restricted NATs.
- UI surfaces connection states, with the number of connected peers next to them:
  - Not sharing: not in a room.
  - Waiting for peers: in a room, nobody else has joined yet.
    There is no timeout to a failed state.
  - Connected: at least one peer is connected and none go through TURN.
  - Relayed: at least one peer's selected ICE candidate pair uses a relay (TURN) candidate, checked with `RTCPeerConnection.getStats()` when the peer joins.
  - Reconnecting: the last peer left, so the app rejoins the room with backoff.

Version handshake
- When a peer joins, each side sends it `{ kind: 'hello', protocol, appVersion, commit }` on the document channel.
  - `protocol` is `PROTOCOL_VERSION` from `frontend/src/collab/messages.ts`, now `1`. It changes only when older peers can't handle the new messages.
  - `appVersion` is the app's SemVer version, like `0.1.0`, and `commit` is the short commit SHA of the build (or `dev`).
- Each peer compares the hello with its own build: `same-build`, `different-build` (same protocol, another version or commit), or `incompatible-protocol`.
  - It logs anything but `same-build` to the console. `incompatible-protocol` is a warning that says to reload.
  - It never blocks or disconnects the peer. The update prompt (issue #121) reads `SessionController.getPeerVersions()` and `onPeerVersion` to ask people to reload.
- Backward compatible both ways:
  - Builds from before the handshake drop `hello` as an unknown kind (quietly, or with a dev-only `console.warn`) and sync as before.
  - A newer peer that never gets a hello from an old one just doesn't list it. Nothing waits on the hello.
- The hello only has version numbers, never document content, and it goes over WebRTC like every other message, not through the trackers.
- How the protocol version is bumped and migrated is in `docs/versioning.md`.

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

Message validation and limits
- Anyone with the room link can join and send anything, so every incoming message is checked before it's used.
- The checks live in `frontend/src/collab/messages.ts`. They're small hand-written type checks, not a schema library.
- Bad messages are dropped quietly. In dev builds they also log a `console.warn` saying why.
- Messages on the document channel:
  - `{ kind: 'y-update', update }`: `update` is an array of bytes (integers 0 to 255), at most 10 MB, and it has to decode as a Yjs update.
  - `{ kind: 'snapshot', state, docId?, metadata? }`: `state` is a byte array of at most 20 MB that decodes as a Yjs update. `docId` is a string of at most 128 characters.
  - `{ kind: 'metadata', metadata }`: `metadata` is `{ title, storage }`. The title is at most 200 characters and the storage label at most 200.
  - `{ kind: 'sync-request' }`: no other fields.
  - `{ kind: 'file-request', hash }`: `hash` is 1 to 128 letters, digits, or dashes.
  - `{ kind: 'hello', protocol, appVersion, commit? }`: `protocol` is a whole number from 1 to 1,000,000. `appVersion` is 1 to 64 letters, digits, dots, pluses, or dashes. `commit` is 7 to 40 lowercase hex characters, or `dev`.
  - Anything else, or anything with the wrong types, is dropped. Fields we don't know about are stripped.
- File chunks on the `file-chunk` action:
  - The data is binary and at most 256 KB per chunk.
  - `size` is at most 10 MB, `total` is between 1 and `size` (or 1 for an empty file), and `index` is below `total`.
  - The receiver stops a transfer and asks again once the chunks add up to more than `size`.
- At most 4 files come in at once. The rest wait in a queue and start as slots free up.
- At most 4 file requests are served at once, and a repeat request from the same peer for a file already going out is ignored. The peer asks again later.
- Host-only messages:
  - Only the host sends `snapshot` and `metadata`. The host ignores both if a guest sends them.
  - A guest takes the first snapshot as coming from the host, and from then on ignores snapshots from any other peer.
  - A guest ignores `metadata` unless it comes from that host. Metadata from before the first snapshot is ignored, since the snapshot carries it anyway.
  - Only the host answers `sync-request`.
- File paths in the shared `files` map have to be clean relative paths: no `..`, no leading `/`, no backslashes, no drive letters like `C:`, and at most 512 characters.
  Entries a peer writes with a bad path or an unknown kind are skipped, so they never show up in the file tree, the preview, or a zip.
- The project name in `meta` is cut to 200 characters when shown.

LaTeX preview channel
- Preview rendering is performed locally in the browser using LaTeX.js.
- LaTeX.js runs in a Web Worker with a small built-in DOM, so typing doesn't freeze on big documents.
  A new compile kills a worker that's still busy with an old one.
  If the worker can't start, or the project uses the `picture` environment (it needs real layout), the compile runs on the main thread instead.
- The preview reads the whole project, starting at the main file. `\input` and `\include` files are inlined, `\includegraphics` images go in as data URLs, and `\bibliography` gets a simple numbered reference list built from the .bib files.
- PDF and EPS figures can't be shown by LaTeX.js, so the preview puts a note in their place.
- Assets (CSS/fonts/scripts) may be loaded from public CDNs; document LaTeX content is never sent to a server for preview.

## Sequence diagrams

These follow the code in `frontend/src/net/` and `frontend/src/collab/`.
GitHub renders them, and so does MkDocs if this page is ever published.

### Bootstrap

The transport is trystero over WebTorrent trackers (`VITE_P2P_RENDEZVOUS`, or the defaults in `bootstrapConfig.ts`).
The trackers only carry WebRTC offers and answers for the room topic.
Document data starts after the data channel is open.

```mermaid
sequenceDiagram
    autonumber
    participant H as Host tab
    participant T as Public trackers
    participant G as Guest tab

    Note over H: On load the badge says Not sharing.<br/>The host is not in a room yet.
    H->>H: Share: ensureRoom() makes a random room id
    H->>H: Save the room id in sessionStorage
    H->>T: joinRoom(appId, roomId), announce
    Note over H: Badge: Waiting for peers
    H-->>H: Copy ?room= link
    G->>G: Open the link (isClient = true)
    G->>T: joinRoom(appId, roomId), announce
    T-->>H: WebRTC offer from guest
    H-->>T: Answer
    T-->>G: Answer
    Note over H,G: STUN (and TURN if set) find a path.<br/>Data channel opens.
    H->>H: onPeerJoin, badge: Connected · 1 peer<br/>(Relayed if getStats() shows TURN)
    G->>G: onPeerJoin, badge: Connected · 1 peer
    H->>G: doc-msg {kind: hello, protocol, appVersion, commit}
    G->>H: doc-msg {kind: hello, protocol, appVersion, commit}
    Note over H,G: Each side compares the other's build with its own.<br/>A mismatch is logged, never blocked.
    opt the last peer leaves
        Note over H,G: Badge: Reconnecting.<br/>Rejoin with backoff 1, 2, 4 ... 20 s.
    end
```

### Initial sync

The host sends a snapshot when a peer joins.
The guest also sends `sync-request` every second until it gets one, in case the first snapshot was missed.

```mermaid
sequenceDiagram
    autonumber
    participant H as Host
    participant G as Guest

    H->>G: doc-msg {kind: snapshot, state, docId, metadata}
    G->>H: doc-msg {kind: sync-request} (every 1 s until a snapshot lands)
    H->>G: doc-msg {kind: snapshot, ...}
    alt same docId as the guest's doc
        G->>G: Merge the snapshot
        G->>H: doc-msg {kind: y-update} with edits the host is missing
    else different docId and the guest has state
        G->>G: Throw away the old doc, start from the snapshot
        G->>G: onDocReplaced: rebind the editor and file tree
    else guest has nothing yet
        G->>G: Apply the snapshot
    end
    G->>G: Remember the host's peer id.<br/>Ignore snapshots from anyone else.
    G->>G: Show metadata (title, host storage)
```

### Live edits

```mermaid
sequenceDiagram
    autonumber
    participant A as Peer A
    participant B as Peer B
    participant C as Peer C

    A->>A: Local Yjs update (typing, rename, upload entry)
    par broadcast
        A->>B: doc-msg {kind: y-update, update}
    and
        A->>C: doc-msg {kind: y-update, update}
    end
    B->>B: Apply, recompile, rebind tree
    C->>C: Apply, recompile, rebind tree
    Note over A: Host only: after a rename or storage change
    A->>B: doc-msg {kind: metadata, title, storage}
```

### Project file transfer

Binary files are not in the Yjs doc, only their hash.
A peer that sees a hash it has no bytes for asks the room.

```mermaid
sequenceDiagram
    autonumber
    participant R as Receiver
    participant S1 as Peer with the file
    participant S2 as Another peer with the file

    R->>R: Tree change: entry with hash h, not in BlobStore or IndexedDB
    R->>S1: doc-msg {kind: file-request, hash: h}
    R->>S2: doc-msg {kind: file-request, hash: h}
    S1->>R: file-chunk (bytes, {hash, index: 0, total, size})
    S2->>R: file-chunk (bytes, {hash, index: 0, total, size})
    Note over R: Stick with S1, the first to answer.<br/>Drop chunks from S2.
    S1->>R: file-chunk ... index: total - 1
    R->>R: Join chunks, check size and SHA-256
    alt hash matches
        R->>R: BlobStore.put, save to IndexedDB, recompile
    else bad hash, a missing chunk, or 15 s with no chunk
        R->>S1: file-request again (up to 4 tries)
    end
    opt S1 leaves mid-transfer
        R->>S2: file-request again
    end
    opt a new peer joins
        R->>S2: file-request for every file still missing
    end
```

Files over 10 MB are never sent, and a chunk header claiming more than that ends the transfer.
At most 4 files come in at once, and each side serves at most 4 requests at once.
Every message and chunk in these diagrams goes through the checks in "Message validation and limits" above before it's used.

Security and privacy notes
- All document payloads are exchanged directly between peers.
- Rendezvous metadata contains only routing/session information, not document content.
- Preview rendering happens locally within a sandboxed iframe when possible.
