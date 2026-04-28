import { SignalingClient, type SignalMessage } from '../net/signaling';
import { WebRtcPeer } from '../net/webrtc';

type SessionConfig = {
  signalingUrl: string;
  onConnectionState: (state: string) => void;
  onRemoteText: (text: string) => void;
};

export class SessionController {
  private roomId: string | null = null;
  private signaling: SignalingClient;
  private peer: WebRtcPeer;
  private config: SessionConfig;

  constructor(config: SessionConfig) {
    this.config = config;
    this.peer = new WebRtcPeer(
      (text) => this.config.onRemoteText(text),
      (candidate) => {
        if (this.roomId) this.signaling.send({ type: 'ice', roomId: this.roomId, candidate });
      },
    );

    this.signaling = new SignalingClient(config.signalingUrl, (msg) => {
      void this.onSignal(msg);
    });
    this.signaling.connect();
    this.config.onConnectionState('Signaling');
  }

  ensureRoom() {
    if (!this.roomId) this.roomId = crypto.randomUUID();
    this.signaling.send({ type: 'join', roomId: this.roomId });
    void this.createAndSendOffer();
    return this.roomId;
  }

  join(roomId: string) {
    this.roomId = roomId;
    this.signaling.send({ type: 'join', roomId });
  }

  broadcastText(text: string) {
    this.peer.send(text);
  }

  private async createAndSendOffer() {
    if (!this.roomId) return;
    const offer = await this.peer.createOffer();
    this.signaling.send({ type: 'offer', roomId: this.roomId, sdp: offer });
  }

  private async onSignal(msg: SignalMessage) {
    if (!this.roomId || msg.roomId !== this.roomId) return;

    if (msg.type === 'offer') {
      const answer = await this.peer.acceptOffer(msg.sdp);
      this.signaling.send({ type: 'answer', roomId: this.roomId, sdp: answer });
      this.config.onConnectionState('Connected');
      return;
    }

    if (msg.type === 'answer') {
      await this.peer.acceptAnswer(msg.sdp);
      this.config.onConnectionState('Connected');
      return;
    }

    if (msg.type === 'ice') {
      await this.peer.addIce(msg.candidate);
    }
  }
}
