// The row of avatars next to Share (issue #22). One for you, then one per peer. Clicking a peer
// follows them: their file opens and the editor scrolls to their cursor. Clicking yours changes
// your name. Loads with sharing, like collab/presence.ts.
import { initials, type PresencePeer } from '../collab/presence';

/** Peers shown as avatars. The rest go in a "+N" chip, so the header doesn't wrap. */
export const MAX_AVATARS = 4;

type PresenceBarOptions = {
  onFollow: (peer: PresencePeer) => void;
  onEditName: () => void;
  /** The path of a file id, or null when it isn't in the project (or nothing is open). */
  filePath: (fileId: string | null) => string | null;
};

export type PresenceSelf = { name: string; color: string };

function avatar(label: string, color: string, text: string, tooltip: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'presence-avatar';
  button.style.setProperty('--peer-color', color);
  button.textContent = text;
  button.setAttribute('aria-label', label);
  button.dataset.tooltip = tooltip;
  button.dataset.side = 'bottom';
  return button;
}

export function createPresenceBar(root: HTMLElement, options: PresenceBarOptions) {
  const where = (peer: PresencePeer) => {
    const path = options.filePath(peer.file);
    return path ? `in ${path}` : 'no file open';
  };

  function render(self: PresenceSelf | null, peers: PresencePeer[]) {
    root.hidden = !self;
    if (!self) {
      root.replaceChildren();
      return;
    }
    // The row redraws when anyone moves files, so put keyboard focus back where it was.
    const focused = root.contains(document.activeElement) ? ((document.activeElement as HTMLElement).dataset.peer ?? 'self') : null;
    const mine = avatar(`You, ${self.name}. Change your name`, self.color, initials(self.name), `You (${self.name}) · click to rename`);
    mine.classList.add('is-self');
    mine.dataset.peer = 'self';
    mine.addEventListener('click', () => options.onEditName());
    const items: HTMLElement[] = [mine];
    for (const peer of peers.slice(0, MAX_AVATARS)) {
      const button = avatar(`Follow ${peer.name}, ${where(peer)}`, peer.color, initials(peer.name), `${peer.name} · ${where(peer)}`);
      button.dataset.peer = peer.peerId;
      button.addEventListener('click', () => options.onFollow(peer));
      items.push(button);
    }
    const hidden = peers.slice(MAX_AVATARS);
    if (hidden.length) {
      const more = document.createElement('span');
      more.className = 'presence-more';
      more.textContent = `+${hidden.length}`;
      more.setAttribute('role', 'img');
      const names = hidden.map((peer) => peer.name).join(', ');
      more.setAttribute('aria-label', `${hidden.length} more: ${names}`);
      more.dataset.tooltip = names;
      more.dataset.side = 'bottom';
      items.push(more);
    }
    root.replaceChildren(...items);
    if (focused) root.querySelector<HTMLElement>(`[data-peer="${CSS.escape(focused)}"]`)?.focus();
  }

  return { render };
}
