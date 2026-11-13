// The "A new version is available" card (issue #121, markup in index.html #update-prompt).
// It's a status region, not a dialog: it never moves focus, so typing in the editor carries on.

type UpdatePromptActions = {
  /** Save, then reload. `force` skips the save check after a failed save. */
  onReload: (force: boolean) => void;
  onLater?: () => void;
};

export function createUpdatePrompt(root: HTMLElement, actions: UpdatePromptActions) {
  const text = root.querySelector<HTMLElement>('[data-update-text]')!;
  const detail = root.querySelector<HTMLElement>('[data-update-detail]')!;
  const later = root.querySelector<HTMLButtonElement>('[data-update-later]')!;
  const anyway = root.querySelector<HTMLButtonElement>('[data-update-anyway]')!;
  const reload = root.querySelector<HTMLButtonElement>('[data-update-reload]')!;

  const setBusy = (busy: boolean) => {
    reload.disabled = busy;
    anyway.disabled = busy;
    reload.textContent = busy ? 'Saving...' : 'Reload to update';
  };

  const show = (message: string, details: string) => {
    text.textContent = message;
    detail.textContent = details;
    root.classList.remove('is-error');
    anyway.hidden = true;
    setBusy(false);
    root.hidden = false;
  };

  const hide = () => {
    root.hidden = true;
  };

  /** The save before the reload failed: say why and offer to reload without it. */
  const showSaveError = (message: string) => {
    detail.textContent = `${message} Your edits are still in this tab.`;
    root.classList.add('is-error');
    anyway.hidden = false;
    setBusy(false);
    root.hidden = false;
  };

  reload.addEventListener('click', () => {
    setBusy(true);
    actions.onReload(false);
  });
  anyway.addEventListener('click', () => {
    setBusy(true);
    actions.onReload(true);
  });
  later.addEventListener('click', () => {
    hide();
    actions.onLater?.();
  });

  return { show, hide, showSaveError, setBusy, isOpen: () => !root.hidden };
}
