import { joinRoom } from '@trystero-p2p/torrent';
import { P2pTransport, connectionLabel, usesRelay } from './p2pTransport';
import type { BootstrapConfig } from './bootstrapConfig';

const makeAction = vi.fn();
const onPeerJoin = vi.fn();
const onPeerLeave = vi.fn();
const leave = vi.fn();

vi.mock('@trystero-p2p/torrent', () => ({
  joinRoom: vi.fn(() => ({
    makeAction,
    onPeerJoin,
    onPeerLeave,
    leave,
  })),
}));

describe('P2pTransport', () => {
  const bootstrap: BootstrapConfig = {
    appId: 'test-app',
    environment: 'localhost',
    rendezvous: ['wss://tracker.example'],
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  };

  beforeEach(() => {
    // The file-chunk action gets made after doc-msg, so give it a harmless default.
    makeAction.mockReturnValue([vi.fn(), vi.fn()]);
  });

  it('sends and receives binary file chunks on their own action', () => {
    let binaryReceiver: ((data: ArrayBuffer, peerId: string, metadata: unknown) => void) | undefined;
    const sendBinary = vi.fn();
    makeAction.mockImplementation((name: string) =>
      name === 'file-chunk'
        ? [sendBinary, (cb: typeof binaryReceiver) => (binaryReceiver = cb)]
        : [vi.fn(), vi.fn()],
    );
    const onBinary = vi.fn();
    const transport = new P2pTransport(bootstrap, { onMessage: vi.fn(), onState: vi.fn(), onPeerCount: vi.fn(), onPeerJoin: vi.fn(), onBinary });
    // Nothing to send on before joining.
    transport.sendBinary(new Uint8Array([1]), 'peer-1', { hash: 'h' });
    transport.join('room-b');
    const chunk = new Uint8Array([1, 2]);
    transport.sendBinary(chunk, 'peer-1', { hash: 'h' });
    binaryReceiver?.(chunk.buffer, 'peer-1', { hash: 'h' });

    expect(sendBinary).toHaveBeenCalledTimes(1);
    expect(sendBinary).toHaveBeenCalledWith(chunk, 'peer-1', { hash: 'h' });
    expect(onBinary).toHaveBeenCalledWith(chunk.buffer, 'peer-1', { hash: 'h' });
    makeAction.mockReset();
  });

  it('passes the rendezvous list to trystero as relayConfig urls', () => {
    const transport = new P2pTransport(bootstrap, { onMessage: vi.fn(), onState: vi.fn(), onPeerCount: vi.fn(), onPeerJoin: vi.fn() });
    transport.join('room-relays');

    expect(joinRoom).toHaveBeenLastCalledWith(
      {
        appId: 'test-app',
        relayConfig: { urls: ['wss://tracker.example'] },
        rtcConfig: { iceServers: bootstrap.iceServers },
      },
      'room-relays',
    );
  });

  it('joins room, receives, and sends payloads', () => {
    let receiver: ((value: unknown, peerId?: string) => void) | undefined;
    let peerJoinHandler: ((peerId: string) => void) | undefined;
    const send = vi.fn();
    onPeerJoin.mockImplementation((cb: (peerId: string) => void) => {
      peerJoinHandler = cb;
    });
    makeAction.mockReturnValueOnce([
      send,
      (cb: (value: unknown, peerId?: string) => void) => {
        receiver = cb;
      },
    ]);

    const onMessage = vi.fn();
    const onPeerJoinEvent = vi.fn();
    const onState = vi.fn();
    const transport = new P2pTransport(bootstrap, {
      onMessage,
      onState,
      onPeerCount: vi.fn(),
      onPeerJoin: onPeerJoinEvent,
    });
    transport.join('room-a');
    receiver?.('hello', 'peer-1');
    peerJoinHandler?.('peer-2');
    transport.send('outbound');

    expect(onMessage).toHaveBeenCalledWith('hello', 'peer-1');
    expect(onPeerJoinEvent).toHaveBeenCalledWith('peer-2');
    expect(send).toHaveBeenCalledWith('outbound');
    expect(onState).toHaveBeenCalledWith('Waiting for peers');
    expect(onState).toHaveBeenCalledWith('Connected');
  });

  it('transitions host from waiting to connected when first peer joins', () => {
    let peerJoinHandler: ((peerId: string) => void) | undefined;
    onPeerJoin.mockImplementation((cb: (peerId: string) => void) => {
      peerJoinHandler = cb;
    });
    makeAction.mockReturnValueOnce([vi.fn(), vi.fn()]);
    const onState = vi.fn();
    const transport = new P2pTransport(bootstrap, {
      onMessage: vi.fn(),
      onState,
      onPeerCount: vi.fn(),
      onPeerJoin: vi.fn(),
    });

    transport.join('room-host');
    expect(onState).toHaveBeenCalledWith('Waiting for peers');
    peerJoinHandler?.('peer-new-client');

    expect(onState).toHaveBeenCalledWith('Connected');
  });

  it('keeps waiting for peers when nobody joins', () => {
    vi.useFakeTimers();
    makeAction.mockReturnValueOnce([vi.fn(), vi.fn()]);
    const onState = vi.fn();
    const transport = new P2pTransport(bootstrap, {
      onMessage: vi.fn(),
      onState,
      onPeerCount: vi.fn(),
      onPeerJoin: vi.fn(),
    });
    transport.join('room-b');
    vi.advanceTimersByTime(60_000);

    expect(onState).toHaveBeenCalledTimes(1);
    expect(onState).toHaveBeenLastCalledWith('Waiting for peers');
    vi.useRealTimers();
  });

  it('counts peers and emits Reconnecting when the last one leaves', () => {
    let leaveHandler: ((peerId: string) => void) | undefined;
    let joinHandler: ((peerId: string) => void) | undefined;
    onPeerLeave.mockImplementation((cb: (peerId: string) => void) => {
      leaveHandler = cb;
    });
    onPeerJoin.mockImplementation((cb: (peerId: string) => void) => {
      joinHandler = cb;
    });
    makeAction.mockReturnValueOnce([vi.fn(), vi.fn()]);
    const onState = vi.fn();
    const onPeerCount = vi.fn();
    const transport = new P2pTransport(bootstrap, {
      onMessage: vi.fn(),
      onState,
      onPeerCount,
      onPeerJoin: vi.fn(),
    });
    transport.join('room-leave');
    joinHandler?.('peer-a');
    joinHandler?.('peer-b');
    expect(transport.getPeerCount()).toBe(2);
    expect(onPeerCount).toHaveBeenLastCalledWith(2);

    // One peer left, so we're still connected to the other.
    leaveHandler?.('peer-a');
    expect(onPeerCount).toHaveBeenLastCalledWith(1);
    expect(onState).toHaveBeenLastCalledWith('Connected');

    leaveHandler?.('peer-b');
    expect(transport.getPeerCount()).toBe(0);
    expect(onState).toHaveBeenLastCalledWith('Reconnecting');
  });

  it('emits Not sharing and a zero count on disconnect', () => {
    makeAction.mockReturnValue([vi.fn(), vi.fn()]);
    const onState = vi.fn();
    const onPeerCount = vi.fn();
    const transport = new P2pTransport(bootstrap, { onMessage: vi.fn(), onState, onPeerCount, onPeerJoin: vi.fn() });
    transport.join('room-off');
    transport.disconnect();
    expect(onState).toHaveBeenLastCalledWith('Not sharing');
    expect(onPeerCount).toHaveBeenLastCalledWith(0);
  });

  it('shows Relayed only when the peer goes through TURN', async () => {
    let joinHandler: ((peerId: string) => void) | undefined;
    let leaveHandler: ((peerId: string) => void) | undefined;
    const peers: Record<string, unknown> = {
      direct: fakeConnection('host'),
      turn: fakeConnection('relay'),
      broken: { getStats: () => Promise.reject(new Error('closed')) },
    };
    vi.mocked(joinRoom).mockReturnValueOnce({
      makeAction: () => [vi.fn(), vi.fn()],
      onPeerJoin: (cb: (peerId: string) => void) => (joinHandler = cb),
      onPeerLeave: (cb: (peerId: string) => void) => (leaveHandler = cb),
      getPeers: () => peers,
      leave,
    } as any);
    const onState = vi.fn();
    const transport = new P2pTransport(bootstrap, { onMessage: vi.fn(), onState, onPeerCount: vi.fn(), onPeerJoin: vi.fn() });
    transport.join('room-relay');

    // A direct peer and one whose stats fail both stay Connected.
    joinHandler?.('direct');
    joinHandler?.('broken');
    joinHandler?.('missing');
    await flush();
    expect(onState).not.toHaveBeenCalledWith('Relayed');

    joinHandler?.('turn');
    await vi.waitFor(() => expect(onState).toHaveBeenLastCalledWith('Relayed'));

    // Once the relayed peer leaves, we're back to a direct connection.
    leaveHandler?.('turn');
    expect(onState).toHaveBeenLastCalledWith('Connected');
  });

  it('ignores relay results for a peer that already left', async () => {
    let joinHandler: ((peerId: string) => void) | undefined;
    let leaveHandler: ((peerId: string) => void) | undefined;
    vi.mocked(joinRoom).mockReturnValueOnce({
      makeAction: () => [vi.fn(), vi.fn()],
      onPeerJoin: (cb: (peerId: string) => void) => (joinHandler = cb),
      onPeerLeave: (cb: (peerId: string) => void) => (leaveHandler = cb),
      getPeers: () => ({ turn: fakeConnection('relay') }),
      leave,
    } as any);
    const onState = vi.fn();
    const transport = new P2pTransport(bootstrap, { onMessage: vi.fn(), onState, onPeerCount: vi.fn(), onPeerJoin: vi.fn() });
    transport.join('room-gone');
    joinHandler?.('turn');
    leaveHandler?.('turn');
    await flush();
    expect(onState).not.toHaveBeenCalledWith('Relayed');
  });

  it('send forwards peer id when provided', () => {
    const send = vi.fn();
    makeAction.mockReturnValueOnce([
      send,
      (_cb: (value: unknown, peerId?: string) => void) => {},
    ]);
    const transport = new P2pTransport(bootstrap, {
      onMessage: vi.fn(),
      onState: vi.fn(),
      onPeerCount: vi.fn(),
      onPeerJoin: vi.fn(),
    });
    transport.join('room-target');
    transport.send({ a: 1 }, 'peer-z');
    expect(send).toHaveBeenCalledWith({ a: 1 }, 'peer-z');
  });

  it('does not emit Relayed after a direct peer connects', () => {
    vi.useFakeTimers();
    let peerJoinHandler: ((peerId: string) => void) | undefined;
    onPeerJoin.mockImplementation((cb: (peerId: string) => void) => {
      peerJoinHandler = cb;
    });
    makeAction.mockReturnValueOnce([vi.fn(), vi.fn()]);
    const onState = vi.fn();
    const transport = new P2pTransport(bootstrap, {
      onMessage: vi.fn(),
      onState,
      onPeerCount: vi.fn(),
      onPeerJoin: vi.fn(),
    });
    transport.join('room-timers-skip');
    peerJoinHandler?.('peer-early');
    vi.advanceTimersByTime(10_000);
    vi.advanceTimersByTime(10_000);
    expect(onState).not.toHaveBeenCalledWith('Relayed');
    vi.useRealTimers();
  });

  it('send is a no-op before join', () => {
    const joinCalls = vi.mocked(joinRoom).mock.calls.length;
    const transport = new P2pTransport(bootstrap, {
      onMessage: vi.fn(),
      onState: vi.fn(),
      onPeerCount: vi.fn(),
      onPeerJoin: vi.fn(),
    });
    transport.send('early');
    expect(vi.mocked(joinRoom).mock.calls.length).toBe(joinCalls);
  });

  it('disconnect skips leave when room has no leave handler', () => {
    vi.mocked(joinRoom).mockReturnValueOnce({
      makeAction: () => [vi.fn(), vi.fn()],
      onPeerJoin: vi.fn(),
      onPeerLeave: vi.fn(),
    } as any);
    const transport = new P2pTransport(bootstrap, {
      onMessage: vi.fn(),
      onState: vi.fn(),
      onPeerCount: vi.fn(),
      onPeerJoin: vi.fn(),
    });
    transport.join('room-no-leave');
    // Earlier tests leave rooms too, so only count calls from here.
    leave.mockClear();
    transport.disconnect();
    expect(leave).not.toHaveBeenCalled();
  });

  it('disconnect clears timers and leaves the room', () => {
    vi.useFakeTimers();
    makeAction.mockReturnValueOnce([vi.fn(), vi.fn()]);
    const transport = new P2pTransport(bootstrap, {
      onMessage: vi.fn(),
      onState: vi.fn(),
      onPeerCount: vi.fn(),
      onPeerJoin: vi.fn(),
    });
    transport.join('room-disc');
    transport.disconnect();
    expect(leave).toHaveBeenCalled();
    // Sends after leaving the room go nowhere.
    expect(() => transport.send({ kind: 'late' })).not.toThrow();
    vi.useRealTimers();
  });
});

