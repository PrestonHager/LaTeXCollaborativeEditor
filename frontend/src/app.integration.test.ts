import { createEditorPane } from './ui/editor';
import { createMenuBar } from './ui/menuBar';
import { createSettingsDialog } from './ui/settingsDialog';
import { mountAppShell } from './test/appShell';
import { AutosaveController } from './storage/autosave';

describe('App integration behavior', () => {
  it('connects editor changes to autosave lifecycle', async () => {
    vi.useFakeTimers();
    const editorHost = document.createElement('div');
    const editor = createEditorPane(editorHost);
    const statuses: string[] = [];
    const save = vi.fn(async (_text: string) => {});

    const autosave = new AutosaveController({
      save: async () => {
        await save(editor.getText());
        return undefined;
      },
      onStatus: (s) => statuses.push(s),
    });
    autosave.enable();

    editor.onTextChanged(() => autosave.markDirty());
    editor.setText('integration-content', true);
    await vi.advanceTimersByTimeAsync(4000);

    expect(save).toHaveBeenCalledWith('integration-content');
    expect(statuses).toContain('Saved');
    vi.useRealTimers();
  });

  it('wires every menu item in index.html to a command with an icon', () => {
    mountAppShell();
    const calls: string[] = [];
    const menuBar = createMenuBar(document.getElementById('menu-bar')!, {
      getCommandState: () => ({ enabled: true }),
      onCommand: (id) => calls.push(id),
    });
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('#menu-bar .menu-root:not([data-collapsed-menu]) .menu-item[data-command]'));
    expect(items.length).toBe(menuBar.entries().length);
    // The one-button phone menu (#186) has a copy of every item, in the same order.
    const phoneItems = Array.from(document.querySelectorAll<HTMLButtonElement>('#menu-bar [data-collapsed-menu] .menu-item[data-command]'));
    expect(phoneItems.map((item) => item.dataset.command)).toEqual(items.map((item) => item.dataset.command));
    expect(phoneItems.every((item) => item.querySelector('svg'))).toBe(true);
    expect(items.every((item) => item.querySelector('svg'))).toBe(true);
    const settingsItem = items.find((item) => item.dataset.command === 'app.openSettings')!;
    expect(settingsItem.closest('.menu-root')?.getAttribute('data-menu-label')).toBe('Edit');
    settingsItem.click();
    expect(calls).toEqual(['app.openSettings']);
    menuBar.destroy();
  });

  it('wires the settings dialog in index.html', () => {
    mountAppShell();
    const onEditorTheme = vi.fn();
    const onSavingPaused = vi.fn();
    const onClearLocalDocs = vi.fn();
    const onOpen = vi.fn();
    const dialog = createSettingsDialog(document.getElementById('settings-dialog') as HTMLDialogElement, {
      getState: () => ({ editorTheme: 'dark', previewTheme: 'light', savingPaused: false, canChangeSaving: true }),
      onEditorTheme,
      onPreviewTheme: () => undefined,
      onSavingPaused,
      onClearLocalDocs,
      onOpen,
    });
    dialog.open();
    expect(dialog.isOpen()).toBe(true);
    // The keybind list draws itself again each time Settings opens.
    expect(onOpen).toHaveBeenCalledTimes(1);
    const editorSelect = document.getElementById('settings-editor-theme') as HTMLSelectElement;
    expect(editorSelect.value).toBe('dark');
    expect((document.getElementById('settings-preview-theme') as HTMLSelectElement).value).toBe('light');
    editorSelect.value = 'light';
    editorSelect.dispatchEvent(new Event('change'));
    expect(onEditorTheme).toHaveBeenCalledWith('light');
    const toggle = document.getElementById('settings-pause-saving') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(onSavingPaused).toHaveBeenCalledWith(true);
    (document.getElementById('settings-clear-local') as HTMLButtonElement).click();
    expect(onClearLocalDocs).toHaveBeenCalled();
    (document.getElementById('settings-done') as HTMLButtonElement).click();
    expect(dialog.isOpen()).toBe(false);
  });

  it('disables saving controls in settings for guests', () => {
    mountAppShell();
    const dialog = createSettingsDialog(document.getElementById('settings-dialog') as HTMLDialogElement, {
      getState: () => ({ editorTheme: 'system', previewTheme: 'system', savingPaused: false, canChangeSaving: false }),
      onEditorTheme: () => undefined,
      onPreviewTheme: () => undefined,
      onSavingPaused: () => undefined,
      onClearLocalDocs: () => undefined,
    });
    dialog.open();
    expect((document.getElementById('settings-pause-saving') as HTMLInputElement).disabled).toBe(true);
    expect((document.getElementById('settings-clear-local') as HTMLButtonElement).disabled).toBe(true);
    (document.getElementById('settings-close') as HTMLButtonElement).click();
    expect(dialog.isOpen()).toBe(false);
  });

  it('shows who is signed in to Drive in settings', () => {
    mountAppShell();
    let driveAccount: string | null = null;
    const dialog = createSettingsDialog(document.getElementById('settings-dialog') as HTMLDialogElement, {
      getState: () => ({ editorTheme: 'system', previewTheme: 'system', savingPaused: false, canChangeSaving: true, driveAccount }),
      onEditorTheme: () => undefined,
      onPreviewTheme: () => undefined,
      onSavingPaused: () => undefined,
      onClearLocalDocs: () => undefined,
    });
    const label = document.getElementById('settings-drive-account')!;
    dialog.open();
    expect(label.textContent).toBe('Not connected');
    driveAccount = '';
    dialog.refresh();
    expect(label.textContent).toBe('Connected');
    driveAccount = 'me@example.com';
    dialog.refresh();
    expect(label.textContent).toBe('Signed in as me@example.com');
  });

  it('exports, imports and resets settings from the dialog', async () => {
    vi.useFakeTimers();
    mountAppShell();
    const onExportSettings = vi.fn();
    const onImportSettings = vi.fn(async (file: File) => `Imported ${file.name}`);
    const onResetSettings = vi.fn(() => 'Reset done.');
    let settingsPersistent = true;
    const dialog = createSettingsDialog(document.getElementById('settings-dialog') as HTMLDialogElement, {
      getState: () => ({ editorTheme: 'system', previewTheme: 'system', savingPaused: false, canChangeSaving: false, settingsPersistent }),
      onEditorTheme: () => undefined,
      onPreviewTheme: () => undefined,
      onSavingPaused: () => undefined,
      onClearLocalDocs: () => undefined,
      onExportSettings,
      onImportSettings,
      onResetSettings,
    });
    const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
    const status = byId('settings-data-status');
    dialog.open();
    expect(byId('settings-storage-note').hidden).toBe(true);

    // Guests get these too: settings are their own.
    expect(byId<HTMLButtonElement>('settings-export').disabled).toBe(false);
    byId<HTMLButtonElement>('settings-export').click();
    expect(onExportSettings).toHaveBeenCalled();
    expect(status.textContent).toBe('Settings downloaded.');

    const input = byId<HTMLInputElement>('settings-import-file');
    const pick = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    byId<HTMLButtonElement>('settings-import').click();
    expect(pick).toHaveBeenCalled();
    const file = new File(['{}'], 'mine.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(status.textContent).toBe('Imported mine.json'));
    onImportSettings.mockRejectedValueOnce(new Error('nope'));
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(status.textContent).toBe('Could not read that file.'));
    Object.defineProperty(input, 'files', { configurable: true, value: [] });
    input.dispatchEvent(new Event('change'));
    expect(onImportSettings).toHaveBeenCalledTimes(2);

    // Reset takes a second click, and lets go after a while.
    const reset = byId<HTMLButtonElement>('settings-reset');
    const scope = byId<HTMLSelectElement>('settings-reset-scope');
    reset.click();
    expect(reset.textContent).toBe('Click again to reset');
    expect(onResetSettings).not.toHaveBeenCalled();
    vi.advanceTimersByTime(6000);
    expect(reset.textContent).toBe('Reset to defaults');
    reset.click();
    scope.value = 'keybinds';
    scope.dispatchEvent(new Event('change'));
    expect(reset.dataset.armed).toBeUndefined();
    reset.click();
    reset.click();
    expect(onResetSettings).toHaveBeenCalledWith('keybinds');
    expect(status.textContent).toBe('Reset done.');

    settingsPersistent = false;
    dialog.refresh();
    expect(byId('settings-storage-note').hidden).toBe(false);
    dialog.close();
    vi.useRealTimers();
  });
});
