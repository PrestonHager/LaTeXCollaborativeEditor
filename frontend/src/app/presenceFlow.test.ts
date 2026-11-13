import { createSettingsStore } from '../state/settings';
import { createPresenceFlow, type PresenceFlowOptions } from './presenceFlow';
import { colorForPeer, PRESENCE_COLORS, type AwarenessMessage } from '../collab/presence';

const FILE = 'file-1';

function setup(overrides: Partial<PresenceFlowOptions> = {}) {
  const settings = createSettingsStore({ storage: null, target: null });
  const root = document.createElement('div');
  root.hidden = true;
  document.body.replaceChildren(root);
  const send = vi.fn<(message: AwarenessMessage, peerId?: string) => void>();
  const options = {
    settings,
    root,
    send: send as PresenceFlowOptions['send'],
    selfId: () => Promise.resolve('self-peer'),
    hasType: () => true,
    filePath: (id: string | null) => (id === FILE ? 'main.tex' : null),
    onFollow: vi.fn(),
    onEditName: vi.fn(),
    onPeersChange: vi.fn(),
    onLoadError: vi.fn(),
    ...overrides,
  };
  const flow = createPresenceFlow(options);
  return { flow, settings, root, send, options };
}

const peerState = (name: string, clock = 1, file: string | null = FILE) => ({ kind: 'awareness', clock, state: { name, color: PRESENCE_COLORS[2], file, cursor: null } });

describe('presence flow', () => {
  it('has no awareness for the editor until it starts', async () => {
    const { flow, send, root } = setup();
    expect(flow.awareness()).toBeNull();
    // Nothing is listening yet, so these do nothing.
    flow.receive(peerState('Ada'), 'peer-1');
    flow.peerJoined('peer-1');
    flow.peerLeft('peer-1');
    flow.stop();
    expect(flow.viewers().size).toBe(0);
    expect(flow.peer('peer-1')).toBeNull();
    await flow.start();
    expect(flow.awareness()).not.toBeNull();
    expect(root.hidden).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('picks and keeps an anonymous name, and uses the colour peers work out from our id', async () => {
    const { flow, settings, send } = setup();
    expect(flow.name()).toBe('');
    await flow.start();
    const name = settings.get('displayName');
    expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(flow.name()).toBe(name);
    // A random presence id is saved, and our colour comes from it.
    const id = settings.get('presenceId');
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(send.mock.calls[0][0].state).toMatchObject({ name, color: colorForPeer(id), id });
    // Starting again is the same start.
    await flow.start();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps the saved presence id across starts, so our colour survives a reload', async () => {
    const { flow, settings, send } = setup();
    settings.set('presenceId', '0123456789abcdef');
    await flow.start();
    expect(send.mock.lastCall?.[0].state).toMatchObject({ id: '0123456789abcdef', color: colorForPeer('0123456789abcdef') });
    flow.stop();
    await flow.start();
    expect(send.mock.lastCall?.[0].state?.id).toBe('0123456789abcdef');
    expect(settings.get('presenceId')).toBe('0123456789abcdef');
  });

  it('uses the saved name, and follows changes to it', async () => {
    vi.useFakeTimers();
    try {
      const { flow, settings, send, root } = setup();
      settings.set('displayName', 'Ada');
      await flow.start();
      expect(send.mock.lastCall?.[0].state?.name).toBe('Ada');
      settings.set('displayName', 'Ada L');
      vi.advanceTimersByTime(200);
      expect(send.mock.lastCall?.[0].state?.name).toBe('Ada L');
      expect(root.querySelector('.presence-avatar')?.textContent).toBe('AL');
      // A reset clears it, so a new anonymous name is picked instead of sending an empty one.
      settings.reset();
      vi.advanceTimersByTime(200);
      expect(send.mock.lastCall?.[0].state?.name).toBeTruthy();
      expect(settings.get('displayName')).toBe(send.mock.lastCall?.[0].state?.name);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks peers for the avatars, the file tree and follow', async () => {
    const { flow, root, options } = setup();
    flow.setFile(FILE);
    await flow.start();
    flow.peerJoined('peer-1');
    flow.receive(peerState('Ada Lovelace'), 'peer-1');
    flow.receive(peerState('Grace Hopper', 1, null), 'peer-2');
    expect(options.onPeersChange).toHaveBeenCalled();
    expect(flow.viewers()).toEqual(new Map([[FILE, [{ name: 'Ada Lovelace', color: PRESENCE_COLORS[2] }]]]));
    expect(flow.peer('peer-1')?.name).toBe('Ada Lovelace');
    expect(root.querySelectorAll('.presence-avatar')).toHaveLength(3);
    root.querySelectorAll<HTMLButtonElement>('.presence-avatar')[1].click();
    expect(options.onFollow).toHaveBeenCalledWith(expect.objectContaining({ peerId: 'peer-1' }));
    flow.peerLeft('peer-1');
    expect(flow.peer('peer-1')).toBeNull();
  });

  it('setFile clears our cursor, and stop says goodbye and can start again', async () => {
    const { flow, send, root } = setup();
    await flow.start();
    const awareness = flow.awareness()!;
    awareness.setLocalStateField('cursor', { anchor: {} as never, head: {} as never });
    flow.setFile('other');
    expect(awareness.getLocalState()).toMatchObject({ file: 'other', cursor: null });
    flow.stop();
    expect(send.mock.lastCall?.[0]).toMatchObject({ state: null });
    expect(flow.awareness()).toBeNull();
    expect(root.hidden).toBe(true);
    await flow.start();
    expect(flow.awareness()).not.toBeNull();
  });

  it('reports a failed load and tries again on the next start', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(() => import('../collab/presenceRuntime'));
    const { flow, options } = setup({ load });
    await flow.start();
    expect(options.onLoadError).toHaveBeenCalledTimes(1);
    expect(flow.awareness()).toBeNull();
    await flow.start();
    expect(flow.awareness()).not.toBeNull();
  });
});
