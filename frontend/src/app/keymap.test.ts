import {
  addRule,
  builtinKey,
  createKeymap,
  emptyKeybindSettings,
  KEYBINDS_KEY,
  pickWinner,
  readKeybindSettings,
  toggleBinding,
  writeKeybindSettings,
  type KeybindSettings,
} from './keymap';
import { shortcuts } from './commands';

const memoryStore = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};

const brokenStore = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

const withSettings = (settings: KeybindSettings, platform: 'mac' | 'other' = 'other') => createKeymap(shortcuts, () => platform, settings);

describe('createKeymap', () => {
  it('finds the command for a keybind, and the keybinds for a command', () => {
    const keymap = createKeymap(shortcuts, () => 'other');
    expect(keymap.commandFor('Mod+S')?.id).toBe('file.saveNow');
    expect(keymap.commandFor('Mod+C')).toMatchObject({ id: 'edit.copy', keybind: 'Mod+C', native: true });
    expect(keymap.commandFor('Mod+Shift+C')).toBeNull();
    expect(keymap.keybindsFor('edit.redo')).toEqual(['Mod+Shift+Z', 'Mod+Y']);
    expect(keymap.keybindsFor('file.newFile')).toEqual([]);
  });

  it('labels the main keybind for the platform', () => {
    expect(createKeymap(shortcuts, () => 'other').labelFor('edit.redo')).toBe('Ctrl+Shift+Z');
    expect(createKeymap(shortcuts, () => 'mac').labelFor('edit.redo')).toBe('⇧⌘Z');
    expect(createKeymap(shortcuts, () => 'mac').labelFor('view.compileNow')).toBe('⌘↩');
    expect(createKeymap(shortcuts, () => 'other').labelFor('file.newFile')).toBeUndefined();
  });

  it('gives a key to the first built-in that lists it, and skips bad keybinds', () => {
    const keymap = createKeymap(
      [
        { id: 'file.saveNow', keybind: 'mod+s' },
        { id: 'file.download', keybind: 'Mod+S' },
        { id: 'file.new', keybind: 'Hyper+N' },
      ],
      () => 'other',
    );
    expect(keymap.commandFor('Mod+S')?.id).toBe('file.saveNow');
    expect(keymap.keybindsFor('file.download')).toEqual([]);
    expect(keymap.keybindsFor('file.new')).toEqual([]);
    expect(keymap.claimants('Mod+S').map((b) => b.id)).toEqual(['file.saveNow', 'file.download']);
  });

  it('adds rules after the built-ins, and a rule beats a built-in for the same key', () => {
    const keymap = withSettings({ rules: [{ id: 'view.compileNow', keybind: 'Alt+K' }, { id: 'file.newFile', keybind: 'Mod+S' }], disabled: [] });
    expect(keymap.keybindsFor('view.compileNow')).toEqual(['Mod+Enter', 'Alt+K']);
    expect(keymap.commandFor('Mod+S')?.id).toBe('file.newFile');
    expect(keymap.keybindsFor('file.saveNow')).toEqual([]);
    expect(keymap.labelFor('file.newFile')).toBe('Ctrl+S');
  });

  it('lets the last rule win when two rules want a key', () => {
    const keymap = withSettings({ rules: [{ id: 'file.newFile', keybind: 'Alt+N' }, { id: 'file.newFolder', keybind: 'Alt+N' }], disabled: [] });
    expect(keymap.commandFor('Alt+N')?.id).toBe('file.newFolder');
  });

  it('turns off built-ins one keybind at a time, and skips rules that are off or unsafe', () => {
    const keymap = withSettings({
      rules: [
        { id: 'file.newFile', keybind: 'Alt+N', off: true },
        { id: 'file.newFolder', keybind: 'N' },
      ],
      disabled: [builtinKey({ id: 'edit.redo', keybind: 'Mod+Y' })],
    });
    expect(keymap.keybindsFor('edit.redo')).toEqual(['Mod+Shift+Z']);
    expect(keymap.commandFor('Mod+Y')).toBeNull();
    expect(keymap.commandFor('Alt+N')).toBeNull();
    // A plain letter would take typing away from the editor, so it never counts.
    expect(keymap.commandFor('N')).toBeNull();
    expect(keymap.bindings().filter((b) => b.off).map((b) => b.keybind)).toEqual(['Mod+Y', 'Alt+N']);
  });

  it('reads the same settings for each platform', () => {
    const settings = { rules: [{ id: 'file.newFile' as const, keybind: 'Mod+Alt+N' }], disabled: [] };
    expect(withSettings(settings, 'mac').labelFor('file.newFile')).toBe('⌥⌘N');
    expect(withSettings(settings, 'other').labelFor('file.newFile')).toBe('Ctrl+Alt+N');
  });

  it('swaps in new settings', () => {
    const keymap = createKeymap(shortcuts, () => 'other');
    keymap.setSettings({ rules: [{ id: 'file.newFile', keybind: 'Alt+N' }], disabled: [] });
    expect(keymap.labelFor('file.newFile')).toBe('Alt+N');
    // settings() hands out a copy.
    keymap.settings().rules.pop();
    expect(keymap.settings().rules).toHaveLength(1);
  });
});

