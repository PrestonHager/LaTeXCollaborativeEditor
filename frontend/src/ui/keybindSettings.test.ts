import { mountAppShell } from '../test/appShell';
import { createKeymap, type KeybindSettings } from '../app/keymap';
import { shortcuts } from '../app/commands';
import { createKeybindSettings, type KeybindCommand } from './keybindSettings';

const commands: KeybindCommand[] = [
  { id: 'file.saveNow', label: 'Save Now', section: 'File', description: 'Save right away.' },
  { id: 'file.download', label: 'Download Project .zip', section: 'File' },
  { id: 'edit.redo', label: 'Redo', section: 'Edit' },
  { id: 'view.compileNow', label: 'Compile Now', section: 'View' },
  { id: 'share.copyLink', label: 'Copy share link', section: 'Share' },
  { id: 'file.newFile', label: 'New File', section: 'File' },
];

const chromeTab = new Map([
  ['Mod+N', { keybind: 'Mod+N', by: 'Chrome', what: 'to open a new window', keptInAppWindow: false }],
  ['Mod+W', { keybind: 'Mod+W', by: 'Chrome', what: 'to close the tab', keptInAppWindow: false }],
  ['Mod+H', { keybind: 'Mod+H', by: 'macOS', what: 'to hide the app', keptInAppWindow: true }],
]);

function setup(options: { platform?: 'mac' | 'other'; settings?: KeybindSettings; confirm?: boolean | 'dialog'; tab?: boolean } = {}) {
  mountAppShell();
  // jsdom 31+ (like real browsers) will not focus controls inside a closed <dialog>.
  document.getElementById('settings-dialog')!.setAttribute('open', '');
  const root = document.getElementById('settings-keybinds')!;
  const keymap = createKeymap(shortcuts, () => options.platform ?? 'other', options.settings, () => (options.tab ? chromeTab : new Map()));
  const onChange = vi.fn();
  const view = createKeybindSettings(root, {
    keymap,
    contextLabel: () => (options.tab ? 'Chrome in a browser tab' : 'Chrome in its own window'),
    commands: () => commands,
    editorKeybinds: new Set(['Mod+]']),
    onChange,
    confirm: options.confirm === 'dialog' ? undefined : () => options.confirm !== false,
  });
  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const row = (id: string) => q(`.keybind-row[data-command="${id}"]`);
  const chips = (id: string) => Array.from(row(id).querySelectorAll('kbd')).map((kbd) => kbd.textContent);
  const notes = (id: string) => Array.from(row(id).querySelectorAll('.keybind-note')).map((note) => note.textContent);
  const press = (target: HTMLElement, init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };
  const record = (id: string, init: KeyboardEventInit) => {
    row(id).querySelector<HTMLButtonElement>('[data-keybind-add]')!.click();
    const recorder = q<HTMLButtonElement>('[data-keybind-recorder]');
    expect(document.activeElement).toBe(recorder);
    return press(recorder, init);
  };
  const search = (text: string) => {
    const input = q<HTMLInputElement>('[data-keybind-search]');
    input.value = text;
    input.dispatchEvent(new Event('input'));
  };
  return { root, keymap, onChange, view, q, row, chips, notes, press, record, search };
}

