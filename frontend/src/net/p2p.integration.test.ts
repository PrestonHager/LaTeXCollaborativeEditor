import { P2pTransport } from './p2pTransport';
import type { BootstrapConfig } from './bootstrapConfig';

const joinRoomSpy = vi.fn();
let peerJoinHandler: ((peerId: string) => void) | undefined;
let inboundHandler: ((value: unknown, peerId?: string) => void) | undefined;

vi.mock('trystero', () => ({
  joinRoom: (...args: unknown[]) => {
    joinRoomSpy(...args);
    return {
      makeAction: () => [
        vi.fn(),
        (cb: (value: unknown, peerId?: string) => void) => {
          inboundHandler = cb;
        },
      ],
      onPeerJoin: (cb: (peerId: string) => void) => {
        peerJoinHandler = cb;
      },
      onPeerLeave: vi.fn(),
      leave: vi.fn(),
    };
  },
}));

describe('P2P integration', () => {
  it('moves through joining flow and keeps rendezvous metadata free of document payloads', () => {
    const bootstrap: BootstrapConfig = {
      appId: 'latex-app',
      environment: 'production',
      rendezvous: ['wss://tracker.openwebtorrent.com'],
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    };

    const states: string[] = [];
    const onMessage = vi.fn();
    const onPeerJoinEvent = vi.fn();
    const transport = new P2pTransport(bootstrap, {
      onMessage,
      onState: (s) => states.push(s),
      onPeerCount: vi.fn(),
      onPeerJoin: onPeerJoinEvent,
    });

    transport.join('room-123');
    peerJoinHandler?.('peer-a');
    inboundHandler?.('shared-text', 'peer-a');

    expect(states).toContain('Connected');
    expect(onMessage).toHaveBeenCalledWith('shared-text', 'peer-a');
    expect(onPeerJoinEvent).toHaveBeenCalledWith('peer-a');
    const serializedJoinConfig = JSON.stringify(joinRoomSpy.mock.calls[0][0]);
    expect(serializedJoinConfig.includes('shared-text')).toBe(false);
  });
});
