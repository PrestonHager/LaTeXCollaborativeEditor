// Ties presence (issue #22) to the page. The awareness lives here so the editor can bind to it, but
// the sync, the checks and the avatar row load with sharing (collab/presenceRuntime.ts).
import { PresenceAwareness } from '../collab/awareness';
import type { PresencePeer, PresenceSync } from '../collab/presence';
import type { SettingsStore } from '../state/settings';
import { whenOnline } from './lazy';

type Runtime = typeof import('../collab/presenceRuntime');

export type PresenceFlowOptions = {
  settings: Pick<SettingsStore, 'get' | 'set' | 'subscribe'>;
  /** The avatar row next to Share. */
  root: HTMLElement;
  send: (message: unknown, peerId?: string) => void;
  /** Our peer id, so our colour matches what everyone else works out for us. */
  selfId: () => Promise<string>;
  /** Whether the shared doc has a root type by this name (see PresenceSync). */
  hasType: (name: string) => boolean;
  filePath: (fileId: string | null) => string | null;
  onFollow: (peer: PresencePeer) => void;
  onEditName: () => void;
  /** Someone joined, left, switched files or renamed. The file tree redraws its dots. */
  onPeersChange: () => void;
  onLoadError?: (error: unknown) => void;
  load?: () => Promise<Runtime>;
};

export type FileViewer = { name: string; color: string };

export function createPresenceFlow(options: PresenceFlowOptions) {
  const awareness = new PresenceAwareness({ name: '', color: '', colorLight: '' });
  const load = options.load ?? (() => whenOnline(() => import('../collab/presenceRuntime')));
  let sync: PresenceSync | null = null;
  let bar: ReturnType<Runtime['createPresenceBar']> | null = null;
  let starting: Promise<void> | null = null;
  let runtime: Runtime | null = null;

  /** The saved name, or a new anonymous one (saved too, so peers see the same one next time). */
  const savedName = (loaded: Runtime) => {
    const name = options.settings.get('displayName');
    if (name) return name;
    const picked = loaded.anonymousName();
    options.settings.set('displayName', picked);
    return picked;
  };

  const self = () => {
    const user = awareness.getLocalState()?.user;
    return user?.color ? { name: user.name, color: user.color } : null;
  };
  const render = () => bar?.render(sync ? self() : null, sync?.list() ?? []);

  const setName = (name: string) => {
    const state = awareness.getLocalState();
    if (state && state.user.name !== name) awareness.setLocalStateField('user', { ...state.user, name });
    render();
  };

  options.settings.subscribe((changed) => {
    // Resetting settings clears the name, so pick a new anonymous one rather than send an empty one.
    if (changed.includes('displayName') && sync && runtime) setName(savedName(runtime));
  });

  /** Start sharing presence. Safe to call again; a failed load is retried on the next call. */
  function start(): Promise<void> {
    starting ??= Promise.all([load(), options.selfId()]).then(
      ([loaded, selfId]) => {
        runtime = loaded;
        const name = savedName(loaded);
        const color = loaded.colorForPeer(selfId);
        const state = awareness.getLocalState();
        awareness.setLocalState({ user: { name, color, colorLight: loaded.lightColor(color) }, file: state?.file ?? null, cursor: null });
        bar = loaded.createPresenceBar(options.root, { onFollow: options.onFollow, onEditName: options.onEditName, filePath: options.filePath });
        sync = new loaded.PresenceSync({
          awareness,
          send: options.send,
          hasType: options.hasType,
          onPeersChange: () => {
            render();
            options.onPeersChange();
          },
        });
        sync.start();
        render();
        options.onPeersChange();
      },
      (error: unknown) => {
        starting = null;
        options.onLoadError?.(error);
      },
    );
    return starting;
  }

  return {
    start,
    /** The awareness for the editor's remote cursors, or null until presence has started. */
    awareness: () => (sync ? awareness : null),
    /** Which file we have open. Clears our cursor, since it pointed into the old file. */
    setFile(fileId: string | null) {
      const state = awareness.getLocalState();
      if (state && state.file !== fileId) awareness.setLocalState({ ...state, file: fileId, cursor: null });
    },
    receive: (payload: unknown, peerId: string) => sync?.receive(payload, peerId),
    peerJoined: (peerId: string) => sync?.peerJoined(peerId),
    peerLeft: (peerId: string) => sync?.peerLeft(peerId),
    /** Tell peers we're leaving, like when the page closes. start() picks it up again. */
    stop() {
      sync?.stop();
      sync = null;
      starting = null;
      render();
    },
    /** The latest state of a peer, for follow. Null once it's gone. */
    peer: (peerId: string) => sync?.list().find((peer) => peer.peerId === peerId) ?? null,
    /** Who has each file open, by file id, for the dots in the file tree. */
    viewers(): Map<string, FileViewer[]> {
      const byFile = new Map<string, FileViewer[]>();
      for (const peer of sync?.list() ?? []) {
        if (!peer.file) continue;
        const list = byFile.get(peer.file) ?? [];
        list.push({ name: peer.name, color: peer.color });
        byFile.set(peer.file, list);
      }
      return byFile;
    },
    /** Our display name, or the saved one before presence starts. */
    name: () => self()?.name ?? options.settings.get('displayName'),
    /** Redraw the avatars, like after a rename changed a path in a tooltip. */
    refresh: render,
  };
}

export type PresenceFlow = ReturnType<typeof createPresenceFlow>;
