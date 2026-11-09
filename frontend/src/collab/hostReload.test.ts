import { SessionController, type PersistedDocState } from './session';

type PeerCallbacks = {
  onState: (state: string) => void;
  onPeerJoin: (peerId: string) => void;
  onPeerLeave?: (peerId: string) => void;
  onMessage: (payload: unknown, peerId?: string) => void;
};

// A tiny in-memory room, so two real SessionControllers can talk to each other.
const network = vi.hoisted(() => {
  const peers = new Map<string, { callbacks: PeerCallbacks }>();
  let nextId = 0;
  return {
    peers,
    newId: () => `peer-${(nextId += 1)}`,
    reset: () => {
      peers.clear();
      nextId = 0;
    },
  };
});

vi.mock('../net/peerSession', () => ({
  PeerSession: class {
    readonly id = network.newId();
    private readonly callbacks: PeerCallbacks;
    constructor(_bootstrap: unknown, callbacks: PeerCallbacks) {
      this.callbacks = callbacks;
    }
    joinRoom() {
      // Tell everyone already in the room about the new peer, and the new peer about them.
      const others = [...network.peers.entries()];
      network.peers.set(this.id, { callbacks: this.callbacks });
      for (const [otherId, other] of others) {
        other.callbacks.onPeerJoin(this.id);
        this.callbacks.onPeerJoin(otherId);
      }
      this.callbacks.onState('Connected');
    }
    sendMessage(payload: unknown, peerId?: string) {
      // Round trip through JSON like the real data channel does.
      const copy = JSON.parse(JSON.stringify(payload));
      for (const [otherId, other] of network.peers) {
        if (otherId === this.id) continue;
        if (peerId && otherId !== peerId) continue;
        other.callbacks.onMessage(copy, this.id);
      }
    }
    close() {
      network.peers.delete(this.id);
      for (const other of network.peers.values()) other.callbacks.onPeerLeave?.(this.id);
    }
  },
}));

vi.mock('../net/bootstrapConfig', () => ({
  getBootstrapConfig: () => ({ appId: 'app', environment: 'localhost', rendezvous: [], iceServers: [] }),
}));

const createPeer = (isHost: boolean, text: string, initialState?: PersistedDocState) => {
  const onDocReplaced = vi.fn();
  const controller = new SessionController({
    isHost,
    onConnectionState: vi.fn(),
    onRemoteText: vi.fn(),
    getLocalText: () => text,
    initialState,
    onDocReplaced,
  });
  return { controller, onDocReplaced };
};

const textOf = (controller: SessionController) => controller.getYText().toString();

const hasPending = (controller: SessionController) => {
  const store = controller.getDoc().store;
  return store.pendingStructs !== null || store.pendingDs !== null;
};

// Leaving the room is what a reload looks like to everyone else.
const reload = (controller: SessionController) => {
  (controller as unknown as { session: { close(): void } }).session.close();
};

describe('host reload with a guest still connected', () => {
  beforeEach(() => {
    network.reset();
  });

  it('resumes the same doc from persisted state and keeps syncing both ways', () => {
    const host = createPeer(true, 'hello').controller;
    host.join('room');
    const guest = createPeer(false, '');
    guest.controller.join('room');
    expect(textOf(guest.controller)).toBe('hello');

    guest.controller.applyLocalText('hello guest');
    expect(textOf(host)).toBe('hello guest');

    // Now the host reloads from what it saved, and the guest types while it's gone.
    const saved = host.getPersistedState();
    expect(saved).not.toBeNull();
    reload(host);
    guest.controller.applyLocalText('hello guest, again');

    const reloaded = createPeer(true, 'hello guest', saved!).controller;
    reloaded.join('room');

    // The guest kept its doc and sent back the edit the host missed.
    expect(guest.onDocReplaced).not.toHaveBeenCalled();
    expect(textOf(reloaded)).toBe('hello guest, again');

    guest.controller.applyLocalText('hello guest, again!');
    reloaded.applyLocalText('Hi! hello guest, again!');
    expect(textOf(reloaded)).toBe('Hi! hello guest, again!');
    expect(textOf(guest.controller)).toBe('Hi! hello guest, again!');
    expect(hasPending(reloaded)).toBe(false);
    expect(hasPending(guest.controller)).toBe(false);
  });

  it('starts the guest over when the host comes back with a new doc', () => {
    const host = createPeer(true, 'old').controller;
    host.join('room');
    const guest = createPeer(false, '');
    guest.controller.join('room');
    guest.controller.applyLocalText('old text');
    reload(host);

    // No persisted state, so the host builds an unrelated doc.
    const reloaded = createPeer(true, 'fresh').controller;
    reloaded.join('room');

    expect(guest.onDocReplaced).toHaveBeenCalledWith('fresh');
    expect(textOf(guest.controller)).toBe('fresh');

    guest.controller.applyLocalText('fresh from guest');
    expect(textOf(reloaded)).toBe('fresh from guest');
    expect(hasPending(reloaded)).toBe(false);
  });

  it('ignores snapshots from peers that are not the host', () => {
    const host = createPeer(true, 'real').controller;
    host.join('room');
    const guest = createPeer(false, '');
    guest.controller.join('room');
    expect(textOf(guest.controller)).toBe('real');

    // A second "host" in the same room tries to push its own doc.
    const impostor = createPeer(true, 'fake').controller;
    impostor.join('room');

    expect(textOf(guest.controller)).toBe('real');
    expect(guest.onDocReplaced).not.toHaveBeenCalled();
  });
});
