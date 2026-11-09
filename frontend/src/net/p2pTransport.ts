import { joinRoom } from '@trystero-p2p/torrent';
import type { BootstrapConfig } from './bootstrapConfig';

export type TransportState = 'Not sharing' | 'Waiting for peers' | 'Connected' | 'Relayed' | 'Reconnecting';

// Build the text for the connection badge, with the peer count when anyone is connected.
export function connectionLabel(state: TransportState, peers: number) {
  if (peers <= 0) return state;
  return `${state} · ${peers} ${peers === 1 ? 'peer' : 'peers'}`;
}

// Check whether the selected ICE candidate pair goes through a TURN relay.
export async function usesRelay(connection: RTCPeerConnection): Promise<boolean> {
  const stats = await connection.getStats();
  let pair: any;
  // First, look for the pair the transport says it picked.
  stats.forEach((report: any) => {
    if (report.type === 'transport' && report.selectedCandidatePairId) {
      pair = stats.get(report.selectedCandidatePairId);
    }
  });
  // Firefox doesn't fill that in, so fall back to the selected or nominated pair.
  if (!pair) {
    stats.forEach((report: any) => {
      if (pair || report.type !== 'candidate-pair') return;
      if (report.selected || (report.nominated && report.state === 'succeeded')) pair = report;
    });
  }
  if (!pair) return false;
  // Either side going through TURN means the traffic is relayed.
  const local = stats.get(pair.localCandidateId);
  const remote = stats.get(pair.remoteCandidateId);
  return local?.candidateType === 'relay' || remote?.candidateType === 'relay';
}

type TransportCallbacks = {
  onMessage: (payload: unknown, peerId?: string) => void;
  onState: (state: TransportState) => void;
  onPeerCount: (count: number) => void;
  onPeerJoin: (peerId: string) => void;
  onPeerLeave?: (peerId: string) => void;
  /** Binary data, like a chunk of a project file. Metadata says what it is. */
  onBinary?: (data: ArrayBuffer, peerId: string, metadata: unknown) => void;
};

export class P2pTransport {
  private room: any;
  private sendTextAction: ((payload: unknown, peerId?: string) => void) | null = null;
  private sendBinaryAction: ((data: Uint8Array, peerId: string, metadata: unknown) => void) | null = null;
  private peers = new Set<string>();
  private relayedPeers = new Set<string>();
  private bootstrap: BootstrapConfig;
  private callbacks: TransportCallbacks;

  constructor(bootstrap: BootstrapConfig, callbacks: TransportCallbacks) {
    this.bootstrap = bootstrap;
    this.callbacks = callbacks;
  }

  join(roomId: string) {
    // Our rendezvous list is WebTorrent trackers, so this is the torrent strategy, not Nostr.
    this.room = joinRoom(
      {
        appId: this.bootstrap.appId,
        relayConfig: { urls: this.bootstrap.rendezvous },
        rtcConfig: { iceServers: this.bootstrap.iceServers },
      },
      roomId,
    );

    const [sendText, getText] = this.room.makeAction('doc-msg');
    this.sendTextAction = sendText;
    getText((payload: unknown, peerId?: string) => this.callbacks.onMessage(payload, peerId));

    // Files go over their own action, so trystero sends them as binary instead of JSON.
    const [sendBinary, getBinary] = this.room.makeAction('file-chunk');
    this.sendBinaryAction = sendBinary;
    getBinary((data: ArrayBuffer, peerId: string, metadata: unknown) => this.callbacks.onBinary?.(data, peerId, metadata));

    const room = this.room;
    this.room.onPeerJoin((peerId: string) => {
      this.peers.add(peerId);
      this.callbacks.onPeerCount(this.peers.size);
      this.callbacks.onState(this.connectedState());
      this.callbacks.onPeerJoin(peerId);
      void this.checkRelay(room, peerId);
    });

    this.room.onPeerLeave((peerId: string) => {
      this.peers.delete(peerId);
      this.relayedPeers.delete(peerId);
      this.callbacks.onPeerCount(this.peers.size);
      this.callbacks.onPeerLeave?.(peerId);
      if (this.peers.size === 0) {
        this.callbacks.onState('Reconnecting');
      } else {
        this.callbacks.onState(this.connectedState());
      }
    });

    // We're in the room, but nobody has joined yet. That's not a failure, so just wait.
    this.callbacks.onState('Waiting for peers');
  }

  getPeerCount() {
    return this.peers.size;
  }

  send(payload: unknown, peerId?: string) {
    if (!this.sendTextAction) return;
    if (peerId) {
      this.sendTextAction(payload, peerId);
      return;
    }
    this.sendTextAction(payload);
  }

  sendBinary(data: Uint8Array, peerId: string, metadata: unknown) {
    this.sendBinaryAction?.(data, peerId, metadata);
  }

  disconnect() {
    if (this.room?.leave) this.room.leave();
    this.room = null;
    // Reset so a later join starts counting peers from zero.
    this.peers.clear();
    this.relayedPeers.clear();
    this.sendTextAction = null;
    this.sendBinaryAction = null;
    this.callbacks.onPeerCount(0);
    this.callbacks.onState('Not sharing');
  }

  private connectedState(): TransportState {
    return this.relayedPeers.size > 0 ? 'Relayed' : 'Connected';
  }

  // Look at the peer's ICE stats and switch to Relayed if it goes through TURN.
  private async checkRelay(room: any, peerId: string) {
    const connection: RTCPeerConnection | undefined = room.getPeers?.()[peerId];
    if (!connection?.getStats) return;
    let relayed = false;
    try {
      relayed = await usesRelay(connection);
    } catch {
      return;
    }
    // Skip it if we left the room or the peer left while the stats were loading.
    if (!relayed || room !== this.room || !this.peers.has(peerId)) return;
    this.relayedPeers.add(peerId);
    this.callbacks.onState(this.connectedState());
  }
}