describe('createKeybindSettings', () => {
  it('lists each command with its keybinds for the platform', () => {
    const { chips, q } = setup();
    expect(chips('file.saveNow')).toEqual(['Ctrl+S']);
    expect(chips('edit.redo')).toEqual(['Ctrl+Shift+Z', 'Ctrl+Y']);
    expect(chips('share.copyLink')).toEqual([]);
    // Nothing to reset yet.
    expect(q<HTMLButtonElement>('[data-keybind-reset]').disabled).toBe(true);
    const mac = setup({ platform: 'mac' });
    expect(mac.chips('edit.redo')).toEqual(['⇧⌘Z', '⌘Y']);
  });

  it('records a keybind by pressing it, and saves it', () => {
    const { record, chips, onChange, keymap, row, q } = setup();
    const event = record('share.copyLink', { key: 'l', code: 'KeyL', altKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(chips('share.copyLink')).toEqual(['Alt+L']);
    expect(keymap.commandFor('Alt+L')?.id).toBe('share.copyLink');
    expect(onChange).toHaveBeenLastCalledWith({ rules: [{ id: 'share.copyLink', keybind: 'Alt+L' }], disabled: [] });
    // Focus goes back to the row's add button, and reset is on now.
    expect(document.activeElement).toBe(row('share.copyLink').querySelector('[data-keybind-add]'));
    expect(q<HTMLButtonElement>('[data-keybind-reset]').disabled).toBe(false);
  });

  it('keeps recording keys away from the rest of the page', () => {
    const { record } = setup();
    const onWindow = vi.fn();
    window.addEventListener('keydown', onWindow);
    record('share.copyLink', { key: 'p', code: 'KeyP', ctrlKey: true });
    window.removeEventListener('keydown', onWindow);
    expect(onWindow).not.toHaveBeenCalled();
  });

  it('refuses plain typing keys and keys the command already has, and keeps listening', () => {
    const { record, q, press, chips, onChange } = setup();
    record('file.saveNow', { key: 'k', code: 'KeyK' });
    expect(q('[data-keybind-recorder]').textContent).toBe('K is for typing. Add Ctrl or Alt.');
    press(q('[data-keybind-recorder]'), { key: 'K', code: 'KeyK', shiftKey: true });
    expect(q('[data-keybind-recorder]').textContent).toBe('Shift+K is for typing. Add Ctrl or Alt.');
    press(q('[data-keybind-recorder]'), { key: 's', code: 'KeyS', ctrlKey: true });
    expect(q('[data-keybind-recorder]').textContent).toContain('Save Now already has Ctrl+S');
    // A modifier on its own just waits for the rest.
    press(q('[data-keybind-recorder]'), { key: 'Control', ctrlKey: true });
    expect(q('[data-keybind-recorder]')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    // Escape stops without adding anything.
    press(q('[data-keybind-recorder]'), { key: 'Escape' });
    expect(q('[data-keybind-recorder]')).toBeNull();
    expect(chips('file.saveNow')).toEqual(['Ctrl+S']);
  });

  it('asks Mac users for Mac modifiers', () => {
    const { record, q } = setup({ platform: 'mac' });
    record('file.saveNow', { key: 'k', code: 'KeyK' });
    expect(q('[data-keybind-recorder]').textContent).toBe('K is for typing. Add ⌘, ⌥, or ⌃.');
  });

  it('lets Tab leave the recorder, and stops when focus moves away', async () => {
    const { record, q, root, row } = setup();
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const tab = record('file.saveNow', { key: 'Tab' });
    expect(tab.defaultPrevented).toBe(false);
    // Tabbing to the next row's button keeps focus on that button once the list is drawn again.
    row('file.download').querySelector<HTMLButtonElement>('[data-keybind-toggle="builtin:Mod+Shift+S"]')!.focus();
    await settle();
    expect(root.querySelector('[data-keybind-recorder]')).toBeNull();
    expect(document.activeElement).toBe(row('file.download').querySelector('[data-keybind-toggle="builtin:Mod+Shift+S"]'));
    record('file.saveNow', { key: 'Tab' });
    row('file.download').querySelector<HTMLButtonElement>('[data-keybind-add]')!.focus();
    await settle();
    expect(document.activeElement).toBe(row('file.download').querySelector('[data-keybind-add]'));
    // A refused key draws a new recorder, which keeps recording.
    record('file.saveNow', { key: 'k', code: 'KeyK' });
    await settle();
    expect(q('[data-keybind-recorder]')).toBeTruthy();
    q<HTMLInputElement>('[data-keybind-search]').focus();
    await settle();
    expect(root.querySelector('[data-keybind-recorder]')).toBeNull();
    expect(document.activeElement).toBe(q('[data-keybind-search]'));
  });

  it('turns a built-in keybind off and back on', () => {
    const { row, keymap, onChange } = setup();
    row('edit.redo').querySelector<HTMLButtonElement>('[data-keybind-toggle="builtin:Mod+Y"]')!.click();
    expect(keymap.keybindsFor('edit.redo')).toEqual(['Mod+Shift+Z']);
    expect(onChange).toHaveBeenLastCalledWith({ rules: [], disabled: ['edit.redo Mod+Y'] });
    const off = row('edit.redo').querySelector<HTMLElement>('.keybind-chip[data-off]')!;
    expect(off.textContent).toContain('Ctrl+Y');
    const turnOn = off.querySelector<HTMLButtonElement>('button')!;
    expect(turnOn.getAttribute('aria-label')).toBe('Turn on Ctrl+Y for Redo');
    turnOn.click();
    expect(keymap.keybindsFor('edit.redo')).toEqual(['Mod+Shift+Z', 'Mod+Y']);
  });

  it('removes an added keybind', () => {
    const { row, chips } = setup({ settings: { rules: [{ id: 'share.copyLink', keybind: 'Alt+L' }], disabled: [] } });
    const remove = row('share.copyLink').querySelector<HTMLButtonElement>('[data-keybind-toggle="rule:Alt+L"]')!;
    expect(remove.getAttribute('aria-label')).toBe('Remove Alt+L for Copy share link');
    remove.click();
    expect(chips('share.copyLink')).toEqual([]);
  });

  it('warns when two commands want a key, and lets you pick the winner', () => {
    const { record, notes, row, keymap } = setup();
    record('view.compileNow', { key: 's', code: 'KeyS', ctrlKey: true });
    expect(keymap.commandFor('Mod+S')?.id).toBe('view.compileNow');
    expect(notes('view.compileNow')).toEqual(['Ctrl+S is also set for Save Now. This one wins.Give it to Save Now']);
    expect(notes('file.saveNow')).toEqual(['Ctrl+S is also set for Compile Now. Compile Now wins.Use it here']);
    row('file.saveNow').querySelector<HTMLButtonElement>('.keybind-note button')!.click();
    expect(keymap.commandFor('Mod+S')?.id).toBe('file.saveNow');
    // The losing rule stays in the list, turned off, so it can come back.
    expect(row('view.compileNow').querySelector('.keybind-chip[data-off]')?.textContent).toContain('Ctrl+S');
    expect(notes('view.compileNow')).toEqual([]);
    row('view.compileNow').querySelector<HTMLButtonElement>('.keybind-chip[data-off] button')!.click();
    // The "Give it to" button on the winner's row works too.
    row('view.compileNow').querySelector<HTMLButtonElement>('.keybind-note button')!.click();
    expect(keymap.commandFor('Mod+S')?.id).toBe('file.saveNow');
  });

  it("warns about the editor's own keys and the browser's", () => {
    const { record, notes } = setup();
    record('share.copyLink', { key: ']', code: 'BracketRight', ctrlKey: true });
    expect(notes('share.copyLink')).toEqual(["The editor uses Ctrl+] too, so while you type in it, the editor's key comes first."]);
    // Outside a browser tab, Ctrl+W reaches the page, so there's nothing to say.
    record('file.download', { key: 'w', code: 'KeyW', ctrlKey: true });
    expect(notes('file.download')).toEqual([]);
  });

  it('says which keys the browser keeps here, and which key is used instead', () => {
    const { record, notes, chips, root } = setup({ tab: true });
    expect(root.querySelector('[data-keybind-context]')?.textContent).toBe('Keys shown are for Chrome in a browser tab.');
    expect(chips('file.newFile')).toEqual(['Ctrl+N', 'Alt+N']);
    expect(notes('file.newFile')).toEqual(['Chrome uses Ctrl+N to open a new window, so Alt+N is used here instead. Ctrl+N works when the app is installed or in its own window.']);
    record('file.download', { key: 'w', code: 'KeyW', ctrlKey: true });
    expect(notes('file.download')).toEqual(['Chrome uses Ctrl+W to close the tab, so it may not reach the editor here. Ctrl+W works when the app is installed or in its own window.']);
    record('share.copyLink', { key: 'h', code: 'KeyH', ctrlKey: true });
    expect(notes('share.copyLink')).toEqual(['macOS uses Ctrl+H to hide the app, so it may not reach the editor here.']);
  });

  it('searches by name, section, description or key', () => {
    const { search, root } = setup();
    const ids = () => Array.from(root.querySelectorAll<HTMLElement>('.keybind-row')).map((row) => row.dataset.command);
    search('compile');
    expect(ids()).toEqual(['view.compileNow']);
    search('right away');
    expect(ids()).toEqual(['file.saveNow']);
    search('ctrl+y');
    expect(ids()).toEqual(['edit.redo']);
    search('zzzz');
    expect(ids()).toEqual([]);
    expect(root.querySelector('.keybind-empty')?.textContent).toBe('No commands match.');
  });

  it('resets to the defaults after asking', async () => {
    const settings = { rules: [{ id: 'share.copyLink' as const, keybind: 'Alt+L' }], disabled: ['edit.redo Mod+Y'] };
    const declined = setup({ settings, confirm: false });
    declined.q<HTMLButtonElement>('[data-keybind-reset]').click();
    await Promise.resolve();
    expect(declined.chips('share.copyLink')).toEqual(['Alt+L']);
    const { q, chips, onChange } = setup({ settings });
    q<HTMLButtonElement>('[data-keybind-reset]').click();
    await vi.waitFor(() => expect(chips('share.copyLink')).toEqual([]));
    expect(chips('edit.redo')).toEqual(['Ctrl+Shift+Z', 'Ctrl+Y']);
    expect(onChange).toHaveBeenLastCalledWith({ rules: [], disabled: [] });
  });

  it('asks with the in-app dialog by default, with a named, red Reset button', async () => {
    const settings = { rules: [{ id: 'share.copyLink' as const, keybind: 'Alt+L' }], disabled: [] };
    const { q, chips } = setup({ settings, confirm: 'dialog' });
    q<HTMLButtonElement>('[data-keybind-reset]').click();
    const dialog = document.querySelector<HTMLDialogElement>('dialog.app-dialog')!;
    expect(dialog.querySelector('h2')?.textContent).toBe('Reset keyboard shortcuts?');
    const [cancel, ok] = dialog.querySelectorAll<HTMLButtonElement>('footer button');
    expect(ok.textContent).toBe('Reset shortcuts');
    expect(ok.dataset.variant).toBe('destructive');
    expect(document.activeElement).toBe(cancel);
    ok.click();
    await vi.waitFor(() => expect(chips('share.copyLink')).toEqual([]));
  });

  it('draws again from the keymap on refresh, dropping a half-done recording', () => {
    const { record, keymap, view, chips, root } = setup();
    record('share.copyLink', { key: 'k', code: 'KeyK' });
    keymap.setSettings({ rules: [{ id: 'share.copyLink', keybind: 'Alt+L' }], disabled: [] });
    view.refresh();
    expect(root.querySelector('[data-keybind-recorder]')).toBeNull();
    expect(chips('share.copyLink')).toEqual(['Alt+L']);
  });
});
