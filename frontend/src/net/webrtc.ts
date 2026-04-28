export class WebRtcPeer {
  private peer: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private onData: (text: string) => void;
  private onIce: (candidate: RTCIceCandidateInit) => void;

  constructor(onData: (text: string) => void, onIce: (candidate: RTCIceCandidateInit) => void) {
    this.onData = onData;
    this.onIce = onIce;
    this.peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    this.peer.onicecandidate = (event) => {
      if (event.candidate) this.onIce(event.candidate.toJSON());
    };
    this.peer.ondatachannel = (event) => this.attachDataChannel(event.channel);
  }

  private attachDataChannel(channel: RTCDataChannel) {
    this.dataChannel = channel;
    channel.onmessage = (event) => this.onData(String(event.data));
  }

  async createOffer() {
    this.attachDataChannel(this.peer.createDataChannel('doc'));
    const offer = await this.peer.createOffer();
    await this.peer.setLocalDescription(offer);
    return offer;
  }

  async acceptOffer(offer: RTCSessionDescriptionInit) {
    await this.peer.setRemoteDescription(offer);
    const answer = await this.peer.createAnswer();
    await this.peer.setLocalDescription(answer);
    return answer;
  }

  async acceptAnswer(answer: RTCSessionDescriptionInit) {
    await this.peer.setRemoteDescription(answer);
  }

  async addIce(candidate: RTCIceCandidateInit) {
    await this.peer.addIceCandidate(candidate);
  }

  send(text: string) {
    if (this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(text);
    }
  }
}
