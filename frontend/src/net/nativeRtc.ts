// An RTCPeerConnection stand-in for the desktop app where the webview has none (issue #176,
// docs/desktop.md "WebRTC on Linux"). Distro WebKitGTK is built without WebRTC, so the shell runs
// real WebRTC peer connections in Rust (desktop/src-tauri/src/native_rtc.rs) and this class drives
// them over Tauri IPC. Trystero takes it as its `rtcPolyfill`, so the rest of the P2P code is the
// same as in a browser, and browser peers can't tell the difference: ICE, DTLS and SCTP all happen
// in Rust, and document content still only goes peer to peer.
//
// It covers what Trystero uses: data channels (binary, ordered), offers and answers with
// setLocalDescription() making them implicitly, rollback, ICE restart, trickled or gathered
// candidates, and the state events. No media. A lazy chunk, loaded only when the window has no
// RTCPeerConnection and the shell offers this (desktopNativeRtc()).

type Invoke = (command: string, args?: unknown, options?: { headers: Record<string, string> }) => Promise<unknown>;
type ChannelLike<T> = { onmessage: (message: T) => void };
type ChannelClass = new <T>(onmessage?: (message: T) => void) => ChannelLike<T>;
export type ShellIpc = { invoke: Invoke; Channel: ChannelClass };

type CandidateInit = { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null };

/** What the shell says, in order (RtcEvent in native_rtc.rs). */
export type RtcEvent =
  | { kind: 'signalingState'; state: string }
  | { kind: 'iceGatheringState'; state: RTCIceGatheringState; localSdp: string | null }
  | { kind: 'iceCandidate'; candidate: CandidateInit | null; localSdp: string | null }
  | { kind: 'iceConnectionState'; state: RTCIceConnectionState }
  | { kind: 'connectionState'; state: RTCPeerConnectionState }
  | { kind: 'dataChannel'; channel: number; label: string }
  | { kind: 'channelOpen'; channel: number }
  | { kind: 'channelClose'; channel: number }
  | { kind: 'channelError'; channel: number; message: string }
  | { kind: 'bufferedAmountLow'; channel: number; buffered: number };

function event<T extends object>(type: string, fields: T): Event & T {
  return Object.assign(new Event(type), fields);
}

function invalidState(message: string): DOMException {
  return new DOMException(message, 'InvalidStateError');
}

function toBytes(data: unknown): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError('This data channel only sends strings, ArrayBuffers and typed arrays.');
}

/** A data channel whose SCTP stream lives in the shell. */
export class NativeDataChannel extends EventTarget {
  readonly label: string;
  readonly ordered = true;
  readonly protocol = '';
  binaryType: BinaryType = 'arraybuffer';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  readyState: RTCDataChannelState = 'connecting';
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onbufferedamountlow: ((event: Event) => void) | null = null;
  /** The shell's id for it, once known. */
  channelId: number | null = null;
  private readonly owner: NativeRTCPeerConnection;

  constructor(owner: NativeRTCPeerConnection, label: string) {
    super();
    this.owner = owner;
    this.label = label;
  }

  get id() {
    return this.channelId;
  }

  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
    if (this.readyState !== 'open' || this.channelId === null) throw invalidState('The data channel is not open.');
    const bytes = toBytes(data).slice();
    this.bufferedAmount += bytes.byteLength;
    this.owner.queueSend(this, bytes);
  }

  close(): void {
    if (this.readyState === 'closed' || this.readyState === 'closing') return;
    this.readyState = 'closing';
    if (this.channelId !== null) this.owner.closeChannel(this.channelId);
    else this.closed();
  }

  /** Called by the connection. */
  emit(type: 'open' | 'close' | 'error' | 'bufferedamountlow', extra: object = {}) {
    const e = event(type, extra);
    this.dispatchEvent(e);
    const handler = this[`on${type}`] as ((event: Event) => void) | null;
    handler?.call(this, e);
  }

  opened() {
    if (this.readyState !== 'connecting') return;
    this.readyState = 'open';
    this.emit('open');
  }

  closed() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.emit('close');
  }

  receive(data: Uint8Array) {
    if (this.readyState === 'closed') return;
    const payload = this.binaryType === 'arraybuffer' ? data.slice().buffer : new Blob([data.slice()]);
    const message = new MessageEvent('message', { data: payload });
    this.dispatchEvent(message);
    this.onmessage?.call(this, message);
  }

  /** The shell's buffered amount plus what this page hasn't handed it yet. */
  setBuffered(amount: number) {
    const before = this.bufferedAmount;
    this.bufferedAmount = amount;
    if (amount <= this.bufferedAmountLowThreshold && before > this.bufferedAmountLowThreshold) this.emit('bufferedamountlow');
  }
}

