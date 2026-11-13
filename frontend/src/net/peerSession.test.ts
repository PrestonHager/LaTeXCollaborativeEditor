import { PeerSession, type LoadTransport } from './peerSession';
import type { BootstrapConfig } from './bootstrapConfig';

const transportMocks = vi.hoisted(() => ({
  created: vi.fn(),
  join: vi.fn(),
  send: vi.fn(),
  sendBinary: vi.fn(),
  disconnect: vi.fn(),
  getPeerCount: vi.fn(() => 3),
}));

vi.mock('./p2pTransport', () => ({
  P2pTransport: class MockP2pTransport {
    constructor(...args: unknown[]) {
      transportMocks.created(...args);
    }
    join = transportMocks.join;
    send = transportMocks.send;
    sendBinary = transportMocks.sendBinary;
    disconnect = transportMocks.disconnect;
    getPeerCount = transportMocks.getPeerCount;
  },
}));

const bootstrap: BootstrapConfig = {
  appId: 'app',
  environment: 'localhost',
  rendezvous: ['wss://t'],
  iceServers: [],
};

const callbacks = () => ({
  onMessage: vi.fn(),
  onState: vi.fn(),
  onPeerCount: vi.fn(),
  onPeerJoin: vi.fn(),
  onLoadError: vi.fn(),
});

/** Let the dynamic import and its .then callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('PeerSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not load the transport until something needs it', async () => {
    const load = vi.fn<LoadTransport>(() => import('./p2pTransport'));
    const session = new PeerSession(bootstrap, callbacks(), load);
    session.sendMessage({ kind: 'ping' });
    expect(session.getPeerCount()).toBe(0);
    await settle();
    expect(load).not.toHaveBeenCalled();
    expect(transportMocks.send).not.toHaveBeenCalled();
  });

  it('joinRoom loads the transport, then joins', async () => {
    const cb = callbacks();
    const session = new PeerSession(bootstrap, cb);
    session.joinRoom('room-xyz');
    // The badge says "Waiting for peers" right away, as the transport would.
    expect(cb.onState).toHaveBeenCalledWith('Waiting for peers');
    await settle();
    expect(transportMocks.created).toHaveBeenCalledTimes(1);
    expect(transportMocks.join).toHaveBeenCalledWith('room-xyz');
    // Later joins go straight to the loaded transport.
    session.joinRoom('room-2');
    expect(transportMocks.join).toHaveBeenLastCalledWith('room-2');
    expect(transportMocks.created).toHaveBeenCalledTimes(1);
  });

  it('joins only the last room asked for while loading', async () => {
    const session = new PeerSession(bootstrap, callbacks());
    session.joinRoom('first');
    session.joinRoom('second');
    await settle();
    expect(transportMocks.join).toHaveBeenCalledTimes(1);
    expect(transportMocks.join).toHaveBeenCalledWith('second');
  });

  it('preload loads once without joining', async () => {
    const load = vi.fn<LoadTransport>(() => import('./p2pTransport'));
    const session = new PeerSession(bootstrap, callbacks(), load);
    await session.preload();
    await session.preload();
    expect(load).toHaveBeenCalledTimes(1);
    expect(transportMocks.join).not.toHaveBeenCalled();
  });

  it('sendMessage, sendBinary and getPeerCount forward once loaded', async () => {
    const session = new PeerSession(bootstrap, callbacks());
    await session.preload();
    session.sendMessage({ kind: 'ping' }, 'peer-1');
    expect(transportMocks.send).toHaveBeenCalledWith({ kind: 'ping' }, 'peer-1');
    session.sendMessage({ kind: 'broadcast' });
    expect(transportMocks.send).toHaveBeenLastCalledWith({ kind: 'broadcast' }, undefined);
    const data = new Uint8Array([1]);
    session.sendBinary(data, 'peer-1', { hash: 'h' });
    expect(transportMocks.sendBinary).toHaveBeenCalledWith(data, 'peer-1', { hash: 'h' });
    expect(session.getPeerCount()).toBe(3);
  });

  it('close disconnects a loaded transport', async () => {
    const session = new PeerSession(bootstrap, callbacks());
    session.joinRoom('room');
    await settle();
    session.close();
    expect(transportMocks.disconnect).toHaveBeenCalled();
  });

  it('close while loading drops the join and reports Not sharing', async () => {
    const cb = callbacks();
    const session = new PeerSession(bootstrap, cb);
    session.joinRoom('room');
    session.close();
    expect(cb.onPeerCount).toHaveBeenCalledWith(0);
    expect(cb.onState).toHaveBeenLastCalledWith('Not sharing');
    await settle();
    expect(transportMocks.join).not.toHaveBeenCalled();
  });

  it('reports a failed load, goes to Reconnecting, and fetches again on the next join', async () => {
    const cb = callbacks();
    const error = new TypeError('Failed to fetch dynamically imported module: p2pTransport.js');
    const load = vi.fn<LoadTransport>().mockRejectedValueOnce(error).mockImplementation(() => import('./p2pTransport'));
    const session = new PeerSession(bootstrap, cb, load);
    session.joinRoom('room');
    await settle();
    expect(cb.onLoadError).toHaveBeenCalledWith(error);
    expect(cb.onState).toHaveBeenLastCalledWith('Reconnecting');
    expect(transportMocks.join).not.toHaveBeenCalled();

    session.joinRoom('room');
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(transportMocks.join).toHaveBeenCalledWith('room');
  });

  it('preload swallows a failed load', async () => {
    const load = vi.fn<LoadTransport>().mockRejectedValue(new Error('offline'));
    const session = new PeerSession(bootstrap, callbacks(), load);
    await expect(session.preload()).resolves.toBeUndefined();
  });
});
