import { P2pTransport, type TransportState } from './p2pTransport';
import type { BootstrapConfig } from './bootstrapConfig';

type PeerSessionCallbacks = {
  onMessage: (payload: unknown, peerId?: string) => void;
  onState: (state: TransportState) => void;
  onPeerCount: (count: number) => void;
  onPeerJoin: (peerId: string) => void;
};

export class PeerSession {
  private transport: P2pTransport;
  constructor(bootstrap: BootstrapConfig, callbacks: PeerSessionCallbacks) {
    this.transport = new P2pTransport(bootstrap, callbacks);
  }

  joinRoom(roomId: string) {
    this.transport.join(roomId);
  }

  sendMessage(payload: unknown, peerId?: string) {
    this.transport.send(payload, peerId);
  }

  close() {
    this.transport.disconnect();
  }
}
