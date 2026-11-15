import { NativeRTCPeerConnection, nativeRtcPeerConnection, type RtcEvent, type ShellIpc } from './nativeRtc';
// Trystero's own peer logic, to check the stand-in against what it really does (not exported by
// the package, so by path). It's the same file the app runs.
// @ts-expect-error: the package has no types for this internal file.
import createPeerUntyped from '../../node_modules/@trystero-p2p/core/dist/peer.mjs';

type TrysteroPeer = {
  getOffer(): Promise<RTCSessionDescriptionInit | undefined>;
  signal(sdp: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit | undefined>;
  setHandlers(handlers: Record<string, (...args: any[]) => void>): void;
  sendData(data: Uint8Array): void;
  destroy(): void;
};
const createPeer = createPeerUntyped as (initiator: boolean, options: object) => TrysteroPeer;

type Sent = { command: string; args: unknown; options?: { headers: Record<string, string> } };

/**
 * A fake shell: two peer connections linked in memory. A full offer or answer "gathers" at once,
 * and once both descriptions are in, the connection opens with the offerer's channels.
 */
function fakeShell() {
  const calls: Sent[] = [];
  type FakePeer = {
    id: number;
    events: { onmessage: (e: RtcEvent) => void };
    messages: { onmessage: (m: ArrayBuffer) => void };
    local?: { kind: string; sdp: string };
    remote?: { kind: string; sdp: string };
    channels: number[];
    other?: FakePeer;
    connected: boolean;
  };
  const peers = new Map<number, FakePeer>();
  let nextPeer = 1;
  let nextChannel = 1;
  const failNext: string[] = [];
  const later = (run: () => void) => setTimeout(run, 0);

  class Channel<T> {
    onmessage: (message: T) => void;
    constructor(onmessage?: (message: T) => void) {
      this.onmessage = onmessage ?? (() => {});
    }
  }

  function maybeConnect(peer: FakePeer) {
    const other = [...peers.values()].find((p) => p !== peer && p.remote?.sdp === peer.local?.sdp && peer.remote?.sdp === p.local?.sdp);
    if (!other || peer.connected) return;
    peer.other = other;
    other.other = peer;
    for (const p of [peer, other]) {
      p.connected = true;
      later(() => {
        p.events.onmessage({ kind: 'iceConnectionState', state: 'connected' });
        p.events.onmessage({ kind: 'connectionState', state: 'connected' });
      });
    }
    const offerer = peer.local!.kind === 'offer' ? peer : other;
    const answerer = offerer.other!;
    for (const id of offerer.channels) {
      later(() => {
        answerer.channels.push(id);
        answerer.events.onmessage({ kind: 'dataChannel', channel: id, label: 'data' });
        offerer.events.onmessage({ kind: 'channelOpen', channel: id });
        answerer.events.onmessage({ kind: 'channelOpen', channel: id });
      });
    }
  }

  const invoke = vi.fn(async (command: string, args?: unknown, options?: { headers: Record<string, string> }) => {
    calls.push({ command, args, options });
    if (failNext[0] === command) {
      failNext.shift();
      throw `${command} failed`;
    }
    const a = args as Record<string, any>;
    switch (command) {
      case 'rtc_create': {
        const peer: FakePeer = { id: nextPeer++, events: a.events, messages: a.messages, channels: [], connected: false };
        peers.set(peer.id, peer);
        return peer.id;
      }
      case 'rtc_create_data_channel': {
        const id = nextChannel++;
        peers.get(a.peer)!.channels.push(id);
        return id;
      }
      case 'rtc_create_description':
        return `${a.kind}-from-${a.peer}${a.iceRestart ? '-restart' : ''}`;
      case 'rtc_set_description': {
        const peer = peers.get(a.peer)!;
        if (a.local) {
          peer.local = { kind: a.kind, sdp: a.sdp };
          // Gathering: a candidate, then complete, each with the SDP so far.
          later(() => {
            peer.events.onmessage({ kind: 'iceGatheringState', state: 'gathering', localSdp: null });
            peer.events.onmessage({ kind: 'iceCandidate', candidate: { candidate: 'candidate:1 1 udp 1 x.local 9 typ host', sdpMid: '0', sdpMLineIndex: 0 }, localSdp: `${a.sdp}+cands` });
            peer.events.onmessage({ kind: 'iceCandidate', candidate: null, localSdp: `${a.sdp}+cands` });
            peer.events.onmessage({ kind: 'iceGatheringState', state: 'complete', localSdp: `${a.sdp}+cands` });
            peer.local = { kind: a.kind, sdp: `${a.sdp}+cands` };
            maybeConnect(peer);
          });
        } else {
          peer.remote = { kind: a.kind, sdp: a.sdp };
          later(() => maybeConnect(peer));
        }
        return null;
      }
      case 'rtc_add_ice_candidate':
        return null;
      case 'rtc_send': {
        const peer = peers.get(Number(options!.headers['x-rtc-peer']))!;
        const body = args as Uint8Array;
        const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
        const buffered: Record<string, number> = {};
        for (let at = 0; at < body.byteLength; ) {
          const channel = view.getUint16(at);
          const length = view.getUint32(at + 2);
          const payload = body.slice(at + 6, at + 6 + length);
          const framed = new Uint8Array(2 + length);
          framed[0] = channel >> 8;
          framed[1] = channel & 0xff;
          framed.set(payload, 2);
          later(() => peer.other?.messages.onmessage(framed.buffer));
          buffered[channel] = 0;
          at += 6 + length;
        }
        return buffered;
      }
      case 'rtc_close':
        if (a.channel === null) peers.delete(a.peer);
        return null;
    }
    throw `unknown ${command}`;
  });
  return { ipc: { invoke, Channel } as unknown as ShellIpc, calls, peers, failNext };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('NativeRTCPeerConnection (#176)', () => {
  it('runs Trystero two-peer setup without trickle and carries its data both ways', async () => {
    const { ipc, calls } = fakeShell();
    const rtcPolyfill = await nativeRtcPeerConnection(ipc);
    const options = { trickleIce: false, rtcPolyfill, rtcConfig: { iceServers: [{ urls: 'stun:stun.example.com:3478' }] } };
    const a = createPeer(true, options);
    const b = createPeer(false, options);
    const gotA: Uint8Array[] = [];
    const gotB: Uint8Array[] = [];
    const connected = Promise.all([new Promise<void>((r) => a.setHandlers({ connect: r })), new Promise<void>((r) => b.setHandlers({ connect: r }))]);
    a.setHandlers({ data: (d: ArrayBuffer) => gotA.push(new Uint8Array(d)) });
    b.setHandlers({ data: (d: ArrayBuffer) => gotB.push(new Uint8Array(d)) });

    const offer = await a.getOffer();
    expect(offer).toEqual({ type: 'offer', sdp: 'offer-from-1+cands' });
    const answer = await b.signal(offer!);
    expect(answer).toEqual({ type: 'answer', sdp: 'answer-from-2+cands' });
    await a.signal(answer!);
    await connected;

    a.sendData(new Uint8Array([1, 2, 3]));
    a.sendData(new Uint8Array(16 * 1024).fill(7));
    b.sendData(new TextEncoder().encode('back'));
    await vi.waitFor(() => expect(gotB).toHaveLength(2));
    await vi.waitFor(() => expect(gotA).toHaveLength(1));
    expect([...gotB[0]]).toEqual([1, 2, 3]);
    expect(gotB[1].byteLength).toBe(16 * 1024);
    expect(new TextDecoder().decode(gotA[0])).toBe('back');
    // The ICE servers went to the shell as given.
    expect(calls.find((c) => c.command === 'rtc_create')!.args).toMatchObject({ iceServers: [{ urls: 'stun:stun.example.com:3478' }] });

    const closed = new Promise<void>((r) => a.setHandlers({ close: r }));
    a.destroy();
    await closed;
    expect(calls.some((c) => c.command === 'rtc_close')).toBe(true);
    b.destroy();
  });

  it('keeps the signaling state in step with the descriptions it sets', async () => {
    const { ipc, calls } = fakeShell();
    const pc = new NativeRTCPeerConnection({}, ipc);
    const changes: string[] = [];
    pc.onsignalingstatechange = () => changes.push(pc.signalingState);
    await pc.setLocalDescription();
    expect(pc.signalingState).toBe('have-local-offer');
    expect(pc.localDescription).toEqual({ type: 'offer', sdp: 'offer-from-1' });
    await pc.setLocalDescription({ type: 'rollback' });
    expect(pc.signalingState).toBe('stable');
    expect(pc.localDescription).toBeNull();
    await pc.setRemoteDescription({ type: 'offer', sdp: 'remote' });
    expect(pc.signalingState).toBe('have-remote-offer');
    expect(await pc.createAnswer()).toEqual({ type: 'answer', sdp: 'answer-from-1' });
    await pc.setLocalDescription();
    expect(pc.localDescription?.type).toBe('answer');
    expect(pc.signalingState).toBe('stable');
    await pc.setRemoteDescription({ type: 'rollback' });
    expect(changes).toEqual(['have-local-offer', 'stable', 'have-remote-offer', 'stable']);
    expect(await pc.createOffer({ iceRestart: true })).toEqual({ type: 'offer', sdp: 'offer-from-1-restart' });
    // Trickled candidates go to the shell; an empty one (end of candidates) doesn't.
    await pc.addIceCandidate({ candidate: 'candidate:2 1 udp 1 y.local 9 typ host', sdpMid: '0', sdpMLineIndex: 0 });
    await pc.addIceCandidate({ candidate: '' });
    await pc.addIceCandidate(null);
    expect(calls.filter((c) => c.command === 'rtc_add_ice_candidate')).toHaveLength(1);
    expect(await pc.getStats()).toEqual(new Map());
    expect(pc.getSenders()).toEqual([]);
    expect(() => pc.addTrack()).toThrow(/not audio or video/);
    pc.close();
    pc.close();
    expect(pc.connectionState).toBe('closed');
    await expect(pc.createOffer()).rejects.toThrow(/closed/);
    expect(() => pc.createDataChannel('x')).toThrow(/closed/);
  });

  it('reports trickled candidates with a toJSON, and the end of them', async () => {
    const { ipc } = fakeShell();
    const pc = new NativeRTCPeerConnection({}, ipc);
    const candidates: (RTCIceCandidate | null)[] = [];
    pc.onicecandidate = (e) => candidates.push((e as RTCPeerConnectionIceEvent).candidate);
    await pc.setLocalDescription();
    await vi.waitFor(() => expect(candidates).toHaveLength(2));
    expect(candidates[0]!.toJSON()).toEqual({ candidate: 'candidate:1 1 udp 1 x.local 9 typ host', sdpMid: '0', sdpMLineIndex: 0 });
    expect(candidates[0]!.usernameFragment).toBeNull();
    expect(candidates[1]).toBeNull();
    expect(pc.iceGatheringState).toBe('complete');
    expect(pc.localDescription?.sdp).toBe('offer-from-1+cands');
  });

  it('runs operations in order and reports a failure on the one that failed', async () => {
    const { ipc, failNext } = fakeShell();
    const pc = new NativeRTCPeerConnection({}, ipc);
    failNext.push('rtc_set_description');
    const first = pc.setRemoteDescription({ type: 'offer', sdp: 'x' });
    const second = pc.createAnswer();
    await expect(first).rejects.toBe('rtc_set_description failed');
    await expect(second).resolves.toEqual({ type: 'answer', sdp: 'answer-from-1' });
    expect(pc.signalingState).toBe('stable');
  });

  it('data channels: refuse sends until open, track the buffer, close, and survive errors', async () => {
    const { ipc, failNext } = fakeShell();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pc = new NativeRTCPeerConnection({}, ipc);
    const dc = pc.createDataChannel('data');
    expect(dc.readyState).toBe('connecting');
    expect(() => dc.send('x')).toThrow(/not open/);
    await tick();
    expect(dc.id).toBe(1);
    dc.opened();
    dc.opened();
    const lows: number[] = [];
    const errors: unknown[] = [];
    dc.bufferedAmountLowThreshold = 10;
    dc.onbufferedamountlow = () => lows.push(dc.bufferedAmount);
    dc.addEventListener('error', (e) => errors.push((e as Event & { error: Error }).error));
    dc.send(new Uint8Array(40));
    dc.send(new ArrayBuffer(4));
    dc.send(new DataView(new ArrayBuffer(2)));
    dc.send('hi');
    expect(dc.bufferedAmount).toBe(48);
    // The first send goes alone; the three after it are still queued (8 bytes) when it returns.
    await vi.waitFor(() => expect(lows).toEqual([8]));
    await vi.waitFor(() => expect(dc.bufferedAmount).toBe(0));
    expect(() => dc.send(new Blob(['x']))).toThrow(TypeError);
    failNext.push('rtc_send');
    dc.send('boom');
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    // The shell says the buffer drained.
    dc.setBuffered(100);
    (pc as unknown as { onEvent(e: RtcEvent): void }).onEvent({ kind: 'bufferedAmountLow', channel: 1, buffered: 0 });
    expect(lows).toEqual([8, 0]);
    const closes: string[] = [];
    dc.onclose = () => closes.push(dc.readyState);
    dc.close();
    dc.close();
    expect(closes).toEqual(['closed']);

    // A channel closed before the shell gave it an id.
    const early = pc.createDataChannel('early');
    early.close();
    await tick();
    expect(early.readyState).toBe('closed');

    // A channel the shell couldn't make.
    failNext.push('rtc_create_data_channel');
    const broken = pc.createDataChannel('broken');
    await tick();
    expect(broken.readyState).toBe('closed');
    expect(warn).toHaveBeenCalledWith('Could not make the data channel', 'rtc_create_data_channel failed');
  });

  it('routes the shell events to the right channel', async () => {
    const { ipc } = fakeShell();
    const pc = new NativeRTCPeerConnection({}, ipc);
    const on = (pc as unknown as { onEvent(e: RtcEvent): void }).onEvent.bind(pc);
    const onMessage = (pc as unknown as { onMessage(m: ArrayBuffer | Uint8Array | number[]): void }).onMessage.bind(pc);
    let remote: RTCDataChannel | null = null;
    pc.ondatachannel = (e) => (remote = (e as RTCDataChannelEvent).channel);
    on({ kind: 'dataChannel', channel: 5, label: 'data' });
    expect(remote!.label).toBe('data');
    const messages: unknown[] = [];
    remote!.onmessage = (e) => messages.push(e.data);
    on({ kind: 'channelOpen', channel: 5 });
    expect(remote!.readyState).toBe('open');
    onMessage(new Uint8Array([0, 5, 9]).buffer);
    onMessage([0, 5, 8]);
    onMessage(new Uint8Array([0, 6, 1]));
    onMessage(new Uint8Array([0]));
    expect(messages.map((m) => [...new Uint8Array(m as ArrayBuffer)])).toEqual([[9], [8]]);
    remote!.binaryType = 'blob';
    onMessage(new Uint8Array([0, 5, 1]));
    expect(messages[2]).toBeInstanceOf(Blob);
    const errors: unknown[] = [];
    remote!.onerror = (e) => errors.push(e);
    on({ kind: 'channelError', channel: 5, message: 'sctp' });
    expect(errors).toHaveLength(1);
    on({ kind: 'signalingState', state: 'have-local-offer' });
    expect(pc.signalingState).toBe('stable');
    on({ kind: 'channelClose', channel: 5 });
    expect(remote!.readyState).toBe('closed');
    on({ kind: 'iceConnectionState', state: 'failed' });
    expect(pc.iceConnectionState).toBe('failed');
    pc.close();
    on({ kind: 'connectionState', state: 'connected' });
    expect(pc.connectionState).toBe('closed');
  });

  it('closes a peer the page closed before the shell answered', async () => {
    const { ipc, calls } = fakeShell();
    const pc = new NativeRTCPeerConnection({}, ipc);
    pc.close();
    await tick();
    expect(calls.map((c) => c.command)).toEqual(['rtc_create', 'rtc_close']);
  });

  it('needs the shell bindings', async () => {
    expect(() => new NativeRTCPeerConnection({})).toThrow(/nativeRtcPeerConnection/);
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke: vi.fn(async () => 1), transformCallback: vi.fn(() => 1) });
    try {
      const Bound = await nativeRtcPeerConnection();
      expect(new Bound({}).connectionState).toBe('new');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
