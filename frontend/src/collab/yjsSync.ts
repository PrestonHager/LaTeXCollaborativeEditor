import * as Y from 'yjs';

type YjsSyncConfig = {
  initialText: string;
  onRemoteText: (text: string) => void;
  onLocalUpdate: (update: Uint8Array) => void;
};

export class YjsTextSync {
  private readonly doc = new Y.Doc();
  private readonly yText = this.doc.getText('doc');
  private readonly config: YjsSyncConfig;

  constructor(config: YjsSyncConfig) {
    this.config = config;
    if (config.initialText) {
      this.doc.transact(() => {
        this.yText.insert(0, config.initialText);
      }, 'init');
    }

    this.doc.on('update', (update, origin) => {
      if (origin === 'local') {
        this.config.onLocalUpdate(update);
      }
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

  applySnapshot(update: Uint8Array) {
    if (this.yText.length > 0) {
      this.doc.transact(() => {
        this.yText.delete(0, this.yText.length);
      }, 'snapshot-reset');
    }
    Y.applyUpdate(this.doc, update, 'snapshot');
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
