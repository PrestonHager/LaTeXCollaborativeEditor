import * as Y from 'yjs';
import { YjsDocSync } from './yjsSync';

const typeInto = (doc: Y.Doc, text: string, origin: unknown = 'local') => {
  const yText = doc.getText('doc');
  doc.transact(() => {
    yText.delete(0, yText.length);
    yText.insert(0, text);
  }, origin);
};

describe('YjsDocSync', () => {
  it('converges a local change on a remote peer through a snapshot', () => {
    const onRemoteChange = vi.fn();
    const local = new YjsDocSync({ onLocalUpdate: vi.fn() });
    const remote = new YjsDocSync({ onLocalUpdate: vi.fn(), onRemoteChange });

    typeInto(local.getDoc(), 'hello world');
    remote.applySnapshot(local.getSnapshot());

    expect(remote.getDoc().getText('doc').toString()).toBe('hello world');
    expect(onRemoteChange).toHaveBeenCalled();
  });

  it('applies duplicate updates idempotently', () => {
    const outbound: Uint8Array[] = [];
    const local = new YjsDocSync({ onLocalUpdate: (update) => outbound.push(update) });
    const remote = new YjsDocSync({ onLocalUpdate: vi.fn() });

    typeInto(local.getDoc(), 'abc');
    remote.applyRemoteUpdate(outbound[0]);
    remote.applyRemoteUpdate(outbound[0]);

    expect(remote.getDoc().getText('doc').toString()).toBe('abc');
  });

  it('forwards onLocalUpdate for non-string origins (y-codemirror uses YSyncConfig)', () => {
    const onLocalUpdate = vi.fn();
    const sync = new YjsDocSync({ onLocalUpdate });
    typeInto(sync.getDoc(), 'ab', { tag: 'YSyncConfig' });
    expect(onLocalUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not forward onLocalUpdate when merging remote updates', () => {
    const onLocalUpdate = vi.fn();
    const sync = new YjsDocSync({ onLocalUpdate });
    const foreign = new Y.Doc();
    typeInto(foreign, 'hello world');
    sync.applyRemoteUpdate(Y.encodeStateAsUpdate(foreign));
    expect(onLocalUpdate).not.toHaveBeenCalled();
  });

  it('resumes from saved state without sending it again', () => {
    const saved = new Y.Doc();
    typeInto(saved, 'resumed');
    const onLocalUpdate = vi.fn();
    const sync = new YjsDocSync({ initialState: Y.encodeStateAsUpdate(saved), onLocalUpdate });
    expect(sync.getDoc().getText('doc').toString()).toBe('resumed');
    expect(sync.hasState()).toBe(true);
    expect(onLocalUpdate).not.toHaveBeenCalled();
  });

  it('starts over from an unrelated snapshot and keeps sending local edits', () => {
    const onLocalUpdate = vi.fn();
    const sync = new YjsDocSync({ onLocalUpdate });
    typeInto(sync.getDoc(), 'old');
    const other = new Y.Doc();
    typeInto(other, 'new');
    sync.resetFromSnapshot(Y.encodeStateAsUpdate(other));
    expect(sync.getDoc().getText('doc').toString()).toBe('new');
    onLocalUpdate.mockClear();
    typeInto(sync.getDoc(), 'newer');
    expect(onLocalUpdate).toHaveBeenCalledTimes(1);
  });
});
