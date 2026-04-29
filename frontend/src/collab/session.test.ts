import { SessionController } from './session';

const joinRoom = vi.fn();
const sendMessage = vi.fn();
let callbacks:
  | {
      onState: (s: string) => void;
      onPeerJoin: (peerId: string) => void;
      onMessage: (payload: unknown) => void;
    }
  | undefined;

vi.mock('../net/peerSession', () => ({
  PeerSession: class {
    constructor(
      _bootstrap: unknown,
      cb: { onState: (s: string) => void; onPeerJoin: (peerId: string) => void; onMessage: (payload: unknown) => void },
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
  it('creates and joins rooms via peer session', () => {
    const controller = new SessionController({
      onConnectionState: vi.fn(),
      onRemoteText: vi.fn(),
      getLocalText: () => 'base',
    });
    const room = controller.ensureRoom();
    controller.join('abc');
    controller.broadcastText('baseX');
    callbacks?.onPeerJoin('peer-7');

    expect(room).toBeTruthy();
    expect(joinRoom).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'delta', seq: 1 }),
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

  it('applies remote snapshot and delta messages', () => {
    const onRemoteText = vi.fn();
    const controller = new SessionController({
      onConnectionState: vi.fn(),
      onRemoteText,
      getLocalText: () => '',
    });
    controller.join('abc');
    callbacks?.onMessage({ kind: 'snapshot', seq: 2, text: 'hello' });
    callbacks?.onMessage({
      kind: 'delta',
      seq: 3,
      delta: { index: 5, deleteCount: 0, insert: '!' },
    });

    expect(onRemoteText).toHaveBeenCalledWith('hello');
    expect(onRemoteText).toHaveBeenCalledWith('hello!');
  });

  it('sends latest local snapshot to newly joined peer', () => {
    const controller = new SessionController({
      onConnectionState: vi.fn(),
      onRemoteText: vi.fn(),
      getLocalText: () => '',
    });
    controller.join('abc');
    controller.updateLocalText('latest-local-doc');
    callbacks?.onPeerJoin('peer-late');

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'snapshot', text: 'latest-local-doc' }),
      'peer-late',
    );
  });

  it('does not overwrite non-empty host content from same-seq incoming snapshot', () => {
    const onRemoteText = vi.fn();
    const controller = new SessionController({
      onConnectionState: vi.fn(),
      onRemoteText,
      getLocalText: () => 'host-doc',
    });
    controller.join('abc');
    callbacks?.onMessage({ kind: 'snapshot', seq: 0, text: '' });

    expect(onRemoteText).not.toHaveBeenCalled();
  });
});
