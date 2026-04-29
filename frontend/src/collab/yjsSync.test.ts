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
});
