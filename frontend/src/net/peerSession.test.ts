import { PeerSession } from './peerSession';
import type { BootstrapConfig } from './bootstrapConfig';

const transportMocks = vi.hoisted(() => ({
  join: vi.fn(),
  send: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock('./p2pTransport', () => ({
  P2pTransport: class MockP2pTransport {
    join = transportMocks.join;
    send = transportMocks.send;
    disconnect = transportMocks.disconnect;
  },
}));

describe('PeerSession', () => {
  const bootstrap: BootstrapConfig = {
    appId: 'app',
    environment: 'localhost',
    rendezvous: ['wss://t'],
    iceServers: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('joinRoom forwards to transport', () => {
    const session = new PeerSession(bootstrap, {
      onMessage: vi.fn(),
      onState: vi.fn(),
      onPeerCount: vi.fn(),
      onPeerJoin: vi.fn(),
    });
    session.joinRoom('room-xyz');
    expect(transportMocks.join).toHaveBeenCalledWith('room-xyz');
  });

  it('sendMessage forwards payload and optional peer id', () => {
    const session = new PeerSession(bootstrap, {
      onMessage: vi.fn(),
      onState: vi.fn(),
      onPeerCount: vi.fn(),
      onPeerJoin: vi.fn(),
    });
    session.sendMessage({ kind: 'ping' }, 'peer-1');
    expect(transportMocks.send).toHaveBeenCalledWith({ kind: 'ping' }, 'peer-1');
    session.sendMessage({ kind: 'broadcast' });
    expect(transportMocks.send).toHaveBeenLastCalledWith({ kind: 'broadcast' }, undefined);
  });

  it('close disconnects transport', () => {
    const session = new PeerSession(bootstrap, {
      onMessage: vi.fn(),
      onState: vi.fn(),
      onPeerCount: vi.fn(),
      onPeerJoin: vi.fn(),
    });
    session.close();
    expect(transportMocks.disconnect).toHaveBeenCalled();
  });
});
