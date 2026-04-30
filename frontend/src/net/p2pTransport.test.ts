import { joinRoom } from 'trystero';
import { P2pTransport } from './p2pTransport';
import type { BootstrapConfig } from './bootstrapConfig';

const makeAction = vi.fn();
const onPeerJoin = vi.fn();
const onPeerLeave = vi.fn();
const leave = vi.fn();

vi.mock('trystero', () => ({
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
    expect(onState).toHaveBeenCalledWith('Dialing');
    expect(onState).toHaveBeenCalledWith('Connected');
  });

  it('transitions host from dialing to connected when first peer joins', () => {
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
    expect(onState).toHaveBeenCalledWith('Dialing');
    peerJoinHandler?.('peer-new-client');

    expect(onState).toHaveBeenCalledWith('Connected');
  });

  it('emits fallback states when peers do not join', () => {
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
    vi.advanceTimersByTime(10_000);
    vi.advanceTimersByTime(10_000);

    expect(onState).toHaveBeenCalledWith('Relayed');
    expect(onState).toHaveBeenCalledWith('Failed');
    vi.useRealTimers();
  });

  it('emits Reconnecting when the last peer leaves', () => {
    let leaveHandler: (() => void) | undefined;
    let joinHandler: ((peerId: string) => void) | undefined;
    onPeerLeave.mockImplementation((cb: () => void) => {
      leaveHandler = cb;
    });
    onPeerJoin.mockImplementation((cb: (peerId: string) => void) => {
      joinHandler = cb;
    });
    makeAction.mockReturnValueOnce([vi.fn(), vi.fn()]);
    const onState = vi.fn();
    const transport = new P2pTransport(bootstrap, {
      onMessage: vi.fn(),
      onState,
      onPeerCount: vi.fn(),
      onPeerJoin: vi.fn(),
    });
    transport.join('room-leave');
    joinHandler?.('solo-peer');
    leaveHandler?.();
    expect(onState).toHaveBeenCalledWith('Reconnecting');
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

  it('does not emit Relayed or Failed when a peer is connected before timers', () => {
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
    expect(onState).not.toHaveBeenCalledWith('Failed');
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
    vi.useRealTimers();
  });
});
