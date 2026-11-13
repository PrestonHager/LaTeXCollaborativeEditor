import 'fake-indexeddb/auto';
import { SessionController, comparePeerBuild } from './session';
import { PROTOCOL_VERSION } from './messages';
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
      onPeerCount: (count: number) => void;
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
        onPeerCount: (count: number) => void;
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
    callbacks?.onMessage({ kind: 'snapshot', state: hostSource.snapshot() }, 'host');
    callbacks?.onMessage(
      {
        kind: 'y-update',
        update: hostSource.apply('hello!'),
      },
      'host',
    );

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
    callbacks?.onMessage({ kind: 'snapshot', state: hostSource.snapshot() }, 'host');

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
    // Metadata only counts once we know who the host is, from its snapshot.
    callbacks?.onMessage({ kind: 'snapshot', state: createSource('').snapshot() }, 'host');
    callbacks?.onMessage(
      {
        kind: 'metadata',
        metadata: { title: 'Shared Doc', storage: 'Saved on host local storage' },
      },
      'host',
    );

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

  it('passes the state and peer count to the connection badge', () => {
    const onConnectionState = vi.fn();
    new SessionController({ isHost: true, blobs: new BlobStore(), onConnectionState });
    expect(onConnectionState).toHaveBeenLastCalledWith('Not sharing', 0);
    callbacks?.onState('Waiting for peers');
    expect(onConnectionState).toHaveBeenLastCalledWith('Waiting for peers', 0);
    callbacks?.onPeerCount(2);
    callbacks?.onState('Relayed');
    expect(onConnectionState).toHaveBeenLastCalledWith('Relayed', 2);
  });

  describe('drops bad peer messages', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => {
      warn.mockRestore();
    });

    const guest = () => {
      const onRemoteText = vi.fn();
      const onRemoteMetadata = vi.fn();
      const controller = new SessionController({
        isHost: false,
        onConnectionState: vi.fn(),
        blobs: new BlobStore(),
        onRemoteChange: () => onRemoteText(controller.getDoc().getText('doc').toString()),
        onRemoteMetadata,
      });
      controller.join('abc');
      return { controller, onRemoteText, onRemoteMetadata };
    };

    it('drops malformed messages with a dev warning', () => {
      const { onRemoteText } = guest();
      callbacks?.onMessage(null, 'peer-1');
      callbacks?.onMessage({ kind: 'y-update', update: 'not bytes' }, 'peer-1');
      callbacks?.onMessage({ kind: 'y-update', update: [999] }, 'peer-1');
      callbacks?.onMessage({ kind: 'mystery' }, 'peer-1');

      expect(onRemoteText).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(4);
      expect(warn).toHaveBeenCalledWith('Dropped peer message: malformed or too big', null);
    });

    it('drops updates and snapshots that are not real Yjs updates', () => {
      const { onRemoteText } = guest();
      callbacks?.onMessage({ kind: 'y-update', update: [255, 255, 255, 255, 255] }, 'peer-1');
      callbacks?.onMessage({ kind: 'snapshot', state: [255, 255, 255, 255, 255] }, 'host');

      expect(onRemoteText).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith('Dropped peer message: update is not a Yjs update', 'peer-1');
      expect(warn).toHaveBeenCalledWith('Dropped peer message: snapshot is not a Yjs update', 'host');
    });

    it('drops snapshots with no peer id', () => {
      const { onRemoteText } = guest();
      const source = createSource('');
      source.apply('sneaky');
      callbacks?.onMessage({ kind: 'snapshot', state: source.snapshot() });

      expect(onRemoteText).not.toHaveBeenCalled();
    });

    it('drops snapshots from a peer other than the host', () => {
      const { onRemoteText } = guest();
      const host = createSource('');
      host.apply('from host');
      callbacks?.onMessage({ kind: 'snapshot', state: host.snapshot() }, 'host');
      const other = createSource('');
      other.apply('from someone else');
      callbacks?.onMessage({ kind: 'snapshot', state: other.snapshot() }, 'peer-evil');

      expect(onRemoteText).toHaveBeenLastCalledWith('from host');
      expect(warn).toHaveBeenCalledWith('Dropped peer message: snapshot from a peer that is not the host', 'peer-evil');
    });

    it('drops metadata before the host is known, and from anyone but the host', () => {
      const { onRemoteMetadata } = guest();
      const metadata = { title: 'Fake', storage: 'Fake' };
      callbacks?.onMessage({ kind: 'metadata', metadata }, 'peer-evil');
      callbacks?.onMessage({ kind: 'snapshot', state: createSource('').snapshot() }, 'host');
      callbacks?.onMessage({ kind: 'metadata', metadata }, 'peer-evil');
      callbacks?.onMessage({ kind: 'metadata', metadata });

      expect(onRemoteMetadata).not.toHaveBeenCalled();
      callbacks?.onMessage({ kind: 'metadata', metadata: { title: 'Real', storage: 'Host' } }, 'host');
      expect(onRemoteMetadata).toHaveBeenCalledWith({ title: 'Real', storage: 'Host' });
    });

    it('drops metadata with an overly long title', () => {
      const { onRemoteMetadata } = guest();
      callbacks?.onMessage({ kind: 'snapshot', state: createSource('').snapshot() }, 'host');
      callbacks?.onMessage({ kind: 'metadata', metadata: { title: 'x'.repeat(10_000), storage: 'Host' } }, 'host');

      expect(onRemoteMetadata).not.toHaveBeenCalled();
    });

    it('host drops snapshots and metadata from guests', () => {
      const onRemoteText = vi.fn();
      const onRemoteMetadata = vi.fn();
      const controller = new SessionController({
        isHost: true,
        onConnectionState: vi.fn(),
        blobs: new BlobStore(),
        onRemoteChange: () => onRemoteText(controller.getDoc().getText('doc').toString()),
        onRemoteMetadata,
      });
      controller.join('abc');
      const source = createSource('');
      source.apply('takeover');
      callbacks?.onMessage({ kind: 'snapshot', state: source.snapshot() }, 'peer-1');
      callbacks?.onMessage({ kind: 'metadata', metadata: { title: 'x', storage: 'y' } }, 'peer-1');

      expect(onRemoteText).not.toHaveBeenCalled();
      expect(onRemoteMetadata).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith('Dropped peer message: metadata from a peer that is not the host', 'peer-1');
    });

    it('drops file requests with a bad hash and bad file chunks', async () => {
      const blobs = new BlobStore();
      const controller = new SessionController({ isHost: true, blobs, onConnectionState: vi.fn() });
      controller.join('abc');
      callbacks?.onMessage({ kind: 'file-request', hash: '../secret' }, 'peer-1');
      callbacks?.onMessage({ kind: 'file-request', hash: { toString: () => 'x' } }, 'peer-1');

      const hash = await blobs.put(new Uint8Array([9]));
      const guestBlobs = new BlobStore();
      const guestSession = new SessionController({ isHost: false, blobs: guestBlobs, onConnectionState: vi.fn() });
      guestSession.transfer.request('abc123');
      // Too big for one chunk, and a total that doesn't fit the size.
      callbacks?.onBinary?.(new ArrayBuffer(512 * 1024), 'peer-1', { hash: 'abc123', index: 0, total: 1, size: 512 * 1024 });
      callbacks?.onBinary?.(new Uint8Array([1]).buffer, 'peer-1', { hash: 'abc123', index: 0, total: 50, size: 1 });

      expect(sendBinary).not.toHaveBeenCalled();
      expect(guestSession.transfer.isTransferring('abc123')).toBe(true);
      expect(guestBlobs.has(hash)).toBe(false);
      expect(warn).toHaveBeenCalledWith('Dropped peer message: bad file chunk', expect.anything());
    });
  });

  describe('hello handshake (app version)', () => {
    const build = { version: '0.1.0', commit: 'abc1234' };

    it('sends a hello with its version to each peer that joins, host or guest', () => {
      for (const isHost of [true, false]) {
        sendMessage.mockClear();
        const controller = new SessionController({ isHost, onConnectionState: vi.fn(), blobs: new BlobStore(), build });
        if (isHost) controller.ensureRoom();
        else controller.join('room');
        callbacks?.onPeerJoin('peer-1');
        expect(sendMessage).toHaveBeenCalledWith({ kind: 'hello', protocol: PROTOCOL_VERSION, appVersion: '0.1.0', commit: 'abc1234' }, 'peer-1');
      }
    });

    it('records a matching peer quietly', () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      const onPeerVersion = vi.fn();
      const controller = new SessionController({ isHost: true, onConnectionState: vi.fn(), blobs: new BlobStore(), build, onPeerVersion });
      callbacks?.onMessage({ kind: 'hello', protocol: PROTOCOL_VERSION, appVersion: '0.1.0', commit: 'abc1234' }, 'peer-1');
      const expected = { peerId: 'peer-1', protocol: PROTOCOL_VERSION, appVersion: '0.1.0', commit: 'abc1234', compatibility: 'same-build' };
      expect(onPeerVersion).toHaveBeenCalledWith(expected);
      expect(controller.getPeerVersions()).toEqual([expected]);
      expect(info).not.toHaveBeenCalled();
      info.mockRestore();
    });

    it('logs a different build or protocol but keeps syncing', () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onPeerVersion = vi.fn();
      const controller = new SessionController({ isHost: true, onConnectionState: vi.fn(), blobs: new BlobStore(), build, onPeerVersion });
      controller.ensureRoom();
      callbacks?.onMessage({ kind: 'hello', protocol: PROTOCOL_VERSION, appVersion: '0.2.0', commit: 'def5678' }, 'peer-1');
      expect(info).toHaveBeenCalledWith(expect.stringContaining('0.2.0+def5678'));
      callbacks?.onMessage({ kind: 'hello', protocol: PROTOCOL_VERSION + 1, appVersion: '1.0.0' }, 'peer-2');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Reload to update'));
      expect(controller.getPeerVersions().map((peer) => peer.compatibility)).toEqual(['different-build', 'incompatible-protocol']);

      // Not blocked: the incompatible peer still gets a snapshot when it asks.
      sendMessage.mockClear();
      callbacks?.onMessage({ kind: 'sync-request' }, 'peer-2');
      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'snapshot' }), 'peer-2');

      callbacks?.onPeerLeave?.('peer-2');
      expect(controller.getPeerVersions().map((peer) => peer.peerId)).toEqual(['peer-1']);
      info.mockRestore();
      warn.mockRestore();
    });

    it('ignores a hello with no peer id', () => {
      const onPeerVersion = vi.fn();
      const controller = new SessionController({ isHost: true, onConnectionState: vi.fn(), blobs: new BlobStore(), build, onPeerVersion });
      callbacks?.onMessage({ kind: 'hello', protocol: PROTOCOL_VERSION, appVersion: '0.1.0' });
      expect(onPeerVersion).not.toHaveBeenCalled();
      expect(controller.getPeerVersions()).toEqual([]);
    });

    it('still syncs with an old host that never sends a hello', () => {
      const source = createSource('from an old host');
      const onPeerVersion = vi.fn();
      const controller = new SessionController({ isHost: false, onConnectionState: vi.fn(), blobs: new BlobStore(), build, onPeerVersion });
      controller.join('room');
      callbacks?.onPeerJoin('old-host');
      // An old host answers with a snapshot and drops our hello as an unknown kind.
      callbacks?.onMessage({ kind: 'snapshot', state: source.snapshot(), docId: 'doc-1' }, 'old-host');
      expect(controller.getDoc().getText('doc').toString()).toBe('from an old host');
      expect(onPeerVersion).not.toHaveBeenCalled();
      expect(controller.getPeerVersions()).toEqual([]);
    });

    it('defaults to the bundled build info', () => {
      sendMessage.mockClear();
      new SessionController({ isHost: true, onConnectionState: vi.fn(), blobs: new BlobStore() });
      callbacks?.onPeerJoin('peer-1');
      // Tests run without the Vite define, so the bundled build is "dev".
      expect(sendMessage).toHaveBeenCalledWith({ kind: 'hello', protocol: PROTOCOL_VERSION, appVersion: 'dev', commit: 'dev' }, 'peer-1');
    });
  });
});