/** RTCPeerConnection over IPC. Make it with `nativeRtcPeerConnection(ipc)`, which binds the IPC. */
export class NativeRTCPeerConnection extends EventTarget {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  signalingState: RTCSignalingState = 'stable';
  iceGatheringState: RTCIceGatheringState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  connectionState: RTCPeerConnectionState = 'new';
  onicecandidate: ((event: Event) => void) | null = null;
  onicegatheringstatechange: ((event: Event) => void) | null = null;
  oniceconnectionstatechange: ((event: Event) => void) | null = null;
  onconnectionstatechange: ((event: Event) => void) | null = null;
  onsignalingstatechange: ((event: Event) => void) | null = null;
  ondatachannel: ((event: Event) => void) | null = null;
  onnegotiationneeded: ((event: Event) => void) | null = null;
  ontrack: ((event: Event) => void) | null = null;

  private readonly ipc: ShellIpc;
  private readonly peer: Promise<number>;
  private peerId: number | null = null;
  /** Operations run one at a time and in order, like a browser's operations chain. */
  private chain: Promise<unknown> = Promise.resolve();
  private readonly channels = new Map<number, NativeDataChannel>();
  private readonly outgoing: { channel: NativeDataChannel; bytes: Uint8Array }[] = [];
  private sending = false;

  constructor(config: RTCConfiguration = {}, ipc?: ShellIpc) {
    super();
    if (!ipc) throw new TypeError('Use nativeRtcPeerConnection() to make this class.');
    this.ipc = ipc;
    const events = new ipc.Channel<RtcEvent>((message) => this.onEvent(message));
    const messages = new ipc.Channel<ArrayBuffer | Uint8Array | number[]>((message) => this.onMessage(message));
    const iceServers = (config.iceServers ?? []).map(({ urls, username, credential }) => ({ urls, username, credential }));
    this.peer = ipc.invoke('rtc_create', { iceServers, events, messages }).then((id) => {
      this.peerId = id as number;
      // Closed before the shell answered: let it go.
      if (this.connectionState === 'closed') void ipc.invoke('rtc_close', { peer: id, channel: null });
      return id as number;
    });
    // An unhandled rejection here would be noise; every operation below reports it.
    this.peer.catch(() => {});
  }

