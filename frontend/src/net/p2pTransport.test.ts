import { joinRoom } from '@trystero-p2p/torrent';
import { P2pTransport, connectionLabel, usesRelay } from './p2pTransport';
import type { BootstrapConfig } from './bootstrapConfig';

type Handler = ((data: unknown, context: { peerId: string; metadata?: unknown }) => void) | undefined;

// A stand-in for a trystero 0.26 room: makeAction returns { send, onMessage }, peer events are
// settable properties, and send and leave return promises.
function fakeRoom(peers: Record<string, unknown> = {}) {
  const actions: Record<string, { send: ReturnType<typeof vi.fn>; onMessage: Handler }> = {};
  const room = {
    makeAction: vi.fn((name: string, config?: { onMessage?: Handler }) => {
      actions[name] = { send: vi.fn(() => Promise.resolve()), onMessage: config?.onMessage };
      return actions[name];
    }),
    onPeerJoin: null as ((peerId: string) => void) | null,
    onPeerLeave: null as ((peerId: string) => void) | null,
    getPeers: () => peers,
    leave: vi.fn(() => Promise.resolve()),
  };
  return {
    room,
    actions,
    join: (peerId: string) => room.onPeerJoin?.(peerId),
    leave: (peerId: string) => room.onPeerLeave?.(peerId),
  };
}

let current = fakeRoom();

vi.mock('@trystero-p2p/torrent', () => ({
  joinRoom: vi.fn(() => current.room),
}));