describe('comparePeerBuild', () => {
  const local = { version: '0.1.0', commit: 'abc1234' };

  it('sorts peers into same build, different build and incompatible protocol', () => {
    expect(comparePeerBuild({ protocol: PROTOCOL_VERSION, appVersion: '0.1.0', commit: 'abc1234' }, local)).toBe('same-build');
    expect(comparePeerBuild({ protocol: PROTOCOL_VERSION, appVersion: '0.1.0' }, local)).toBe('same-build');
    expect(comparePeerBuild({ protocol: PROTOCOL_VERSION, appVersion: '0.1.0', commit: 'dev' }, local)).toBe('same-build');
    expect(comparePeerBuild({ protocol: PROTOCOL_VERSION, appVersion: '0.1.0', commit: 'def5678' }, { version: '0.1.0', commit: 'dev' })).toBe('same-build');
    expect(comparePeerBuild({ protocol: PROTOCOL_VERSION, appVersion: '0.1.0', commit: 'def5678' }, local)).toBe('different-build');
    expect(comparePeerBuild({ protocol: PROTOCOL_VERSION, appVersion: '0.2.0', commit: 'abc1234' }, local)).toBe('different-build');
    expect(comparePeerBuild({ protocol: PROTOCOL_VERSION + 1, appVersion: '0.1.0', commit: 'abc1234' }, local)).toBe('incompatible-protocol');
    expect(comparePeerBuild({ protocol: PROTOCOL_VERSION, appVersion: '0.1.0' }, local, PROTOCOL_VERSION + 1)).toBe('incompatible-protocol');
  });
});
