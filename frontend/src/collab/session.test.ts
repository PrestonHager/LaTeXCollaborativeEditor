import 'fake-indexeddb/auto';
import { SessionController } from './session';
import * as Y from 'yjs';
import { BlobStore } from '../project/blobStore';

/** Replace the old single-document text, the way typing would. */
const setText = (doc: Y.Doc, text: string) => {
  const yText = doc.getText('doc');
  doc.transact(() => {
    yText.delete(0, yText.length);
    yText.insert(0, text);
  }, 'local');
};

const joinRoom = vi.fn();
const sendMessage = vi.fn();
const close = vi.fn();
const sendBinary = vi.fn();
let callbacks:
  | {
      onState: (s: string) => void;
      onPeerJoin: (peerId: string) => void;
      onMessage: (payload: unknown, peerId?: string) => void;
      onPeerLeave?: (peerId: string) => void;
      onBinary?: (data: ArrayBuffer, peerId: string, metadata: unknown) => void;
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
        onPeerLeave?: (peerId: string) => void;
        onBinary?: (data: ArrayBuffer, peerId: string, metadata: unknown) => void;
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
    sendBinary(data: Uint8Array, peerId: string, metadata: unknown) {
      sendBinary(data, peerId, metadata);
    }
    close() {
      close();
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

  /** Make the update that turns one text into another, from a fresh doc. */
  const createUpdate = (from: string, to: string): number[] => {
    const doc = new Y.Doc();
    if (from) doc.getText('doc').insert(0, from);
    let update: Uint8Array | null = null;
    doc.on('update', (next: Uint8Array) => {
      update = next;
    });
    setText(doc, to);
    return Array.from(update ?? new Uint8Array());
  };

  /** A stand-in host doc that hands out snapshots and updates. */
  const createSource = (initialText: string) => {
    const doc = new Y.Doc();
    if (initialText) doc.getText('doc').insert(0, initialText);
    const updates: Uint8Array[] = [];
    doc.on('update', (update: Uint8Array) => updates.push(update));
    return {
      apply(text: string) {
        setText(doc, text);
        return Array.from(updates.at(-1) ?? new Uint8Array());
      },
      snapshot() {
        return Array.from(Y.encodeStateAsUpdate(doc));
      },
    };
  };

  it('creates and joins rooms via peer session', () => {
    const controller = new SessionController({
      isHost: true,
      onConnectionState: vi.fn(),
      blobs: new BlobStore(),
    });
    const room = controller.ensureRoom();
    controller.join('abc');
    setText(controller.getDoc(), 'baseX');
    callbacks?.onPeerJoin('peer-7');

    expect(room).toBeTruthy();
    expect(joinRoom).toHaveBeenCalled();
    // A second Share click returns the same room without joining again.
    const callsBefore = joinRoom.mock.calls.length;
    expect(controller.ensureRoom()).toBe('abc');
    expect(joinRoom.mock.calls.length).toBe(callsBefore);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'y-update' }),
      undefined,
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'snapshot' }),
      'peer-7',
    );
  });

  it('rejoins a saved host room so ensureRoom keeps the same id', () => {
    const controller = new SessionController({
      isHost: true,
      onConnectionState: vi.fn(),
      blobs: new BlobStore(),
    });
    expect(controller.getRoomId()).toBeNull();
    controller.join('saved-room');
    expect(controller.ensureRoom()).toBe('saved-room');
    expect(joinRoom).toHaveBeenCalledTimes(1);
  });

  it('newRoom leaves the old room and joins a fresh one', () => {
    vi.useFakeTimers();
    const controller = new SessionController({
      isHost: true,
      onConnectionState: vi.fn(),
      blobs: new BlobStore(),
    });
    controller.join('old-room');
    callbacks?.onState('Reconnecting');
    const next = controller.newRoom();

    expect(close).toHaveBeenCalledTimes(1);
    expect(next).not.toBe('old-room');
    expect(controller.getRoomId()).toBe(next);
    expect(joinRoom).toHaveBeenLastCalledWith(next);
    // The pending reconnect for the old room is dropped.
    vi.advanceTimersByTime(30_000);
    expect(joinRoom.mock.calls.filter(([id]) => id === 'old-room')).toHaveLength(1);
    vi.useRealTimers();
  });

  it('newRoom without a current room just creates one', () => {
    const controller = new SessionController({
      isHost: true,
      onConnectionState: vi.fn(),
      blobs: new BlobStore(),
    });
    const room = controller.newRoom();
    expect(close).not.toHaveBeenCalled();
    expect(joinRoom).toHaveBeenCalledWith(room);
  });

  it('retries joining after reconnect/failure states', () => {
    vi.useFakeTimers();
    const controller = new SessionController({
      isHost: true,
      onConnectionState: vi.fn(),
      blobs: new BlobStore(),
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
      blobs: new BlobStore(),
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
      blobs: new BlobStore(),
      onRemoteChange: () => onRemoteText(controller.getDoc().getText('doc').toString()),
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
      blobs: new BlobStore(),
      onRemoteChange: () => onRemoteText(controller.getDoc().getText('doc').toString()),
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
      blobs: new BlobStore(),
      onRemoteChange: () => onRemoteText(controller.getDoc().getText('doc').toString()),
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
      blobs: new BlobStore(),
    });
    controller.join('abc');
    sendMessage.mockClear();

    setText(controller.getDoc(), 'client-typed-before-sync');

    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'y-update' }),
      undefined,
    );
  });

  it('host responds to sync-request with snapshot and metadata', () => {
    const controller = new SessionController({
      isHost: true,
      onConnectionState: vi.fn(),
      blobs: new BlobStore(),
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
      blobs: new BlobStore(),
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
      blobs: new BlobStore(),
    });
    controller.join('abc');
    setText(controller.getDoc(), 'latest-local-doc');
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
      blobs: new BlobStore(),
      onRemoteChange: () => onRemoteText(controller.getDoc().getText('doc').toString()),
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
      blobs: new BlobStore(),
      onRemoteMetadata,
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
  it('sends files peers ask for, and takes in chunks of files it asked for', async () => {
    const blobs = new BlobStore();
    const progress = vi.fn();
    const controller = new SessionController({ isHost: true, blobs, onConnectionState: vi.fn(), onFileProgress: progress });
    controller.join('abc');
    const hash = await blobs.put(new Uint8Array([1, 2, 3]));
    callbacks?.onMessage({ kind: 'file-request', hash }, 'peer-1');
    await vi.waitFor(() => expect(sendBinary).toHaveBeenCalledWith(expect.any(Uint8Array), 'peer-1', { hash, index: 0, total: 1, size: 3 }));

    // Now the other way: ask for a file and get it back in one chunk.
    const other = new BlobStore();
    const guest = new SessionController({ isHost: false, blobs: other, onConnectionState: vi.fn(), onFileProgress: progress });
    guest.transfer.request(hash);
    expect(sendMessage).toHaveBeenCalledWith({ kind: 'file-request', hash }, undefined);
    callbacks?.onBinary?.(new Uint8Array([1, 2, 3]).buffer, 'peer-1', { hash: 'bad' });
    callbacks?.onBinary?.(new Uint8Array([1, 2, 3]).buffer, 'peer-1', { hash, index: 0, total: 1, size: 3 });
    await vi.waitFor(() => expect(other.has(hash)).toBe(true));
    expect(progress).toHaveBeenCalledWith(hash, null);
    callbacks?.onPeerJoin('peer-2');
    callbacks?.onPeerLeave?.('peer-2');
  });
});
