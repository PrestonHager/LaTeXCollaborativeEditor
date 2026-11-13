// Runs P2pTransport against a real trystero room object, not a hand-written mock, so a change
// in the shape of trystero's room API (like makeAction going from a tuple to an object in 0.25)
// fails here instead of only in a browser. The strategy adapter is a no-op, so nothing touches
// the network and no peers ever join.
import { P2pTransport } from './p2pTransport';
import type { BootstrapConfig } from './bootstrapConfig';

vi.mock('@trystero-p2p/torrent', async () => {
  const { createStrategy } = await import('@trystero-p2p/core');
  return {
    joinRoom: createStrategy<null>({
      init: () => null,
      subscribe: () => () => {},
      announce: () => ({ stopAnnouncing: true }),
    }),
  };
});

const bootstrap: BootstrapConfig = {
  appId: 'trystero-shape-test',
  environment: 'localhost',
  rendezvous: ['wss://tracker.invalid'],
  iceServers: [],
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('P2pTransport with a real trystero room', () => {
  it('joins, sends with nobody there, and leaves without throwing', async () => {
    const onState = vi.fn();
    const onPeerCount = vi.fn();
    const transport = new P2pTransport(bootstrap, { onMessage: vi.fn(), onState, onPeerCount, onPeerJoin: vi.fn() });

    expect(() => transport.join('shape-room')).not.toThrow();
    expect(onState).toHaveBeenLastCalledWith('Waiting for peers');

    // Broadcasts, targeted sends and binary sends all go through the real action objects.
    expect(() => transport.send({ kind: 'sync-request' })).not.toThrow();
    expect(() => transport.send({ kind: 'sync-request' }, 'nobody')).not.toThrow();
    expect(() => transport.sendBinary(new Uint8Array([1, 2, 3]), 'nobody', { hash: 'h', index: 0 })).not.toThrow();
    // Let any rejected send promises settle; they must be caught, not left unhandled.
    await settle();

    expect(() => transport.disconnect()).not.toThrow();
    expect(onState).toHaveBeenLastCalledWith('Not sharing');
    expect(onPeerCount).toHaveBeenLastCalledWith(0);
    await settle();
  });
});
