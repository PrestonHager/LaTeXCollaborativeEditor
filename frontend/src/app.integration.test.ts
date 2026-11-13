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
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('.menu-item[data-command]'));
    expect(items.length).toBe(menuBar.entries().length);
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
});
