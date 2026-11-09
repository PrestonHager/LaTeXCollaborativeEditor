type ShareButtonConfig = {
  button: HTMLButtonElement;
  linkEl: HTMLAnchorElement;
  getRoomId: () => string;
  getCurrentUrl: () => string;
  copyText?: (value: string) => Promise<void>;
  /** Called with a short message after the copy works or fails. */
  onStatus?: (message: string) => void;
};

export function setupShareButton(config: ShareButtonConfig) {
  const copy =
    config.copyText ??
    (async (value: string) => {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(value);
    });

  config.button.addEventListener('click', () => {
    let roomId: string;
    try {
      roomId = config.getRoomId();
    } catch (error) {
      console.error('Could not start a share session', error);
      config.onStatus?.('Could not start a share session. Reload the page and try again.');
      return;
    }
    const shareUrl = new URL(config.getCurrentUrl());
    shareUrl.searchParams.set('room', roomId);
    const value = shareUrl.toString();

    config.linkEl.href = value;
    config.linkEl.textContent = value;
    void copy(value).then(
      () => config.onStatus?.('Share link copied to clipboard'),
      // Clipboard needs HTTPS and page focus, so fall back to the visible link.
      () => config.onStatus?.('Could not copy automatically. Copy the link shown next to Share.'),
    );
  });
}
