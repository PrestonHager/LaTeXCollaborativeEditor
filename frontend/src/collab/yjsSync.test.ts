import * as Y from 'yjs';
import { YjsTextSync } from './yjsSync';

describe('YjsTextSync', () => {
  it('converges local update on remote peer', () => {
    const remoteTexts: string[] = [];

    const local = new YjsTextSync({
      initialText: 'hello',
      onRemoteText: vi.fn(),
      onLocalUpdate: vi.fn(),
    });
    const remote = new YjsTextSync({
      initialText: '',
      onRemoteText: (text) => remoteTexts.push(text),
      onLocalUpdate: vi.fn(),
    });

    local.applyLocalText('hello world');
    remote.applySnapshot(local.getSnapshot());

    expect(remoteTexts).toContain('hello world');
  });

  it('applies duplicate updates idempotently', () => {
    const outbound: Uint8Array[] = [];
    const remoteTexts: string[] = [];

    const local = new YjsTextSync({
      initialText: '',
      onRemoteText: vi.fn(),
      onLocalUpdate: (update) => outbound.push(update),
    });
    const remote = new YjsTextSync({
      initialText: '',
      onRemoteText: (text) => remoteTexts.push(text),
      onLocalUpdate: vi.fn(),
    });

    local.applyLocalText('abc');
    remote.applyRemoteUpdate(outbound[0]);
    remote.applyRemoteUpdate(outbound[0]);

    expect(remoteTexts.at(-1)).toBe('abc');
  });

  it('forwards onLocalUpdate for non-string origins (y-codemirror uses YSyncConfig)', () => {
    const onLocalUpdate = vi.fn();
    const sync = new YjsTextSync({
      initialText: 'a',
      onRemoteText: vi.fn(),
      onLocalUpdate,
    });
    const ytext = sync.getYText();
    const doc = sync.getDoc();
    const cmLikeOrigin = { tag: 'YSyncConfig' };
    doc.transact(() => {
      ytext.insert(1, 'b');
    }, cmLikeOrigin);
    expect(onLocalUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not forward onLocalUpdate when merging remote updates', () => {
    const onLocalUpdate = vi.fn();
    const sync = new YjsTextSync({
      initialText: 'hello',
      onRemoteText: vi.fn(),
      onLocalUpdate,
    });
    const foreign = new Y.Doc();
    const ft = foreign.getText('doc');
    foreign.transact(() => ft.insert(0, 'hello world'));
    const update = Y.encodeStateAsUpdate(foreign);
    onLocalUpdate.mockClear();
    sync.applyRemoteUpdate(update);
    expect(onLocalUpdate).not.toHaveBeenCalled();
  });
});