// Let pending stats promises settle.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Make a peer connection whose selected pair uses the given local candidate type.
function fakeConnection(localType: string) {
  const reports = new Map<string, any>([
    ['T1', { type: 'transport', selectedCandidatePairId: 'P1' }],
    ['P1', { type: 'candidate-pair', localCandidateId: 'L1', remoteCandidateId: 'R1' }],
    ['L1', { type: 'local-candidate', candidateType: localType }],
    ['R1', { type: 'remote-candidate', candidateType: 'srflx' }],
  ]);
  return { getStats: async () => reports } as unknown as RTCPeerConnection;
}

describe('usesRelay', () => {
  const statsConnection = (reports: [string, any][]) =>
    ({ getStats: async () => new Map(reports) }) as unknown as RTCPeerConnection;

  it('reads the selected pair from the transport report', async () => {
    expect(await usesRelay(fakeConnection('relay'))).toBe(true);
    expect(await usesRelay(fakeConnection('host'))).toBe(false);
  });

  it('falls back to the nominated pair when there is no transport report', async () => {
    const connection = statsConnection([
      ['P0', { type: 'candidate-pair', nominated: false, state: 'failed', localCandidateId: 'L0', remoteCandidateId: 'R0' }],
      ['P1', { type: 'candidate-pair', nominated: true, state: 'succeeded', localCandidateId: 'L1', remoteCandidateId: 'R1' }],
      ['L0', { type: 'local-candidate', candidateType: 'relay' }],
      ['L1', { type: 'local-candidate', candidateType: 'host' }],
      ['R1', { type: 'remote-candidate', candidateType: 'relay' }],
    ]);
    expect(await usesRelay(connection)).toBe(true);
  });

  it('uses the selected flag that Firefox sets', async () => {
    const connection = statsConnection([
      ['P1', { type: 'candidate-pair', selected: true, localCandidateId: 'L1', remoteCandidateId: 'R1' }],
      ['L1', { type: 'local-candidate', candidateType: 'srflx' }],
    ]);
    expect(await usesRelay(connection)).toBe(false);
  });

  it('says not relayed when no pair is picked yet', async () => {
    expect(await usesRelay(statsConnection([]))).toBe(false);
  });
});

describe('connectionLabel', () => {
  it('adds the peer count only when peers are connected', () => {
    expect(connectionLabel('Waiting for peers', 0)).toBe('Waiting for peers');
    expect(connectionLabel('Connected', 1)).toBe('Connected · 1 peer');
    expect(connectionLabel('Relayed', 3)).toBe('Relayed · 3 peers');
  });
});
