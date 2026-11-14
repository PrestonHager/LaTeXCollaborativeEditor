import type { ThemeMode } from '../state/appSession';
import type { SettingSection } from '../state/settings';
import { returnFocusOnClose } from './focusReturn';
import { formatBytes } from './formatBytes';
import './settingsDialog.css';

export { formatBytes };

export type SettingsState = {
  editorTheme: ThemeMode;
  previewTheme: ThemeMode;
  savingPaused: boolean;
  /** Guests can't change how the host saves, so those controls get disabled. */
  canChangeSaving: boolean;
  /** Who's signed in to Drive. An empty string means signed in but we don't know who yet. */
  driveAccount?: string | null;
  /** False when browser storage is blocked or full, so settings only last for this tab. */
  settingsPersistent?: boolean;
};

/** What to reset: every setting, or one section. */
export type ResetScope = SettingSection | 'all';

type SettingsDialogOptions = {
  getState: () => SettingsState;
  onEditorTheme: (theme: ThemeMode) => void;
  onPreviewTheme: (theme: ThemeMode) => void;
  onSavingPaused: (paused: boolean) => void;
  onClearLocalDocs: () => void;
  /** Open the profile dialog (templates/templatesUi.ts). */
  onEditProfile?: () => void;
  /** Called each time the dialog opens, so parts drawn elsewhere (like the keybind list) can catch up. */
  onOpen?: () => void;
  /** Download the settings as a JSON file. */
  onExportSettings?: () => void;
  /** Load a settings file. Resolves to a message saying what happened. */
  onImportSettings?: (file: File) => Promise<string>;
  /** Put settings back to their defaults. Returns a message saying what happened. */
  onResetSettings?: (scope: ResetScope) => string;
  /**
   * The Compile PDF engine files stored in this browser (issue #241): how much they take and a
   * way to remove them. Both load the asset cache on demand, so the dialog stays small.
   */
  texAssets?: { usage(): Promise<{ bytes: number; files: number }>; remove(): Promise<void> };
};

// How long Reset waits for the second click before it lets go.
const RESET_CONFIRM_MS = 5000;

/** Wire up the Basecoat settings dialog in the page (see index.html). */
export function createSettingsDialog(dialog: HTMLDialogElement, options: SettingsDialogOptions) {
  const find = <T extends HTMLElement>(selector: string) => {
    const el = dialog.querySelector<T>(selector);
    if (!el) throw new Error(`Settings dialog markup is missing ${selector}`);
    return el;
  };
  const editorSelect = find<HTMLSelectElement>('#settings-editor-theme');
  const previewSelect = find<HTMLSelectElement>('#settings-preview-theme');
  const pauseToggle = find<HTMLInputElement>('#settings-pause-saving');
  const clearButton = find<HTMLButtonElement>('#settings-clear-local');
  const driveAccount = find<HTMLElement>('#settings-drive-account');
  const exportButton = find<HTMLButtonElement>('#settings-export');
  const importButton = find<HTMLButtonElement>('#settings-import');
  const importInput = find<HTMLInputElement>('#settings-import-file');
  const resetScope = find<HTMLSelectElement>('#settings-reset-scope');
  const resetButton = find<HTMLButtonElement>('#settings-reset');
  const dataStatus = find<HTMLElement>('#settings-data-status');
  const storageNote = find<HTMLElement>('#settings-storage-note');
  // Only shows once something was downloaded, so nobody sees a setting for a feature they haven't used.
  const texAssetsRow = find<HTMLElement>('#settings-tex-assets-row');
  const texAssets = find<HTMLElement>('#settings-tex-assets');
  const texAssetsRemove = find<HTMLButtonElement>('#settings-tex-assets-remove');

  // Each look-up gets a number, so a slow one can't overwrite a newer answer.
  let texAssetsSeq = 0;
  const showTexAssets = async () => {
    const seq = ++texAssetsSeq;
    if (!options.texAssets) {
      texAssets.textContent = 'Not downloaded';
      texAssetsRemove.hidden = true;
      return;
    }
    try {
      const { bytes, files } = await options.texAssets.usage();
      if (seq !== texAssetsSeq) return;
      texAssets.textContent = files ? `${formatBytes(bytes)} stored in this browser` : 'Not downloaded';
      texAssetsRemove.hidden = files === 0;
      // Stays up after Remove, so the person sees it worked.
      if (files) texAssetsRow.hidden = false;
    } catch {
      if (seq !== texAssetsSeq) return;
      texAssets.textContent = "Couldn't check";
      texAssetsRemove.hidden = true;
    }
  };
  texAssetsRemove.addEventListener('click', () => {
    if (!options.texAssets) return;
    texAssetsRemove.disabled = true;
    void options.texAssets
      .remove()
      .then(
        () => say('Removed the Compile PDF engine files. Compile PDF asks before downloading them again.'),
        () => say("Couldn't remove the Compile PDF engine files."),
      )
      .finally(() => {
        texAssetsRemove.disabled = false;
        void showTexAssets();
      });
  });

  const close = () => {
    // NOTE: jsdom has no dialog methods, so fall back to the open attribute there.
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  };

  editorSelect.addEventListener('change', () => options.onEditorTheme(editorSelect.value as ThemeMode));
  previewSelect.addEventListener('change', () => options.onPreviewTheme(previewSelect.value as ThemeMode));
  pauseToggle.addEventListener('change', () => options.onSavingPaused(pauseToggle.checked));
  clearButton.addEventListener('click', () => options.onClearLocalDocs());
  dialog.querySelector('#settings-profile')?.addEventListener('click', () => options.onEditProfile?.());
  const say = (message: string) => {
    dataStatus.textContent = message;
  };
  exportButton.addEventListener('click', () => {
    options.onExportSettings?.();
    say('Settings downloaded.');
  });
  importButton.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    // Clear it so picking the same file again still fires change.
    importInput.value = '';
    if (!file || !options.onImportSettings) return;
    void options.onImportSettings(file).then(say, () => say('Could not read that file.'));
  });

  // Reset asks for a second click instead of a confirm() popup. The button says what it will do.
  const resetLabel = resetButton.textContent ?? 'Reset';
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  const disarm = () => {
    clearTimeout(resetTimer);
    resetTimer = undefined;
    delete resetButton.dataset.armed;
    resetButton.dataset.variant = 'outline';
    resetButton.textContent = resetLabel;
  };
  resetButton.addEventListener('click', () => {
    if (resetButton.dataset.armed === undefined) {
      resetButton.dataset.armed = '';
      resetButton.dataset.variant = 'destructive';
      resetButton.textContent = 'Click again to reset';
      resetTimer = setTimeout(disarm, RESET_CONFIRM_MS);
      return;
    }
    disarm();
    const message = options.onResetSettings?.(resetScope.value as ResetScope) ?? '';
    refresh();
    say(message);
  });
  resetButton.addEventListener('blur', disarm);
  resetScope.addEventListener('change', disarm);

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
    pauseToggle.checked = state.savingPaused;
    pauseToggle.disabled = !state.canChangeSaving;
    clearButton.disabled = !state.canChangeSaving;
    const account = state.driveAccount;
    driveAccount.textContent = account == null ? 'Not connected' : account ? `Signed in as ${account}` : 'Connected';
    storageNote.hidden = state.settingsPersistent !== false;
  };

  const focusReturn = returnFocusOnClose(dialog);

  const open = () => {
    refresh();
    say('');
    disarm();
    options.onOpen?.();
    texAssetsRow.hidden = true;
    void showTexAssets();
    focusReturn.remember();
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
