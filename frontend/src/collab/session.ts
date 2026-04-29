import { getBootstrapConfig } from '../net/bootstrapConfig';
import { PeerSession } from '../net/peerSession';
import type { TransportState } from '../net/p2pTransport';
import { YjsTextSync } from './yjsSync';

type SessionConfig = {
  isHost: boolean;
  onConnectionState: (state: TransportState) => void;
  onRemoteText: (text: string) => void;
  onRemoteMetadata?: (metadata: { title: string; storage: string }) => void;
  getLocalText: () => string;
  getLocalMetadata?: () => { title: string; storage: string };
};

type SyncMessage =
  | { kind: 'snapshot'; state: number[]; metadata?: { title: string; storage: string } }
  | { kind: 'y-update'; update: number[] }
  | { kind: 'metadata'; metadata: { title: string; storage: string } }
  | { kind: 'sync-request' };

export class SessionController {
  private roomId: string | null = null;
  private session: PeerSession;
  private readonly config: SessionConfig;
  private reconnectAttempts = 0;
  private reconnectTimer: number | undefined;
  private syncRequestTimer: number | undefined;
  private syncRequestDebounceTimer: number | undefined;
  private readonly sync: YjsTextSync;
  private hasInitialSync: boolean;
  private readonly initialSyncDebounceMs = 300;

  constructor(config: SessionConfig) {
    this.config = config;
    this.hasInitialSync = config.isHost;
    this.sync = new YjsTextSync({
      initialText: config.isHost ? config.getLocalText() : '',
      onRemoteText: (text) => this.config.onRemoteText(text),
      onLocalUpdate: (update) => {
        if (!this.config.isHost && !this.hasInitialSync) return;
        const message: SyncMessage = { kind: 'y-update', update: Array.from(update) };
        this.session.sendMessage(message);
      },
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
        if (!this.config.isHost) return;
        const snapshot: SyncMessage = {
          kind: 'snapshot',
          state: Array.from(this.sync.getSnapshot()),
          metadata: this.config.getLocalMetadata?.(),
        };
        this.session.sendMessage(snapshot, peerId);
      },
    });
    this.config.onConnectionState('Discovering');
  }

  ensureRoom() {
    if (!this.roomId) this.roomId = crypto.randomUUID();
    this.session.joinRoom(this.roomId);
    return this.roomId;
  }

  join(roomId: string) {
    this.roomId = roomId;
    this.session.joinRoom(roomId);
    this.ensureInitialSyncRequestLoop();
  }

  applyLocalText(text: string) {
    this.sync.applyLocalText(text);
  }

  updateLocalText(_text: string) {
    // Kept for compatibility with older call sites.
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
      this.sync.applySnapshot(new Uint8Array(message.state));
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

    if (message.kind === 'sync-request' && this.config.isHost && peerId) {
      const snapshot: SyncMessage = {
        kind: 'snapshot',
        state: Array.from(this.sync.getSnapshot()),
        metadata: this.config.getLocalMetadata?.(),
      };
      this.session.sendMessage(snapshot, peerId);
      return;
    }

    if (message.kind === 'sync-request' && this.config.isHost && !peerId) {
      const snapshot: SyncMessage = {
        kind: 'snapshot',
        state: Array.from(this.sync.getSnapshot()),
        metadata: this.config.getLocalMetadata?.(),
      };
      this.session.sendMessage(snapshot);
    }
  }
}
