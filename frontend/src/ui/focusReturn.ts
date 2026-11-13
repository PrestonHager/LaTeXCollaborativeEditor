/**
 * Send focus back to whatever opened a dialog once it closes. Call remember() right before
 * showModal(). Browsers don't all do this, and when a menu item opened the dialog the item
 * is hidden by then, so we fall back to that menu's trigger button.
 */
export function returnFocusOnClose(dialog: HTMLElement, fallback?: () => HTMLElement | null) {
  let opener: HTMLElement | null = null;

  const target = (): HTMLElement | null => {
    if (!opener?.isConnected) return fallback?.() ?? null;
    const menuTrigger = opener.closest('.menu-root')?.querySelector<HTMLElement>('.menu-trigger');
    if (menuTrigger && menuTrigger !== opener) return menuTrigger;
    // The palette closes as it runs a command, so its input is no use either.
    if (opener.closest('[aria-hidden="true"], [hidden]')) return fallback?.() ?? null;
    return opener;
  };

  dialog.addEventListener('close', () => {
    const next = target();
    opener = null;
    next?.focus();
  });

  return {
    remember() {
      const active = document.activeElement;
      opener = active instanceof HTMLElement && active !== document.body ? active : null;
    },
  };
}
