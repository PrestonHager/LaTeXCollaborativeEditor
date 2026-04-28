export type SignalMessage =
  | { type: 'join'; roomId: string }
  | { type: 'offer'; roomId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; roomId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; roomId: string; candidate: RTCIceCandidateInit };

export class SignalingClient {
  private ws: WebSocket | null = null;
  private url: string;
  private onMessage: (msg: SignalMessage) => void;

  constructor(url: string, onMessage: (msg: SignalMessage) => void) {
    this.url = url;
    this.onMessage = onMessage;
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as SignalMessage;
      this.onMessage(parsed);
    };
  }

  send(msg: SignalMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
