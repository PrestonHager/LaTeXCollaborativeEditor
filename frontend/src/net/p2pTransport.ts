import { joinRoom } from 'trystero';
import type { BootstrapConfig } from './bootstrapConfig';

export type TransportState = 'Discovering' | 'Dialing' | 'Connected' | 'Relayed' | 'Reconnecting' | 'Failed';

type TransportCallbacks = {
  onMessage: (payload: unknown, peerId?: string) => void;
  onState: (state: TransportState) => void;
  onPeerCount: (count: number) => void;
  onPeerJoin: (peerId: string) => void;
};

export class P2pTransport {
  private room: any;
  private sendTextAction: ((payload: unknown, peerId?: string) => void) | null = null;
  private peers = 0;
  private discoveryTimer: number | undefined;
  private failureTimer: number | undefined;
  private bootstrap: BootstrapConfig;
  private callbacks: TransportCallbacks;

  constructor(bootstrap: BootstrapConfig, callbacks: TransportCallbacks) {
    this.bootstrap = bootstrap;
    this.callbacks = callbacks;
  }

  join(roomId: string) {
    this.cleanupTimers();
    this.callbacks.onState('Discovering');
    this.room = joinRoom(
      {
        appId: this.bootstrap.appId,
        relayUrls: this.bootstrap.rendezvous,
        rtcConfig: { iceServers: this.bootstrap.iceServers },
      } as any,
      roomId,
    );

    const [sendText, getText] = this.room.makeAction('doc-msg');
    this.sendTextAction = sendText;
    getText((payload: unknown, peerId?: string) => this.callbacks.onMessage(payload, peerId));

    this.room.onPeerJoin((peerId: string) => {
      this.peers += 1;
      this.callbacks.onPeerCount(this.peers);
      this.callbacks.onState(this.peers > 0 ? 'Connected' : 'Dialing');
      this.callbacks.onPeerJoin(peerId);
    });

    this.room.onPeerLeave(() => {
      this.peers = Math.max(0, this.peers - 1);
      this.callbacks.onPeerCount(this.peers);
      if (this.peers === 0) {
        this.callbacks.onState('Reconnecting');
      }
    });

    this.callbacks.onState('Dialing');
    this.discoveryTimer = window.setTimeout(() => {
      if (this.peers === 0) {
        this.callbacks.onState('Relayed');
      }
    }, 10_000);
    this.failureTimer = window.setTimeout(() => {
      if (this.peers === 0) {
        this.callbacks.onState('Failed');
      }
    }, 20_000);
  }

  send(payload: unknown, peerId?: string) {
    if (!this.sendTextAction) return;
    if (peerId) {
      this.sendTextAction(payload, peerId);
      return;
    }
    this.sendTextAction(payload);
  }

  disconnect() {
    this.cleanupTimers();
    if (this.room?.leave) this.room.leave();
  }

  private cleanupTimers() {
    if (this.discoveryTimer) window.clearTimeout(this.discoveryTimer);
    if (this.failureTimer) window.clearTimeout(this.failureTimer);
  }
}
