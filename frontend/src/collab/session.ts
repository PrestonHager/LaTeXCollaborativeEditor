import { getBootstrapConfig } from '../net/bootstrapConfig';
import { PeerSession } from '../net/peerSession';
import type { TransportState } from '../net/p2pTransport';
import { YjsDocSync, isWellFormedUpdate } from './yjsSync';
import { FileTransfer } from './fileTransfer';
import type { BlobStore } from '../project/blobStore';
import { dropMessage, parseChunk, parseSyncMessage, type SyncMessage } from './messages';

type SessionConfig = {
  isHost: boolean;
  blobs: BlobStore;
  /** Gets the connection state and how many peers are connected. */
  onConnectionState: (state: TransportState, peers: number) => void;
  /** Runs after a peer's change lands in the doc. */
  onRemoteChange?: () => void;
  onRemoteMetadata?: (metadata: { title: string; storage: string }) => void;
  getLocalMetadata?: () => { title: string; storage: string };
  initialState?: PersistedDocState;
  /** A guest got a whole new doc from the host, so anything bound to the old one has to rebind. */
  onDocReplaced?: () => void;
  onFileProgress?: (hash: string, fraction: number | null) => void;
};

export type PersistedDocState = { docId: string; state: Uint8Array };

export class SessionController {
  private roomId: string | null = null;
  private session: PeerSession;
  private readonly config: SessionConfig;
  private reconnectAttempts = 0;
  private reconnectTimer: number | undefined;
  private syncRequestTimer: number | undefined;
  private syncRequestDebounceTimer: number | undefined;
  private readonly sync: YjsDocSync;
  readonly transfer: FileTransfer;
  private hasInitialSync: boolean;
  private readonly initialSyncDebounceMs = 300;
  // The id of the Yjs doc we're editing, so guests can tell a resumed host doc from a brand new one.
  private docId: string | null;
  private hostPeerId: string | null = null;
  private connectionState: TransportState = 'Not sharing';
  private peerCount = 0;

  constructor(config: SessionConfig) {
    this.config = config;
    this.hasInitialSync = config.isHost;
    this.docId = config.isHost ? (config.initialState?.docId ?? crypto.randomUUID()) : null;
    this.sync = new YjsDocSync({
      initialState: config.isHost ? config.initialState?.state : undefined,
      onRemoteChange: () => this.config.onRemoteChange?.(),
      onLocalUpdate: (update) => {
        if (!this.config.isHost && !this.hasInitialSync) return;
        const message: SyncMessage = { kind: 'y-update', update: Array.from(update) };
        this.session.sendMessage(message);
      },
    });
    this.transfer = new FileTransfer({
      blobs: config.blobs,
      sendMessage: (message, peerId) => this.session.sendMessage(message, peerId),
      sendChunk: (data, meta, peerId) => this.session.sendBinary(data, peerId, meta),
      onProgress: (hash, fraction) => this.config.onFileProgress?.(hash, fraction),
    });
    this.session = new PeerSession(getBootstrapConfig(), {
      onMessage: (payload, peerId) => this.onMessage(payload, peerId),
      onState: (state) => {
        this.connectionState = state;
        this.config.onConnectionState(state, this.peerCount);
        if (state === 'Connected' || state === 'Relayed') {
          this.reconnectAttempts = 0;
          this.ensureInitialSyncRequestLoop();
          return;
        }
        if (state === 'Reconnecting' && this.roomId) {
          this.scheduleReconnect();
        }
      },
      onPeerCount: (count) => {
        this.peerCount = count;
        this.config.onConnectionState(this.connectionState, count);
      },
      onPeerJoin: (peerId) => {
        this.transfer.peerJoined(peerId);
        if (!this.config.isHost) return;
        this.session.sendMessage(this.snapshotMessage(), peerId);
      },
      onBinary: (data, peerId, metadata) => {
        const chunk = parseChunk(data, metadata);
        if (!chunk) {
          dropMessage('bad file chunk', metadata);
          return;
        }
        void this.transfer.handleChunk(chunk.data, chunk.meta, peerId);
      },
      onPeerLeave: (peerId) => {
        this.transfer.peerLeft(peerId);
        // When the host leaves, take the next snapshot from whoever comes back as host.
        if (peerId === this.hostPeerId) this.hostPeerId = null;
      },
    });
    this.config.onConnectionState('Not sharing', 0);
  }

  ensureRoom() {
    // Only join once. Clicking Share again used to re-join the room and re-register handlers.
    if (this.roomId) return this.roomId;
    this.roomId = crypto.randomUUID();
    this.session.joinRoom(this.roomId);
    return this.roomId;
  }

  getRoomId() {
    return this.roomId;
  }

  newRoom() {
    // Leave the current room first, so guests on the old link stop getting updates.
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.reconnectAttempts = 0;
    if (this.roomId) this.session.close();
    this.roomId = null;
    return this.ensureRoom();
  }

