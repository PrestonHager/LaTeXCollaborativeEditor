import { createPresenceBar, MAX_AVATARS } from './presenceBar';
import type { PresencePeer } from '../collab/presence';

const peer = (n: number, file: string | null = 'f1'): PresencePeer => ({ peerId: `peer-${n}`, clientId: n, name: `Peer Number${n}`, color: '#2563eb', file, cursor: null });

function setup() {
  const root = document.createElement('div');
  root.hidden = true;
  document.body.replaceChildren(root);
  const options = { onFollow: vi.fn(), onEditName: vi.fn(), filePath: vi.fn((id: string | null) => (id === 'f1' ? 'chapters/intro.tex' : null)) };
  const bar = createPresenceBar(root, options);
  const avatars = () => Array.from(root.querySelectorAll<HTMLButtonElement>('.presence-avatar'));
  return { root, options, bar, avatars };
}

describe('presence bar', () => {
  it('shows you first, then each peer with initials, colour and where they are', () => {
    const t = setup();
    t.bar.render({ name: 'Curious Otter', color: '#dc2626' }, [peer(1), peer(2, null)]);
    expect(t.root.hidden).toBe(false);
    const [me, first, second] = t.avatars();
    expect(me.textContent).toBe('CO');
    expect(me.classList.contains('is-self')).toBe(true);
    expect(me.style.getPropertyValue('--peer-color')).toBe('#dc2626');
    expect(me.getAttribute('aria-label')).toBe('You, Curious Otter. Change your name');
    expect(first.textContent).toBe('PN');
    expect(first.dataset.tooltip).toBe('Peer Number1 · in chapters/intro.tex');
    expect(first.getAttribute('aria-label')).toBe('Follow Peer Number1, in chapters/intro.tex');
    expect(second.dataset.tooltip).toBe('Peer Number2 · no file open');
  });

  it('follows a peer on click, and edits your name from your own avatar', () => {
    const t = setup();
    t.bar.render({ name: 'Me', color: '#dc2626' }, [peer(1)]);
    t.avatars()[1].click();
    expect(t.options.onFollow).toHaveBeenCalledWith(expect.objectContaining({ peerId: 'peer-1' }));
    t.avatars()[0].click();
    expect(t.options.onEditName).toHaveBeenCalledTimes(1);
  });

  it('folds peers past the limit into a +N chip that names them', () => {
    const t = setup();
    const peers = Array.from({ length: MAX_AVATARS + 2 }, (_, i) => peer(i + 1));
    t.bar.render({ name: 'Me', color: '#dc2626' }, peers);
    expect(t.avatars()).toHaveLength(MAX_AVATARS + 1);
    const more = t.root.querySelector<HTMLElement>('.presence-more')!;
    expect(more.textContent).toBe('+2');
    expect(more.getAttribute('aria-label')).toBe(`2 more: Peer Number${MAX_AVATARS + 1}, Peer Number${MAX_AVATARS + 2}`);
  });

  it('keeps keyboard focus on the same avatar when it redraws', () => {
    const t = setup();
    t.bar.render({ name: 'Me', color: '#dc2626' }, [peer(1), peer(2)]);
    t.avatars()[2].focus();
    t.bar.render({ name: 'Me', color: '#dc2626' }, [peer(1), peer(2, null)]);
    expect(document.activeElement).toBe(t.avatars()[2]);
    t.avatars()[0].focus();
    t.bar.render({ name: 'Me', color: '#dc2626' }, [peer(2)]);
    expect(document.activeElement).toBe(t.avatars()[0]);
  });

  it('hides when presence is off', () => {
    const t = setup();
    t.bar.render({ name: 'Me', color: '#dc2626' }, []);
    t.bar.render(null, []);
    expect(t.root.hidden).toBe(true);
    expect(t.root.children).toHaveLength(0);
  });
});
