import * as Y from 'yjs';

type YjsSyncConfig = {
  initialState?: Uint8Array;
  /** Runs after a change from a peer or a snapshot lands in the doc. */
  onRemoteChange?: () => void;
  onLocalUpdate: (update: Uint8Array) => void;
};

/**
 * Check that bytes from a peer decode as a Yjs update before we apply them.
 * Applying garbage throws partway through, which could leave the doc half changed.
 */
export function isWellFormedUpdate(update: Uint8Array): boolean {
  try {
    Y.decodeUpdate(update);
    return true;
  } catch {
    return false;
  }
}

/** Keeps one Yjs doc (the whole project) and tells us which updates to send to peers. */
export class YjsDocSync {
  private doc = new Y.Doc();
  private readonly config: YjsSyncConfig;

  constructor(config: YjsSyncConfig) {
    this.config = config;
    // Resume the saved doc first, so a reloaded host keeps the history its guests already have.
    if (config.initialState) {
      Y.applyUpdate(this.doc, config.initialState, 'init');
    }
    this.listen();
  }

  private listen() {
    // y-codemirror.next uses its YSyncConfig instance as the transaction origin, and file ops use
    // their own, so only skip updates that came from the network or a snapshot to avoid echoing them.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote' || origin === 'snapshot') {
        this.config.onRemoteChange?.();
        return;
      }
      if (origin === 'init') return;
      this.config.onLocalUpdate(update);
    });
  }

  applyRemoteUpdate(update: Uint8Array) {
    Y.applyUpdate(this.doc, update, 'remote');
  }

  // Merge a snapshot of the same doc, and return what we have that the sender is missing.
  applySnapshot(update: Uint8Array) {
    Y.applyUpdate(this.doc, update, 'snapshot');
    return Y.encodeStateAsUpdate(this.doc, Y.encodeStateVectorFromUpdate(update));
  }

  // Throw away our doc and start over from a snapshot of a different doc.
  // Deleting our content in place doesn't work, since later updates would point at items the sender never had.
  resetFromSnapshot(update: Uint8Array) {
    this.doc.destroy();
    this.doc = new Y.Doc();
    this.listen();
    Y.applyUpdate(this.doc, update, 'snapshot');
  }

  hasState() {
    return this.doc.store.clients.size > 0;
  }

  getSnapshot() {
    return Y.encodeStateAsUpdate(this.doc);
  }

  getDoc() {
    return this.doc;
  }
}
