import * as Y from 'yjs';

type YjsSyncConfig = {
  initialText: string;
  initialState?: Uint8Array;
  onRemoteText: (text: string) => void;
  onLocalUpdate: (update: Uint8Array) => void;
};

export class YjsTextSync {
  private doc = new Y.Doc();
  private yText = this.doc.getText('doc');
  private readonly config: YjsSyncConfig;

  constructor(config: YjsSyncConfig) {
    this.config = config;
    // Resume the saved doc first, so a reloaded host keeps the history its guests already have.
    if (config.initialState) {
      Y.applyUpdate(this.doc, config.initialState, 'init');
    }
    if (config.initialText && this.yText.toString() !== config.initialText) {
      this.doc.transact(() => {
        this.yText.delete(0, this.yText.length);
        this.yText.insert(0, config.initialText);
      }, 'init');
    }
    this.listen();
  }

  private listen() {
    // y-codemirror.next uses the YSyncConfig instance as transaction origin (see y-sync.js transact(..., this.conf)).
    // Only skip updates that came from the network or snapshot application so we do not echo them.
    this.doc.on('update', (update, origin) => {
      if (origin === 'remote' || origin === 'snapshot' || origin === 'init') {
        return;
      }
      this.config.onLocalUpdate(update);
    });

    this.yText.observe((event) => {
      if (event.transaction.origin !== 'remote' && event.transaction.origin !== 'snapshot') return;
      this.config.onRemoteText(this.yText.toString());
    });
  }

  applyLocalText(nextText: string) {
    const current = this.yText.toString();
    if (current === nextText) return;
    this.doc.transact(() => {
      this.yText.delete(0, this.yText.length);
      this.yText.insert(0, nextText);
    }, 'local');
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
  // Deleting our text in place doesn't work, since later updates would point at items the sender never had.
  resetFromSnapshot(update: Uint8Array) {
    this.doc.destroy();
    this.doc = new Y.Doc();
    this.yText = this.doc.getText('doc');
    this.listen();
    Y.applyUpdate(this.doc, update, 'snapshot');
  }

  hasState() {
    return this.doc.store.clients.size > 0;
  }

  getSnapshot() {
    return Y.encodeStateAsUpdate(this.doc);
  }

  getYText() {
    return this.yText;
  }

  getDoc() {
    return this.doc;
  }
}
