import { SessionController } from './session';
import { YjsTextSync } from './yjsSync';

const joinRoom = vi.fn();
const sendMessage = vi.fn();
let callbacks:
  | {
      onState: (s: string) => void;
      onPeerJoin: (peerId: string) => void;
      onMessage: (payload: unknown, peerId?: string) => void;
    }
  | undefined;

vi.mock('../net/peerSession', () => ({
  PeerSession: class {
    constructor(
      _bootstrap: unknown,
      cb: {
        onState: (s: string) => void;
        onPeerJoin: (peerId: string) => void;
        onMessage: (payload: unknown, peerId?: string) => void;
      },
    ) {
      callbacks = cb;
    }
    joinRoom(id: string) {
      joinRoom(id);
    }
    sendMessage(payload: unknown, peerId?: string) {
      sendMessage(payload, peerId);
    }
  },
}));

vi.mock('../net/bootstrapConfig', () => ({
  getBootstrapConfig: () => ({
    appId: 'app',
    environment: 'localhost',
    rendezvous: ['wss://tracker'],
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  }),
}));

describe('SessionController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createUpdate = (from: string, to: string): number[] => {
    let update: Uint8Array | null = null;
    const sync = new YjsTextSync({
      initialText: from,
      onRemoteText: vi.fn(),
      onLocalUpdate: (next) => {
        update = next;
      },
    });
    sync.applyLocalText(to);
    return Array.from(update ?? new Uint8Array());
  };

  const createSource = (initialText: string) => {
    const updates: Uint8Array[] = [];
    const sync = new YjsTextSync({
      initialText,
      onRemoteText: vi.fn(),
      onLocalUpdate: (update) => updates.push(update),
    });
    return {
      apply(text: string) {
        sync.applyLocalText(text);
        return Array.from(updates.at(-1) ?? new Uint8Array());
      },
      snapshot() {
        return Array.from(sync.getSnapshot());
      },
    };
  };

  it('creates and joins rooms via peer session', () => {
    const controller = new SessionController({
      isHost: true,
      onConnectionState: vi.fn(),
      onRemoteText: vi.fn(),
      getLocalText: () => 'base',
    });
    const room = controller.ensureRoom();
    controller.join('abc');
    controller.applyLocalText('baseX');
    callbacks?.onPeerJoin('peer-7');

    expect(room).toBeTruthy();
    expect(joinRoom).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'y-update' }),
      undefined,
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'snapshot' }),
      'peer-7',
    );
  });

  it('retries joining after reconnect/failure states', () => {
    vi.useFakeTimers();
    const controller = new SessionController({
      isHost: true,
      onConnectionState: vi.fn(),
      onRemoteText: vi.fn(),
      getLocalText: () => 'base',
    });
    controller.join('abc');
    callbacks?.onState('Reconnecting');
    vi.advanceTimersByTime(1000);
    expect(joinRoom).toHaveBeenCalledWith('abc');
    vi.useRealTimers();
  });

  it('client requests initial snapshot once connected', () => {
    vi.useFakeTimers();
    const controller = new SessionController({
      isHost: false,
      onConnectionState: vi.fn(),
      onRemoteText: vi.fn(),
      getLocalText: () => 'client-template',
    });
    controller.join('abc');
    callbacks?.onState('Connected');

    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'sync-request' }),
      undefined,
    );
    vi.advanceTimersByTime(300);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'sync-request' }),
      undefined,
    );
    vi.advanceTimersByTime(1000);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'sync-request' }),
      undefined,
    );
    vi.useRealTimers();
  });

  it('applies remote snapshot and delta messages', () => {
    const onRemoteText = vi.fn();
    const controller = new SessionController({
      isHost: false,
      onConnectionState: vi.fn(),
      onRemoteText,
      getLocalText: () => '',
    });
    controller.join('abc');
    const hostSource = createSource('');
    hostSource.apply('hello');
    callbacks?.onMessage({ kind: 'snapshot', state: hostSource.snapshot() });
    callbacks?.onMessage({
      kind: 'y-update',
      update: hostSource.apply('hello!'),
    });

    expect(onRemoteText).toHaveBeenCalledWith('hello');
    expect(onRemoteText).toHaveBeenCalledWith('hello!');
  });

  it('applies updates from different peers and converges', () => {
    const onRemoteText = vi.fn();
    const controller = new SessionController({
      isHost: false,
      onConnectionState: vi.fn(),
      onRemoteText,
      getLocalText: () => '',
    });
    controller.join('abc');
    const updateA = createUpdate('', 'A');
    const updateB = createUpdate('', 'B');

    callbacks?.onMessage(
      { kind: 'y-update', update: updateA },
      'peer-a',
    );
    callbacks?.onMessage(
      { kind: 'y-update', update: updateB },
      'peer-b',
    );

    expect(onRemoteText).toHaveBeenCalled();
    expect(['AB', 'BA']).toContain(onRemoteText.mock.calls.at(-1)?.[0]);
  });

  it('applies initial snapshot for clients with default local content', () => {
    const onRemoteText = vi.fn();
    const controller = new SessionController({
      isHost: false,
      onConnectionState: vi.fn(),
      onRemoteText,
      getLocalText: () => 'client-default-template',
    });
    controller.join('abc');
    const hostSource = createSource('');
    hostSource.apply('host-current-doc');
    callbacks?.onMessage({ kind: 'snapshot', state: hostSource.snapshot() });

    expect(onRemoteText).toHaveBeenCalledWith('host-current-doc');
  });

  it('does not send y-update from client before initial snapshot arrives', () => {
    const controller = new SessionController({
      isHost: false,
      onConnectionState: vi.fn(),
      onRemoteText: vi.fn(),
      getLocalText: () => 'client-template',
    });
    controller.join('abc');
    sendMessage.mockClear();

    controller.applyLocalText('client-typed-before-sync');

    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'y-update' }),
      undefined,
    );
  });

  it('host responds to sync-request with snapshot and metadata', () => {
    const controller = new SessionController({
      isHost: true,
      onConnectionState: vi.fn(),
      onRemoteText: vi.fn(),
      getLocalText: () => 'host-doc',
      getLocalMetadata: () => ({ title: 'Host Doc', storage: 'Saved on host local storage' }),
    });
    controller.join('abc');
    callbacks?.onMessage({ kind: 'sync-request' }, 'peer-new');

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'snapshot',
        state: expect.any(Array),
        metadata: { title: 'Host Doc', storage: 'Saved on host local storage' },
      }),
      'peer-new',
    );
  });

  it('host broadcasts snapshot when sync-request has no peer id', () => {
    const controller = new SessionController({
      isHost: true,
      onConnectionState: vi.fn(),
      onRemoteText: vi.fn(),
      getLocalText: () => 'host-doc',
      getLocalMetadata: () => ({ title: 'Host Doc', storage: 'Saved on host local storage' }),
    });
    controller.join('abc');
    callbacks?.onMessage({ kind: 'sync-request' });

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'snapshot',
        state: expect.any(Array),
      }),
      undefined,
    );
  });

  it('sends latest local snapshot to newly joined peer', () => {
    const controller = new SessionController({
      isHost: true,
      onConnectionState: vi.fn(),
      onRemoteText: vi.fn(),
      getLocalText: () => '',
    });
    controller.join('abc');
    controller.applyLocalText('latest-local-doc');
    callbacks?.onPeerJoin('peer-late');

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'snapshot', state: expect.any(Array) }),
      'peer-late',
    );
  });

  it('does not apply incoming snapshot when in host mode', () => {
    const onRemoteText = vi.fn();
    const controller = new SessionController({
      isHost: true,
      onConnectionState: vi.fn(),
      onRemoteText,
      getLocalText: () => 'host-doc',
    });
    controller.join('abc');
    callbacks?.onMessage({ kind: 'snapshot', state: [] });

    expect(onRemoteText).not.toHaveBeenCalled();
  });

  it('applies incoming metadata on clients', () => {
    const onRemoteMetadata = vi.fn();
    const controller = new SessionController({
      isHost: false,
      onConnectionState: vi.fn(),
      onRemoteText: vi.fn(),
      onRemoteMetadata,
      getLocalText: () => '',
    });
    controller.join('abc');
    callbacks?.onMessage({
      kind: 'metadata',
      metadata: { title: 'Shared Doc', storage: 'Saved on host local storage' },
    });

    expect(onRemoteMetadata).toHaveBeenCalledWith({
      title: 'Shared Doc',
      storage: 'Saved on host local storage',
    });
  });
});
