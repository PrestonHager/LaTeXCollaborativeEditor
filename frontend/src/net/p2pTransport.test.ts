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
});
