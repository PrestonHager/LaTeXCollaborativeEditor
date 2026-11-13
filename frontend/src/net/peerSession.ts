import type { BinaryData, P2pTransport, TransportState } from './p2pTransport';
import type { BootstrapConfig } from './bootstrapConfig';
import { whenOnline } from '../app/lazy';

type PeerSessionCallbacks = {
  onMessage: (payload: unknown, peerId?: string) => void;
  onState: (state: TransportState) => void;
  onPeerCount: (count: number) => void;
  onPeerJoin: (peerId: string) => void;
  onPeerLeave?: (peerId: string) => void;
  onBinary?: (data: BinaryData, peerId: string, metadata: unknown) => void;
  /**
   * The transport code (Trystero) couldn't be fetched, like after a deploy removed its chunk or
   * while offline. The state goes to Reconnecting, and the session's reconnect asks again on its
   * own schedule, though browsers usually keep a failed chunk failed until the page reloads.
   */
  onLoadError?: (error: unknown) => void;
};

export type LoadTransport = () => Promise<Pick<typeof import('./p2pTransport'), 'P2pTransport'>>;

/**
 * One peer-to-peer connection to a room. The transport and Trystero, its WebRTC library, are only
 * needed once someone shares or opens a ?room= link, so they load on the first join (or on
 * preload(), when the pointer reaches Share) instead of being in the initial bundle.
 */
export class PeerSession {
  private transport: P2pTransport | null = null;
  private loading: Promise<P2pTransport> | null = null;
  /** The room to join once the transport has loaded. Null when there's nothing to join. */
  private pendingRoom: string | null = null;
  private readonly bootstrap: BootstrapConfig;
  private readonly callbacks: PeerSessionCallbacks;
  private readonly load: LoadTransport;

  constructor(bootstrap: BootstrapConfig, callbacks: PeerSessionCallbacks, load: LoadTransport = () => whenOnline(() => import('./p2pTransport'))) {
    this.bootstrap = bootstrap;
    this.callbacks = callbacks;
    this.load = load;
  }

  /** Fetch the transport without joining anything. Safe to call again; failures are left for joinRoom. */
  preload(): Promise<void> {
    return this.ensureTransport().then(
      () => undefined,
      () => undefined,
    );
  }

  joinRoom(roomId: string) {
    if (this.transport) {
      this.transport.join(roomId);
      return;
    }
    this.pendingRoom = roomId;
    // The transport says this as soon as it joins, so say it now and the badge doesn't flicker.
    this.callbacks.onState('Waiting for peers');
    this.ensureTransport().then(
      (transport) => {
        const room = this.pendingRoom;
        this.pendingRoom = null;
        if (room !== null) transport.join(room);
      },
      (error: unknown) => {
        if (this.pendingRoom !== roomId) return;
        this.pendingRoom = null;
        this.callbacks.onLoadError?.(error);
        this.callbacks.onState('Reconnecting');
      },
    );
  }

  sendMessage(payload: unknown, peerId?: string) {
    this.transport?.send(payload, peerId);
  }

  sendBinary(data: Uint8Array, peerId: string, metadata: unknown) {
    this.transport?.sendBinary(data, peerId, metadata);
  }

  getPeerCount() {
    return this.transport?.getPeerCount() ?? 0;
  }

  /** Our peer id, once the transport has loaded (it loads it if needed). */
  selfId(): Promise<string> {
    return this.ensureTransport().then((transport) => transport.getSelfId());
  }

  close() {
    if (this.transport) {
      this.transport.disconnect();
      return;
    }
    // Still loading: drop the join, and report what disconnect() would have.
    this.pendingRoom = null;
    this.callbacks.onPeerCount(0);
    this.callbacks.onState('Not sharing');
  }

  private ensureTransport(): Promise<P2pTransport> {
    this.loading ??= this.load().then(
      ({ P2pTransport }) => (this.transport = new P2pTransport(this.bootstrap, this.callbacks)),
      (error: unknown) => {
        // Forget the failure, so the next join asks the browser again.
        this.loading = null;
        throw error;
      },
    );
    return this.loading;
  }
}
