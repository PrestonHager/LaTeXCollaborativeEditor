import { keepOnScreen } from './keepOnScreen';

/** The parts of the Share popover in index.html. */
export type ShareElements = {
  /** Wraps the button and the popover, so clicks and focus inside it don't close it. */
  root: HTMLElement;
  button: HTMLButtonElement;
  popover: HTMLElement;
  title: HTMLElement;
  /** What sharing does, with Start sharing (and Resume sharing after a reload). */
  startView: HTMLElement;
  startButton: HTMLButtonElement;
  resumeButton: HTMLButtonElement;
  /** The link, Copy, New link and Stop sharing. */
  activeView: HTMLElement;
  linkEl: HTMLAnchorElement;
  copyButton: HTMLButtonElement;
  newLinkButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
};

type ShareConfig = ShareElements & {
  getCurrentUrl: () => string;
  copyText?: (value: string) => Promise<void>;
  /** Called with a short message after a copy works or fails, or a room can't start. */
  onStatus?: (message: string) => void;
  /**
   * A guest is already in the room from its `?room=` link, so the popover only shows that link.
   * Guests never start, swap or stop a room here.
   */
  guestRoomId?: string | null;
  /**
   * Create a room and join it, or with `resumeId`, rejoin that one. This is the only way the host
   * gets into a room (issue #224), and it only runs from Start sharing or Resume sharing.
   */
  startRoom?: (resumeId?: string) => string;
  /** The room this tab shared before a reload. It's offered as Resume sharing, never rejoined on its own. */
  resumeRoomId?: string | null;
  /** Drop the current room and make a fresh one. */
  newRoom?: () => string;
  /** Leave the room and forget it. */
  stopSharing?: () => void;
  /** Ask before dropping the old link. Resolve false to keep it. */
  confirmNewLink?: () => boolean | Promise<boolean>;
  /** Ask before stopping, like when people are connected. Resolve false to keep sharing. */
  confirmStop?: () => boolean | Promise<boolean>;
  /**
   * Set when this window can't share (no WebRTC, issue #205). Share calls it instead of opening
   * the popover, so no room is asked for and the P2P code never starts.
   */
  unavailable?: () => void;
};

export type ShareControls = ReturnType<typeof setupShareButton>;

/**
 * The Share button and its popover. Sharing is off until the host picks Start sharing (issue #224):
 * opening the popover, a reload and hovering Share never join a room.
 */
export function setupShareButton(config: ShareConfig) {
  const copy =
    config.copyText ??
    (async (value: string) => {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(value);
    });
  const isGuest = Boolean(config.guestRoomId);
  let roomId: string | null = config.guestRoomId ?? null;
  let resumeId: string | null = isGuest ? null : (config.resumeRoomId ?? null);
  let open = false;

  const linkFor = (id: string) => {
    const url = new URL(config.getCurrentUrl());
    url.searchParams.set('room', id);
    return url.toString();
  };

  const render = () => {
    const sharing = Boolean(roomId);
    config.title.textContent = isGuest ? 'Invite others' : sharing ? 'Sharing is on' : 'Share this project';
    config.startView.hidden = sharing;
    config.activeView.hidden = !sharing;
    config.resumeButton.hidden = !resumeId;
    // Guests can pass the link on, but only the host can swap or end the room.
    config.newLinkButton.hidden = isGuest;
    config.stopButton.hidden = isGuest;
    config.button.dataset.sharing = String(sharing);
    if (roomId) {
      const value = linkFor(roomId);
      config.linkEl.href = value;
      config.linkEl.textContent = value;
    } else {
      config.linkEl.removeAttribute('href');
      config.linkEl.textContent = '';
    }
  };

  const setOpen = (next: boolean, { restoreFocus = false } = {}) => {
    open = next;
    config.button.setAttribute('aria-expanded', String(next));
    config.popover.setAttribute('aria-hidden', String(!next));
    // Hidden content shouldn't be reachable with Tab while the popover is closed.
    config.popover.inert = !next;
    // On a phone Share sits beside the Menu button, too far right for the popover to open under it (#186).
    if (next) keepOnScreen(config.popover);
    if (next) (roomId ? config.copyButton : config.startButton).focus();
    else if (restoreFocus) config.button.focus();
  };

  const copyLink = () => {
    if (!roomId) return;
    void copy(linkFor(roomId)).then(
      () => config.onStatus?.('Share link copied to clipboard'),
      // Clipboard needs HTTPS and page focus, so fall back to the visible link.
      () => config.onStatus?.('Could not copy automatically. Copy the link shown under Share.'),
    );
  };

  /** Join a room through `getRoomId`, then show and copy its link. */
  const enterRoom = (getRoomId: () => string) => {
    try {
      roomId = getRoomId();
    } catch (error) {
      console.error('Could not start a share session', error);
      config.onStatus?.('Could not start a share session. Reload the page and try again.');
      return;
    }
    resumeId = null;
    render();
    config.copyButton.focus();
    copyLink();
  };

  const openPopover = () => {
    if (config.unavailable) {
      config.unavailable();
      return;
    }
    setOpen(true);
  };

  render();
  setOpen(false);

  config.button.addEventListener('click', () => (open ? setOpen(false) : openPopover()));
  config.copyButton.addEventListener('click', copyLink);

  const { startRoom, newRoom, stopSharing } = config;
  if (startRoom) {
    config.startButton.addEventListener('click', () => enterRoom(() => startRoom()));
    config.resumeButton.addEventListener('click', () => {
      const id = resumeId;
      if (id) enterRoom(() => startRoom(id));
    });
  }
  if (newRoom) {
    config.newLinkButton.addEventListener('click', async () => {
      if (config.confirmNewLink && !(await config.confirmNewLink())) return;
      enterRoom(newRoom);
    });
  }
  if (stopSharing) {
    config.stopButton.addEventListener('click', async () => {
      if (!roomId) return;
      if (config.confirmStop && !(await config.confirmStop())) return;
      stopSharing();
      roomId = null;
      resumeId = null;
      render();
      config.onStatus?.('Stopped sharing. The old link no longer works.');
      if (open) config.startButton.focus();
    });
  }

  config.root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false, { restoreFocus: true });
  });
  // Close on a click anywhere else in the app. A confirm dialog is outside too, but by then the
  // choice is made, and the popover shows the new state when it opens again.
  document.addEventListener('pointerdown', (event) => {
    if (open && !config.root.contains(event.target as Node | null)) setOpen(false);
  });

  return {
    open: openPopover,
    close: () => setOpen(false),
    /** Copy the link while sharing, or open the popover to start (the palette's "Copy share link"). */
    copyOrOpen() {
      if (roomId && !config.unavailable) copyLink();
      else openPopover();
    },
    get isOpen() {
      return open;
    },
    get roomId() {
      return roomId;
    },
  };
}
