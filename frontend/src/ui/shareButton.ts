type ShareButtonConfig = {
  button: HTMLButtonElement;
  linkEl: HTMLAnchorElement;
  getRoomId: () => string;
  getCurrentUrl: () => string;
  copyText?: (value: string) => Promise<void>;
};

export function setupShareButton(config: ShareButtonConfig) {
  const copy = config.copyText ?? (async (value: string) => navigator.clipboard?.writeText(value) ?? undefined);

  config.button.addEventListener('click', () => {
    const roomId = config.getRoomId();
    const shareUrl = new URL(config.getCurrentUrl());
    shareUrl.searchParams.set('room', roomId);
    const value = shareUrl.toString();

    config.linkEl.href = value;
    config.linkEl.textContent = value;
    void copy(value).catch(() => undefined);
  });
}
