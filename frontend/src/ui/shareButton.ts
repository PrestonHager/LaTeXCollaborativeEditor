type ShareButtonConfig = {
  button: HTMLButtonElement;
  linkEl: HTMLAnchorElement;
  getRoomId: () => string;
  getCurrentUrl: () => string;
  copyText?: (value: string) => Promise<void>;
  /** Called with a short message after the copy works or fails. */
  onStatus?: (message: string) => void;
  /** Room already in use when the page loads, so the link shows without clicking Share. */
  initialRoomId?: string | null;
  /** Optional button that drops the current room and makes a fresh link. */
  newLinkButton?: HTMLButtonElement;
  getNewRoomId?: () => string;
  /** Ask before dropping the old link. Resolve false to keep it. */
  confirmNewLink?: () => boolean | Promise<boolean>;
};

export function setupShareButton(config: ShareButtonConfig) {
  const copy =
    config.copyText ??
    (async (value: string) => {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(value);
    });

  const showLink = (roomId: string) => {
    const shareUrl = new URL(config.getCurrentUrl());
    shareUrl.searchParams.set('room', roomId);
    const value = shareUrl.toString();
    config.linkEl.href = value;
    config.linkEl.textContent = value;
    if (config.newLinkButton) config.newLinkButton.hidden = false;
    return value;
  };

  const copyLink = (value: string) => {
    void copy(value).then(
      () => config.onStatus?.('Share link copied to clipboard'),
      // Clipboard needs HTTPS and page focus, so fall back to the visible link.
      () => config.onStatus?.('Could not copy automatically. Copy the link shown next to Share.'),
    );
  };

  const shareWith = (getRoomId: () => string) => {
    let roomId: string;
    try {
      roomId = getRoomId();
    } catch (error) {
      console.error('Could not start a share session', error);
      config.onStatus?.('Could not start a share session. Reload the page and try again.');
      return;
    }
    copyLink(showLink(roomId));
  };

  if (config.newLinkButton) config.newLinkButton.hidden = true;
  if (config.initialRoomId) showLink(config.initialRoomId);

  config.button.addEventListener('click', () => shareWith(config.getRoomId));

  const { newLinkButton, getNewRoomId } = config;
  if (newLinkButton && getNewRoomId) {
    newLinkButton.addEventListener('click', async () => {
      if (config.confirmNewLink && !(await config.confirmNewLink())) return;
      shareWith(getNewRoomId);
    });
  }
}