describe('P2pTransport', () => {
  const bootstrap: BootstrapConfig = {
    appId: 'test-app',
    environment: 'localhost',
    rendezvous: ['wss://tracker.example'],
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  };
  const callbacks = () => ({ onMessage: vi.fn(), onState: vi.fn(), onPeerCount: vi.fn(), onPeerJoin: vi.fn() });

  beforeEach(() => {
    current = fakeRoom();
  });

  it('sends and receives binary file chunks on their own action', () => {
    const onBinary = vi.fn();
    const transport = new P2pTransport(bootstrap, { ...callbacks(), onBinary });
    // Nothing to send on before joining.
    transport.sendBinary(new Uint8Array([1]), 'peer-1', { hash: 'h' });
    transport.join('room-b');
    const chunk = new Uint8Array([1, 2]);
    transport.sendBinary(chunk, 'peer-1', { hash: 'h' });
    // Trystero 0.26 delivers binary as a Uint8Array.
    current.actions['file-chunk'].onMessage?.(chunk, { peerId: 'peer-1', metadata: { hash: 'h' } });

    const sendBinary = current.actions['file-chunk'].send;
    expect(sendBinary).toHaveBeenCalledTimes(1);
    expect(sendBinary).toHaveBeenCalledWith(chunk, { target: 'peer-1', metadata: { hash: 'h' } });
    expect(onBinary).toHaveBeenCalledWith(chunk, 'peer-1', { hash: 'h' });
  });

  it('passes the rendezvous list to trystero as relayConfig urls', () => {
    const transport = new P2pTransport(bootstrap, callbacks());
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
    const cb = callbacks();
    const transport = new P2pTransport(bootstrap, cb);
    transport.join('room-a');
    current.actions['doc-msg'].onMessage?.('hello', { peerId: 'peer-1' });
    current.join('peer-2');
    transport.send('outbound');

    expect(cb.onMessage).toHaveBeenCalledWith('hello', 'peer-1');
    expect(cb.onPeerJoin).toHaveBeenCalledWith('peer-2');
    // A broadcast has no options, so trystero sends it to everyone.
    expect(current.actions['doc-msg'].send).toHaveBeenCalledWith('outbound', undefined);
    expect(cb.onState).toHaveBeenCalledWith('Waiting for peers');
    expect(cb.onState).toHaveBeenCalledWith('Connected');
  });

  it('uses the trystero 0.25+ room API: action objects and settable peer handlers', () => {
    const transport = new P2pTransport(bootstrap, callbacks());
    transport.join('room-api');
    expect(current.room.makeAction).toHaveBeenCalledWith('doc-msg', { onMessage: expect.any(Function) });
    expect(current.room.makeAction).toHaveBeenCalledWith('file-chunk', { onMessage: expect.any(Function) });
    expect(current.room.onPeerJoin).toEqual(expect.any(Function));
    expect(current.room.onPeerLeave).toEqual(expect.any(Function));
  });

  it('swallows send failures, which happen when a peer leaves mid-send', async () => {
    const transport = new P2pTransport(bootstrap, callbacks());
    transport.join('room-reject');
    current.actions['doc-msg'].send.mockReturnValue(Promise.reject(new Error('peer disconnected')));
    current.actions['file-chunk'].send.mockReturnValue(Promise.reject(new Error('peer disconnected')));
    current.room.leave.mockReturnValue(Promise.reject(new Error('already left')));
    transport.send({ kind: 'x' });
    transport.sendBinary(new Uint8Array([1]), 'peer-1', null);
    transport.disconnect();
    // An unhandled rejection would fail the run.
    await flush();
  });

  it('transitions host from waiting to connected when first peer joins', () => {
    const cb = callbacks();
    const transport = new P2pTransport(bootstrap, cb);

    transport.join('room-host');
    expect(cb.onState).toHaveBeenCalledWith('Waiting for peers');
    current.join('peer-new-client');

    expect(cb.onState).toHaveBeenCalledWith('Connected');
  });

  it('keeps waiting for peers when nobody joins', () => {
    vi.useFakeTimers();
    const cb = callbacks();
    const transport = new P2pTransport(bootstrap, cb);
    transport.join('room-b');
    vi.advanceTimersByTime(60_000);

    expect(cb.onState).toHaveBeenCalledTimes(1);
    expect(cb.onState).toHaveBeenLastCalledWith('Waiting for peers');
    vi.useRealTimers();
  });

  it('counts peers and emits Reconnecting when the last one leaves', () => {
    const cb = callbacks();
    const transport = new P2pTransport(bootstrap, cb);
    transport.join('room-leave');
    current.join('peer-a');
    current.join('peer-b');
    expect(transport.getPeerCount()).toBe(2);
    expect(cb.onPeerCount).toHaveBeenLastCalledWith(2);

    // One peer left, so we're still connected to the other.
    current.leave('peer-a');
    expect(cb.onPeerCount).toHaveBeenLastCalledWith(1);
    expect(cb.onState).toHaveBeenLastCalledWith('Connected');

    current.leave('peer-b');
    expect(transport.getPeerCount()).toBe(0);
    expect(cb.onState).toHaveBeenLastCalledWith('Reconnecting');
  });

  it('emits Not sharing and a zero count on disconnect', () => {
    const cb = callbacks();
    const transport = new P2pTransport(bootstrap, cb);
    transport.join('room-off');
    transport.disconnect();
    expect(cb.onState).toHaveBeenLastCalledWith('Not sharing');
    expect(cb.onPeerCount).toHaveBeenLastCalledWith(0);
  });

  it('shows Relayed only when the peer goes through TURN', async () => {
    current = fakeRoom({
      direct: fakeConnection('host'),
      turn: fakeConnection('relay'),
      broken: { getStats: () => Promise.reject(new Error('closed')) },
    });
    const cb = callbacks();
    const transport = new P2pTransport(bootstrap, cb);
    transport.join('room-relay');

    // A direct peer and one whose stats fail both stay Connected.
    current.join('direct');
    current.join('broken');
    current.join('missing');
    await flush();
    expect(cb.onState).not.toHaveBeenCalledWith('Relayed');

    current.join('turn');
    await vi.waitFor(() => expect(cb.onState).toHaveBeenLastCalledWith('Relayed'));

    // Once the relayed peer leaves, we're back to a direct connection.
    current.leave('turn');
    expect(cb.onState).toHaveBeenLastCalledWith('Connected');
  });

  it('ignores relay results for a peer that already left', async () => {
    current = fakeRoom({ turn: fakeConnection('relay') });
    const cb = callbacks();
    const transport = new P2pTransport(bootstrap, cb);
    transport.join('room-gone');
    current.join('turn');
    current.leave('turn');
    await flush();
    expect(cb.onState).not.toHaveBeenCalledWith('Relayed');
  });

  it('send forwards peer id as the target when provided', () => {
    const transport = new P2pTransport(bootstrap, callbacks());
    transport.join('room-target');
    transport.send({ a: 1 }, 'peer-z');
    expect(current.actions['doc-msg'].send).toHaveBeenCalledWith({ a: 1 }, { target: 'peer-z' });
  });

  it('does not emit Relayed after a direct peer connects', () => {
    vi.useFakeTimers();
    const cb = callbacks();
    const transport = new P2pTransport(bootstrap, cb);
    transport.join('room-timers-skip');
    current.join('peer-early');
    vi.advanceTimersByTime(10_000);
    vi.advanceTimersByTime(10_000);
    expect(cb.onState).not.toHaveBeenCalledWith('Relayed');
    vi.useRealTimers();
  });

  it('send is a no-op before join', () => {
    const joinCalls = vi.mocked(joinRoom).mock.calls.length;
    const transport = new P2pTransport(bootstrap, callbacks());
    transport.send('early');
    expect(vi.mocked(joinRoom).mock.calls.length).toBe(joinCalls);
  });

  it('disconnect before join does not try to leave a room', () => {
    const transport = new P2pTransport(bootstrap, callbacks());
    transport.disconnect();
    expect(current.room.leave).not.toHaveBeenCalled();
  });

  it('disconnect leaves the room and drops later sends', () => {
    const transport = new P2pTransport(bootstrap, callbacks());
    transport.join('room-disc');
    transport.disconnect();
    expect(current.room.leave).toHaveBeenCalled();
    // Sends after leaving the room go nowhere.
    transport.send({ kind: 'late' });
    expect(current.actions['doc-msg'].send).not.toHaveBeenCalled();
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