  private run<T>(work: (peer: number) => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      if (this.connectionState === 'closed') throw invalidState('The peer connection is closed.');
      return work(await this.peer);
    });
    this.chain = next.catch(() => {});
    return next;
  }

  private emit(type: string, e: Event = new Event(type)) {
    this.dispatchEvent(e);
    const handler = (this as unknown as Record<string, ((event: Event) => void) | null>)[`on${type}`];
    handler?.call(this, e);
  }

  private setSignaling(state: RTCSignalingState) {
    if (this.signalingState === state) return;
    this.signalingState = state;
    this.emit('signalingstatechange');
  }

  createDataChannel(label: string): NativeDataChannel {
    if (this.connectionState === 'closed') throw invalidState('The peer connection is closed.');
    const channel = new NativeDataChannel(this, label);
    void this.run(async (peer) => {
      const id = (await this.ipc.invoke('rtc_create_data_channel', { peer, label })) as number;
      channel.channelId = id;
      this.channels.set(id, channel);
      if (channel.readyState === 'closing') this.closeChannel(id);
    }).catch((error: unknown) => {
      console.warn('Could not make the data channel', error);
      channel.closed();
    });
    return channel;
  }

  createOffer(options: { iceRestart?: boolean } = {}): Promise<RTCSessionDescriptionInit> {
    return this.run(async (peer) => ({
      type: 'offer',
      sdp: (await this.ipc.invoke('rtc_create_description', { peer, kind: 'offer', iceRestart: Boolean(options.iceRestart) })) as string,
    }));
  }

  createAnswer(): Promise<RTCSessionDescriptionInit> {
    return this.run(async (peer) => ({
      type: 'answer',
      sdp: (await this.ipc.invoke('rtc_create_description', { peer, kind: 'answer', iceRestart: false })) as string,
    }));
  }

  /** With no description it makes the offer or answer itself, as browsers do now. */
  setLocalDescription(description?: RTCSessionDescriptionInit): Promise<void> {
    return this.run(async (peer) => {
      let type = description?.type;
      let sdp = description?.sdp;
      if (type !== 'rollback' && !sdp) {
        type = this.signalingState === 'have-remote-offer' || this.signalingState === 'have-local-pranswer' ? 'answer' : 'offer';
        sdp = (await this.ipc.invoke('rtc_create_description', { peer, kind: type, iceRestart: false })) as string;
      }
      await this.ipc.invoke('rtc_set_description', { peer, local: true, kind: type, sdp: sdp ?? '' });
      if (type === 'rollback') {
        this.localDescription = null;
        this.setSignaling('stable');
        return;
      }
      this.localDescription = { type: type as RTCSdpType, sdp };
      this.setSignaling(type === 'offer' ? 'have-local-offer' : 'stable');
    });
  }

  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    return this.run(async (peer) => {
      await this.ipc.invoke('rtc_set_description', { peer, local: false, kind: description.type, sdp: description.sdp ?? '' });
      if (description.type === 'rollback') {
        this.remoteDescription = null;
        this.setSignaling('stable');
        return;
      }
      this.remoteDescription = { type: description.type, sdp: description.sdp };
      this.setSignaling(description.type === 'offer' ? 'have-remote-offer' : 'stable');
    });
  }

  addIceCandidate(candidate?: RTCIceCandidateInit | null): Promise<void> {
    // No candidate, or an empty one, means the end of candidates: nothing to tell the shell.
    if (!candidate?.candidate) return this.run(async () => undefined);
    return this.run(async (peer) => {
      await this.ipc.invoke('rtc_add_ice_candidate', {
        peer,
        candidate: {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid ?? null,
          sdpMLineIndex: candidate.sdpMLineIndex ?? null,
          usernameFragment: candidate.usernameFragment ?? null,
        },
      });
    });
  }

  /** No stats from the shell yet, so a relay check (usesRelay) says no. */
  async getStats(): Promise<RTCStatsReport> {
    return new Map() as unknown as RTCStatsReport;
  }

  getSenders(): RTCRtpSender[] {
    return [];
  }

  addTrack(): never {
    throw new DOMException('This window can share documents but not audio or video.', 'NotSupportedError');
  }

  close(): void {
    if (this.connectionState === 'closed') return;
    this.signalingState = 'closed';
    this.iceConnectionState = 'closed';
    this.connectionState = 'closed';
    for (const channel of this.channels.values()) channel.closed();
    this.channels.clear();
    this.outgoing.length = 0;
    if (this.peerId !== null) void this.ipc.invoke('rtc_close', { peer: this.peerId, channel: null }).catch(() => {});
  }

  /** NativeDataChannel.close(). */
  closeChannel(id: number) {
    const channel = this.channels.get(id);
    if (this.peerId !== null) void this.ipc.invoke('rtc_close', { peer: this.peerId, channel: id }).catch(() => {});
    this.channels.delete(id);
    channel?.closed();
  }

  private pending(channel: NativeDataChannel) {
    return this.outgoing.reduce((sum, item) => sum + (item.channel === channel ? item.bytes.byteLength : 0), 0);
  }

  /**
   * NativeDataChannel.send(). Messages go to the shell in batches, one IPC call at a time, so they
   * keep their order: [channel u16][length u32][bytes], repeated (parse_frames in native_rtc.rs).
   */
  queueSend(channel: NativeDataChannel, bytes: Uint8Array) {
    this.outgoing.push({ channel, bytes });
    if (!this.sending) void this.flush();
  }

  private async flush() {
    this.sending = true;
    try {
      while (this.outgoing.length && this.peerId !== null && this.connectionState !== 'closed') {
        const batch = this.outgoing.splice(0);
        const size = batch.reduce((sum, { bytes }) => sum + 6 + bytes.byteLength, 0);
        const body = new Uint8Array(size);
        const view = new DataView(body.buffer);
        let at = 0;
        for (const { channel, bytes } of batch) {
          view.setUint16(at, channel.channelId ?? 0);
          view.setUint32(at + 2, bytes.byteLength);
          body.set(bytes, at + 6);
          at += 6 + bytes.byteLength;
        }
        try {
          const buffered = (await this.ipc.invoke('rtc_send', body, { headers: { 'x-rtc-peer': String(this.peerId) } })) as Record<string, number>;
          for (const channel of new Set(batch.map((item) => item.channel))) {
            channel.setBuffered((buffered?.[String(channel.channelId)] ?? 0) + this.pending(channel));
          }
        } catch (error) {
          for (const channel of new Set(batch.map((item) => item.channel))) channel.emit('error', { error: new Error(String(error)) });
        }
      }
    } finally {
      this.sending = false;
    }
  }

  private onMessage(message: ArrayBuffer | Uint8Array | number[]) {
    const bytes = message instanceof ArrayBuffer ? new Uint8Array(message) : message instanceof Uint8Array ? message : Uint8Array.from(message);
    if (bytes.byteLength < 2) return;
    const id = (bytes[0] << 8) | bytes[1];
    this.channels.get(id)?.receive(bytes.subarray(2));
  }

  private onEvent(e: RtcEvent) {
    if (this.connectionState === 'closed') return;
    switch (e.kind) {
      case 'iceGatheringState':
        if (e.localSdp && this.localDescription) this.localDescription = { ...this.localDescription, sdp: e.localSdp };
        this.iceGatheringState = e.state;
        this.emit('icegatheringstatechange');
        return;
      case 'iceCandidate': {
        if (e.localSdp && this.localDescription) this.localDescription = { ...this.localDescription, sdp: e.localSdp };
        const init = e.candidate;
        const candidate = init && {
          ...init,
          sdpMid: init.sdpMid ?? null,
          sdpMLineIndex: init.sdpMLineIndex ?? null,
          usernameFragment: init.usernameFragment ?? null,
          toJSON: () => ({ ...init }),
        };
        this.emit('icecandidate', event('icecandidate', { candidate }));
        return;
      }
      case 'iceConnectionState':
        this.iceConnectionState = e.state;
        this.emit('iceconnectionstatechange');
        return;
      case 'connectionState':
        this.connectionState = e.state;
        this.emit('connectionstatechange');
        return;
      case 'dataChannel': {
        const channel = new NativeDataChannel(this, e.label);
        channel.channelId = e.channel;
        this.channels.set(e.channel, channel);
        this.emit('datachannel', event('datachannel', { channel }));
        return;
      }
      case 'channelOpen':
        this.channels.get(e.channel)?.opened();
        return;
      case 'channelClose': {
        const channel = this.channels.get(e.channel);
        this.channels.delete(e.channel);
        channel?.closed();
        return;
      }
      case 'channelError':
        this.channels.get(e.channel)?.emit('error', { error: new Error(e.message) });
        return;
      case 'bufferedAmountLow': {
        const channel = this.channels.get(e.channel);
        channel?.setBuffered(e.buffered + this.pending(channel));
        return;
      }
      case 'signalingState':
        // Kept in step from the descriptions this page sets, so the state is right as each await
        // returns; the shell's copy comes later, over the event channel.
        return;
    }
  }
}

/**
 * The class to give Trystero as `rtcPolyfill`, bound to the shell. Pass `ipc` in tests; in the app
 * it's @tauri-apps/api/core's invoke and Channel.
 */
export async function nativeRtcPeerConnection(ipc?: ShellIpc): Promise<typeof RTCPeerConnection> {
  const shell = ipc ?? ((await import('@tauri-apps/api/core')) as unknown as ShellIpc);
  class BoundPeerConnection extends NativeRTCPeerConnection {
    constructor(config?: RTCConfiguration) {
      super(config, shell);
    }
  }
  return BoundPeerConnection as unknown as typeof RTCPeerConnection;
}