  join(roomId: string) {
    this.roomId = roomId;
    this.session.joinRoom(roomId);
    this.ensureInitialSyncRequestLoop();
  }

  getDoc() {
    return this.sync.getDoc();
  }

  getPersistedState(): PersistedDocState | null {
    if (!this.config.isHost || !this.docId) return null;
    return { docId: this.docId, state: this.sync.getSnapshot() };
  }

  broadcastMetadata(metadata: { title: string; storage: string }) {
    if (!this.config.isHost) return;
    const message: SyncMessage = { kind: 'metadata', metadata };
    this.session.sendMessage(message);
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.roomId) return;
    const delay = Math.min(20_000, 1_000 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.roomId) return;
      this.session.joinRoom(this.roomId);
      this.ensureInitialSyncRequestLoop();
    }, delay);
  }

  private ensureInitialSyncRequestLoop() {
    if (this.config.isHost || this.hasInitialSync) return;
    if (!this.syncRequestDebounceTimer) {
      this.syncRequestDebounceTimer = window.setTimeout(() => {
        this.syncRequestDebounceTimer = undefined;
        if (!this.config.isHost && !this.hasInitialSync) {
          this.session.sendMessage({ kind: 'sync-request' });
        }
      }, this.initialSyncDebounceMs);
    }
    if (!this.syncRequestTimer) {
      this.syncRequestTimer = window.setInterval(() => {
        if (this.config.isHost || this.hasInitialSync) {
          if (this.syncRequestTimer) {
            window.clearInterval(this.syncRequestTimer);
            this.syncRequestTimer = undefined;
          }
          return;
        }
        this.session.sendMessage({ kind: 'sync-request' });
      }, 1000);
    }
  }

  private onMessage(payload: unknown, peerId?: string) {
    // First check the shape and size, since anyone with the link can send us anything.
    const message = parseSyncMessage(payload);
    if (!message) {
      dropMessage('malformed or too big', payload);
      return;
    }

    if (message.kind === 'snapshot') {
      // Only the host sends snapshots, so once we know who that is, ignore them from anyone else.
      if (this.config.isHost || !peerId || (this.hostPeerId && peerId !== this.hostPeerId)) {
        dropMessage('snapshot from a peer that is not the host', peerId);
        return;
      }
      if (!isWellFormedUpdate(new Uint8Array(message.state))) {
        dropMessage('snapshot is not a Yjs update', peerId);
        return;
      }
      this.applyHostSnapshot(message, peerId);
      this.hasInitialSync = true;
      if (this.syncRequestDebounceTimer) {
        window.clearTimeout(this.syncRequestDebounceTimer);
        this.syncRequestDebounceTimer = undefined;
      }
      if (this.syncRequestTimer) {
        window.clearInterval(this.syncRequestTimer);
        this.syncRequestTimer = undefined;
      }
      if (message.metadata && this.config.onRemoteMetadata) {
        this.config.onRemoteMetadata(message.metadata);
      }
      return;
    }

    if (message.kind === 'y-update') {
      const update = new Uint8Array(message.update);
      if (!isWellFormedUpdate(update)) {
        dropMessage('update is not a Yjs update', peerId);
        return;
      }
      this.sync.applyRemoteUpdate(update);
      return;
    }

    if (message.kind === 'metadata') {
      // Metadata is host-only too, and we only know the host once its snapshot came in.
      if (this.config.isHost || !peerId || peerId !== this.hostPeerId) {
        dropMessage('metadata from a peer that is not the host', peerId);
        return;
      }
      this.config.onRemoteMetadata?.(message.metadata);
      return;
    }

    if (message.kind === 'file-request' && peerId) {
      void this.transfer.handleRequest(message.hash, peerId);
      return;
    }

    if (message.kind === 'sync-request' && this.config.isHost) {
      this.session.sendMessage(this.snapshotMessage(), peerId);
    }
  }

  private snapshotMessage(): SyncMessage {
    return {
      kind: 'snapshot',
      state: Array.from(this.sync.getSnapshot()),
      docId: this.docId ?? undefined,
      metadata: this.config.getLocalMetadata?.(),
    };
  }

  private applyHostSnapshot(message: { state: number[]; docId?: string }, peerId?: string) {
    const update = new Uint8Array(message.state);
    if (message.docId && message.docId === this.docId) {
      // Same doc, so merge it, then send back anything the host is missing, like edits made while it was away.
      const missing = this.sync.applySnapshot(update);
      // An empty Yjs update is two zero bytes.
      if (missing.length > 2) {
        this.session.sendMessage({ kind: 'y-update', update: Array.from(missing) } satisfies SyncMessage, peerId);
      }
    } else if (this.sync.hasState()) {
      // The host is on a different doc now, so start over from its copy instead of mixing the two.
      this.sync.resetFromSnapshot(update);
      this.config.onDocReplaced?.();
    } else {
      this.sync.applySnapshot(update);
    }
    this.docId = message.docId ?? null;
    this.hostPeerId = peerId ?? null;
  }
}
