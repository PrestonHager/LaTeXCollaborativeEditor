import { getBootstrapConfig } from '../net/bootstrapConfig';
import { PeerSession } from '../net/peerSession';
import type { TransportState } from '../net/p2pTransport';
import { YjsDocSync } from './yjsSync';
import { FileTransfer, type ChunkMeta } from './fileTransfer';
import type { BlobStore } from '../project/blobStore';

type SessionConfig = {
  isHost: boolean;
  blobs: BlobStore;
  onConnectionState: (state: TransportState) => void;
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

type SyncMessage =
  | { kind: 'snapshot'; state: number[]; docId?: string; metadata?: { title: string; storage: string } }
  | { kind: 'y-update'; update: number[] }
  | { kind: 'metadata'; metadata: { title: string; storage: string } }
  | { kind: 'sync-request' }
  | { kind: 'file-request'; hash: string };

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
        this.config.onConnectionState(state);
        if (state === 'Connected') {
          this.reconnectAttempts = 0;
          this.ensureInitialSyncRequestLoop();
          return;
        }
        if ((state === 'Failed' || state === 'Reconnecting') && this.roomId) {
          this.scheduleReconnect();
        }
      },
      onPeerCount: () => undefined,
      onPeerJoin: (peerId) => {
        this.transfer.peerJoined(peerId);
        if (!this.config.isHost) return;
        this.session.sendMessage(this.snapshotMessage(), peerId);
      },
      onBinary: (data, peerId, metadata) => {
        if (!isChunkMeta(metadata)) return;
        void this.transfer.handleChunk(data, metadata, peerId);
      },
      onPeerLeave: (peerId) => {
        this.transfer.peerLeft(peerId);
        // When the host leaves, take the next snapshot from whoever comes back as host.
        if (peerId === this.hostPeerId) this.hostPeerId = null;
      },
    });
    this.config.onConnectionState('Discovering');
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
    const message = payload as SyncMessage;
    if (!message || typeof message !== 'object' || !('kind' in message)) return;

    if (message.kind === 'snapshot') {
      if (this.config.isHost) return;
      // Only the host sends snapshots, so once we know who that is, ignore them from anyone else.
      if (this.hostPeerId && peerId !== this.hostPeerId) return;
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
      this.sync.applyRemoteUpdate(new Uint8Array(message.update));
      return;
    }

    if (message.kind === 'metadata' && !this.config.isHost && this.config.onRemoteMetadata) {
      this.config.onRemoteMetadata(message.metadata);
      return;
    }

    if (message.kind === 'file-request' && peerId && typeof message.hash === 'string') {
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

function isChunkMeta(value: unknown): value is ChunkMeta {
  const meta = value as Partial<ChunkMeta> | null;
  return (
    !!meta &&
    typeof meta.hash === 'string' &&
    Number.isInteger(meta.index) &&
    Number.isInteger(meta.total) &&
    Number.isInteger(meta.size)
  );
}