describe('editing keybind settings', () => {
  it('adds a rule once, and turns a turned-off built-in back on instead of adding it', () => {
    let settings = addRule(emptyKeybindSettings(), 'file.newFile', 'Alt+N', shortcuts);
    expect(settings.rules).toEqual([{ id: 'file.newFile', keybind: 'Alt+N' }]);
    expect(addRule(settings, 'file.newFile', 'Alt+N', shortcuts)).toBe(settings);
    // Adding a built-in keybind the command already has changes nothing.
    expect(addRule(settings, 'file.saveNow', 'Mod+S', shortcuts)).toBe(settings);
    settings = { ...settings, disabled: ['file.saveNow Mod+S'] };
    expect(addRule(settings, 'file.saveNow', 'Mod+S', shortcuts).disabled).toEqual([]);
  });

  it('turns built-ins off and on, and removes or turns on rules', () => {
    const keymap = withSettings({ rules: [{ id: 'file.newFile', keybind: 'Alt+N' }, { id: 'file.newFolder', keybind: 'Alt+F', off: true }], disabled: [] });
    const find = (keybind: string) => keymap.bindings().find((b) => b.keybind === keybind)!;
    let settings = toggleBinding(keymap.settings(), find('Mod+S'));
    expect(settings.disabled).toEqual(['file.saveNow Mod+S']);
    keymap.setSettings(settings);
    settings = toggleBinding(keymap.settings(), find('Mod+S'));
    expect(settings.disabled).toEqual([]);
    settings = toggleBinding(settings, find('Alt+F'));
    expect(settings.rules[1]).toEqual({ id: 'file.newFolder', keybind: 'Alt+F' });
    settings = toggleBinding(settings, find('Alt+N'));
    expect(settings.rules).toEqual([{ id: 'file.newFolder', keybind: 'Alt+F' }]);
  });

  it('gives a key to the command picked, turning it off for the others', () => {
    const keymap = withSettings({ rules: [{ id: 'view.compileNow', keybind: 'Mod+S' }, { id: 'file.newFile', keybind: 'Mod+S' }], disabled: [] });
    const claimants = keymap.claimants('Mod+S');
    expect(claimants.map((b) => b.id)).toEqual(['file.saveNow', 'view.compileNow', 'file.newFile']);
    // Give it back to the built-in Save Now: both rules get turned off, but stay listed.
    let settings = pickWinner(keymap.settings(), claimants, 'file.saveNow');
    keymap.setSettings(settings);
    expect(keymap.commandFor('Mod+S')?.id).toBe('file.saveNow');
    expect(settings.rules.every((rule) => rule.off)).toBe(true);
    // Or give it to a rule: the built-in gets turned off.
    keymap.setSettings({ rules: [{ id: 'view.compileNow', keybind: 'Mod+S' }], disabled: [] });
    settings = pickWinner(keymap.settings(), keymap.claimants('Mod+S'), 'view.compileNow');
    expect(settings.disabled).toEqual(['file.saveNow Mod+S']);
  });
});

describe('keybind storage', () => {
  it('saves and reads the settings, and clears the key once they are back to defaults', () => {
    const store = memoryStore();
    const settings = { rules: [{ id: 'file.newFile' as const, keybind: 'Alt+N', off: true }], disabled: ['edit.redo Mod+Y'] };
    writeKeybindSettings(store, settings);
    expect(readKeybindSettings(store)).toEqual(settings);
    writeKeybindSettings(store, emptyKeybindSettings());
    expect(store.data.has(KEYBINDS_KEY)).toBe(false);
    expect(readKeybindSettings(store)).toEqual(emptyKeybindSettings());
  });

  it('drops junk and commands that no longer exist', () => {
    const store = memoryStore();
    store.setItem(KEYBINDS_KEY, JSON.stringify({ rules: [{ id: 'file.newFile', keybind: 'Alt+N' }, { id: 'gone.command', keybind: 'Alt+G' }, { id: 3 }, null], disabled: ['ok', 4] }));
    expect(readKeybindSettings(store, (id) => id !== 'gone.command')).toEqual({ rules: [{ id: 'file.newFile', keybind: 'Alt+N' }], disabled: ['ok'] });
    store.setItem(KEYBINDS_KEY, '{not json');
    expect(readKeybindSettings(store)).toEqual(emptyKeybindSettings());
    store.setItem(KEYBINDS_KEY, JSON.stringify({ rules: 'nope' }));
    expect(readKeybindSettings(store)).toEqual(emptyKeybindSettings());
  });

  it('falls back to the defaults when storage throws or is missing', () => {
    expect(readKeybindSettings(brokenStore)).toEqual(emptyKeybindSettings());
    expect(readKeybindSettings(undefined)).toEqual(emptyKeybindSettings());
    expect(() => writeKeybindSettings(brokenStore, { rules: [{ id: 'file.newFile', keybind: 'Alt+N' }], disabled: [] })).not.toThrow();
    expect(() => writeKeybindSettings(brokenStore, emptyKeybindSettings())).not.toThrow();
  });
});
