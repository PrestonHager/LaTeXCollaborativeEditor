import { P2pTransport } from './p2pTransport';
import type { BootstrapConfig } from './bootstrapConfig';

const joinRoomSpy = vi.fn();
let peerJoinHandler: ((peerId: string) => void) | undefined;
let inboundHandler: ((value: unknown, peerId?: string) => void) | undefined;

vi.mock('@trystero-p2p/torrent', () => ({
  joinRoom: (...args: unknown[]) => {
    joinRoomSpy(...args);
    // Trystero 0.25+ shape: action objects and settable peer handlers.
    const room = {
      makeAction: (name: string, config?: { onMessage?: (value: unknown, context: { peerId: string }) => void }) => {
        if (name === 'doc-msg') inboundHandler = (value, peerId) => config?.onMessage?.(value, { peerId: peerId ?? '' });
        return { send: vi.fn(() => Promise.resolve()), onMessage: config?.onMessage ?? null };
      },
      onPeerJoin: null as ((peerId: string) => void) | null,
      onPeerLeave: null as ((peerId: string) => void) | null,
      getPeers: () => ({}),
      leave: vi.fn(() => Promise.resolve()),
    };
    peerJoinHandler = (peerId) => room.onPeerJoin?.(peerId);
    return room;
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
