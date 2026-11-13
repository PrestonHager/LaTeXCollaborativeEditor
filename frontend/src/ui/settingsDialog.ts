import type { ThemeMode } from '../state/appSession';

export type SettingsState = {
  editorTheme: ThemeMode;
  previewTheme: ThemeMode;
  saveNowEnabled: boolean;
  /** Guests can't change how the host saves, so those controls get disabled. */
  canChangeSaving: boolean;
  /** Who's signed in to Drive. An empty string means signed in but we don't know who yet. */
  driveAccount?: string | null;
};

type SettingsDialogOptions = {
  getState: () => SettingsState;
  onEditorTheme: (theme: ThemeMode) => void;
  onPreviewTheme: (theme: ThemeMode) => void;
  onSaveNowEnabled: (enabled: boolean) => void;
  onClearLocalDocs: () => void;
};

/** Wire up the Basecoat settings dialog in the page (see index.html). */
export function createSettingsDialog(dialog: HTMLDialogElement, options: SettingsDialogOptions) {
  const find = <T extends HTMLElement>(selector: string) => {
    const el = dialog.querySelector<T>(selector);
    if (!el) throw new Error(`Settings dialog markup is missing ${selector}`);
    return el;
  };
  const editorSelect = find<HTMLSelectElement>('#settings-editor-theme');
  const previewSelect = find<HTMLSelectElement>('#settings-preview-theme');
  const saveNowToggle = find<HTMLInputElement>('#settings-disable-save-now');
  const clearButton = find<HTMLButtonElement>('#settings-clear-local');
  const driveAccount = find<HTMLElement>('#settings-drive-account');

  const close = () => {
    // NOTE: jsdom has no dialog methods, so fall back to the open attribute there.
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  };

  editorSelect.addEventListener('change', () => options.onEditorTheme(editorSelect.value as ThemeMode));
  previewSelect.addEventListener('change', () => options.onPreviewTheme(previewSelect.value as ThemeMode));
  saveNowToggle.addEventListener('change', () => options.onSaveNowEnabled(!saveNowToggle.checked));
  clearButton.addEventListener('click', () => options.onClearLocalDocs());
  find('#settings-done').addEventListener('click', close);
  find('#settings-close').addEventListener('click', (event) => {
    event.preventDefault();
    close();
  });

  // Close when a click starts and ends on the backdrop, same as Basecoat's template.
  let backdropPress = false;
  dialog.addEventListener('pointerdown', (event) => {
    backdropPress = event.target === dialog;
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && backdropPress) close();
  });

  const refresh = () => {
    const state = options.getState();
    editorSelect.value = state.editorTheme;
    previewSelect.value = state.previewTheme;
    saveNowToggle.checked = !state.saveNowEnabled;
    saveNowToggle.disabled = !state.canChangeSaving;
    clearButton.disabled = !state.canChangeSaving;
    const account = state.driveAccount;
    driveAccount.textContent = account == null ? 'Not connected' : account ? `Signed in as ${account}` : 'Connected';
  };

  const open = () => {
    refresh();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    editorSelect.focus();
  };

  return {
    open,
    close,
    refresh,
    isOpen: () => dialog.hasAttribute('open'),
  };
}
