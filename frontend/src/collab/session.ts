import { getBootstrapConfig } from '../net/bootstrapConfig';
import { PeerSession } from '../net/peerSession';
import type { TransportState } from '../net/p2pTransport';
import { applyDelta, computeSingleDelta, type TextDelta } from './textDelta';

type SessionConfig = {
  onConnectionState: (state: TransportState) => void;
  onRemoteText: (text: string) => void;
  getLocalText: () => string;
};

type SyncMessage =
  | { kind: 'snapshot'; seq: number; text: string }
  | { kind: 'delta'; seq: number; delta: TextDelta };

export class SessionController {
  private roomId: string | null = null;
  private session: PeerSession;
  private readonly config: SessionConfig;
  private reconnectAttempts = 0;
  private reconnectTimer: number | undefined;
  private shadowText: string;
  private localSeq = 0;
  private lastAppliedSeq = 0;

  constructor(config: SessionConfig) {
    this.config = config;
    this.shadowText = config.getLocalText();
    this.lastAppliedSeq = this.shadowText.length > 0 ? 0 : -1;
    this.session = new PeerSession(getBootstrapConfig(), {
      onMessage: (payload, _peerId) => this.onMessage(payload),
      onState: (state) => {
        this.config.onConnectionState(state);
        if (state === 'Connected') {
          this.reconnectAttempts = 0;
          return;
        }
        if ((state === 'Failed' || state === 'Reconnecting') && this.roomId) {
          this.scheduleReconnect();
        }
      },
      onPeerCount: () => undefined,
      onPeerJoin: (peerId) => {
        const snapshot: SyncMessage = {
          kind: 'snapshot',
          seq: this.localSeq,
          text: this.shadowText,
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
  }

  broadcastText(text: string) {
    const delta = computeSingleDelta(this.shadowText, text);
    if (!delta) return;
    this.localSeq += 1;
    this.lastAppliedSeq = this.localSeq;
    this.shadowText = applyDelta(this.shadowText, delta);
    const message: SyncMessage = { kind: 'delta', seq: this.localSeq, delta };
    this.session.sendMessage(message);
  }

  updateLocalText(text: string) {
    this.shadowText = text;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.roomId) return;
    const delay = Math.min(20_000, 1_000 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.roomId) return;
      this.session.joinRoom(this.roomId);
    }, delay);
  }

  private onMessage(payload: unknown) {
    const message = payload as SyncMessage;
    if (!message || typeof message !== 'object' || !('kind' in message)) return;

    if (message.kind === 'snapshot') {
      if (message.seq < this.lastAppliedSeq) return;
      if (message.seq === this.lastAppliedSeq && this.shadowText.length > 0) return;
      this.lastAppliedSeq = message.seq;
      this.shadowText = message.text;
      this.config.onRemoteText(message.text);
      return;
    }

    if (message.kind === 'delta') {
      if (message.seq <= this.lastAppliedSeq) return;
      this.lastAppliedSeq = message.seq;
      this.shadowText = applyDelta(this.shadowText, message.delta);
      this.config.onRemoteText(this.shadowText);
    }
  }
}
