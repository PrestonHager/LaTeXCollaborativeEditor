import {
  addRule,
  builtinKey,
  createKeymap,
  emptyKeybindSettings,
  keepKnownCommands,
  migrateKeybinds,
  pickWinner,
  toggleBinding,
  type KeybindSettings,
} from './keymap';
import { shortcuts } from './commands';

const withSettings = (settings: KeybindSettings, platform: 'mac' | 'other' = 'other') => createKeymap(shortcuts, () => platform, settings);

describe('createKeymap', () => {
  it('finds the command for a keybind, and the keybinds for a command', () => {
    const keymap = createKeymap(shortcuts, () => 'other');
    expect(keymap.commandFor('Mod+S')?.id).toBe('file.saveNow');
    expect(keymap.commandFor('Mod+C')).toMatchObject({ id: 'edit.copy', keybind: 'Mod+C', native: true });
    expect(keymap.commandFor('Mod+Shift+C')).toBeNull();
    expect(keymap.keybindsFor('edit.redo')).toEqual(['Mod+Shift+Z', 'Mod+Y']);
    // The fallbacks are always on, after the main key.
    expect(keymap.keybindsFor('file.newFile')).toEqual(['Mod+N', 'Alt+N']);
    expect(keymap.keybindsFor('file.new')).toEqual(['Mod+Shift+N', 'Alt+Shift+N']);
    expect(keymap.keybindsFor('file.export')).toEqual(['Mod+Shift+E', 'Alt+Shift+E']);
    expect(keymap.keybindsFor('file.newFolder')).toEqual([]);
  });

  it('labels the main keybind for the platform', () => {
    expect(createKeymap(shortcuts, () => 'other').labelFor('edit.redo')).toBe('Ctrl+Shift+Z');
    expect(createKeymap(shortcuts, () => 'mac').labelFor('edit.redo')).toBe('⇧⌘Z');
    expect(createKeymap(shortcuts, () => 'mac').labelFor('view.compileNow')).toBe('⌘↩');
    expect(createKeymap(shortcuts, () => 'other').labelFor('file.newFile')).toBe('Ctrl+N');
    expect(createKeymap(shortcuts, () => 'mac').labelFor('file.new')).toBe('⇧⌘N');
    expect(createKeymap(shortcuts, () => 'other').labelFor('file.newFolder')).toBeUndefined();
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
    const keymap = withSettings({ rules: [{ id: 'view.compileNow', keybind: 'Alt+K' }, { id: 'file.newFolder', keybind: 'Mod+S' }], disabled: [] });
    expect(keymap.keybindsFor('view.compileNow')).toEqual(['Mod+Enter', 'Alt+K']);
    expect(keymap.commandFor('Mod+S')?.id).toBe('file.newFolder');
    expect(keymap.keybindsFor('file.saveNow')).toEqual([]);
    expect(keymap.labelFor('file.newFolder')).toBe('Ctrl+S');
  });

  it('lets the last rule win when two rules want a key', () => {
    const keymap = withSettings({ rules: [{ id: 'file.newFile', keybind: 'Alt+N' }, { id: 'file.newFolder', keybind: 'Alt+N' }], disabled: [] });
    expect(keymap.commandFor('Alt+N')?.id).toBe('file.newFolder');
  });

  it('turns off built-ins one keybind at a time, and skips rules that are off or unsafe', () => {
    const keymap = withSettings({
      rules: [
        { id: 'file.newFile', keybind: 'Alt+J', off: true },
        { id: 'file.newFolder', keybind: 'N' },
      ],
      disabled: [builtinKey({ id: 'edit.redo', keybind: 'Mod+Y' })],
    });
    expect(keymap.keybindsFor('edit.redo')).toEqual(['Mod+Shift+Z']);
    expect(keymap.commandFor('Mod+Y')).toBeNull();
    expect(keymap.commandFor('Alt+J')).toBeNull();
    // A plain letter would take typing away from the editor, so it never counts.
    expect(keymap.commandFor('N')).toBeNull();
    expect(keymap.bindings().filter((b) => b.off).map((b) => b.keybind)).toEqual(['Mod+Y', 'Alt+J']);
  });

  it('reads the same settings for each platform', () => {
    const settings = { rules: [{ id: 'file.newFolder' as const, keybind: 'Mod+Alt+N' }], disabled: [] };
    expect(withSettings(settings, 'mac').labelFor('file.newFolder')).toBe('⌥⌘N');
    expect(withSettings(settings, 'other').labelFor('file.newFolder')).toBe('Ctrl+Alt+N');
  });

  it('swaps in new settings', () => {
    const keymap = createKeymap(shortcuts, () => 'other');
    keymap.setSettings({ rules: [{ id: 'file.newFolder', keybind: 'Alt+N' }], disabled: [] });
    expect(keymap.labelFor('file.newFolder')).toBe('Alt+N');
    // settings() hands out a copy.
    keymap.settings().rules.pop();
    expect(keymap.settings().rules).toHaveLength(1);
  });
});

describe('keys the browser keeps', () => {
  const chromeTab = () =>
    new Map([
      ['Mod+N', { keybind: 'Mod+N', by: 'Chrome', what: 'to open a new window', keptInAppWindow: false }],
      ['Mod+Shift+N', { keybind: 'Mod+Shift+N', by: 'Chrome', what: 'to open a private window', keptInAppWindow: false }],
    ]);

  it('uses the fallback where the main key is kept, and shows it first', () => {
    const keymap = createKeymap(shortcuts, () => 'other', undefined, chromeTab);
    expect(keymap.labelFor('file.newFile')).toBe('Alt+N');
    expect(keymap.labelFor('file.new')).toBe('Alt+Shift+N');
    // The main key stays bound, for when it does get through.
    expect(keymap.keybindsFor('file.newFile')).toEqual(['Alt+N', 'Mod+N']);
    expect(keymap.commandFor('Alt+N')?.id).toBe('file.newFile');
    expect(keymap.commandFor('Mod+N')?.id).toBe('file.newFile');
    const [main, spare] = keymap.bindings().filter((b) => b.id === 'file.newFile');
    expect(main).toMatchObject({ keybind: 'Mod+N', reserved: { by: 'Chrome' } });
    expect(spare).toMatchObject({ keybind: 'Alt+N', source: 'builtin', fallbackFor: 'Mod+N' });
    expect(spare).not.toHaveProperty('fallback');
    expect(keymap.reservedFor('Mod+N')?.what).toBe('to open a new window');
    expect(keymap.reservedFor('Alt+N')).toBeNull();
    // On a Mac the fallback adds ⌥ to ⌘, since ⌥N types.
    expect(createKeymap(shortcuts, () => 'mac', undefined, chromeTab).labelFor('file.newFile')).toBe('⌥⌘N');
  });

  it('follows the window when it changes', () => {
    let kept = chromeTab();
    const keymap = createKeymap(shortcuts, () => 'other', undefined, () => kept);
    expect(keymap.labelFor('file.newFile')).toBe('Alt+N');
    kept = new Map();
    keymap.refresh();
    expect(keymap.labelFor('file.newFile')).toBe('Ctrl+N');
    expect(keymap.keybindsFor('file.newFile')).toEqual(['Mod+N', 'Alt+N']);
  });

  it('turns a fallback off on its own, and skips one a rule already gives the command', () => {
    const off = withSettings({ rules: [], disabled: ['file.newFile Alt+N'] });
    const keymap = createKeymap(shortcuts, () => 'other', { rules: [], disabled: ['file.newFile Alt+N'] }, chromeTab);
    expect(keymap.commandFor('Alt+N')).toBeNull();
    expect(keymap.labelFor('file.newFile')).toBe('Ctrl+N');
    expect(off.labelFor('file.newFile')).toBe('Ctrl+N');
    const ruled = createKeymap(shortcuts, () => 'other', { rules: [{ id: 'file.newFile', keybind: 'Alt+N' }], disabled: [] }, chromeTab);
    expect(ruled.bindings().filter((b) => b.keybind === 'Alt+N').map((b) => b.source)).toEqual(['rule']);
    // A rule on a kept key is marked too.
    const kept = createKeymap(shortcuts, () => 'other', { rules: [{ id: 'file.download', keybind: 'Mod+N' }], disabled: [] }, chromeTab);
    expect(kept.bindings().find((b) => b.source === 'rule')?.reserved?.by).toBe('Chrome');
    // Adding the fallback back, after turning it off, turns it on.
    const builtins = keymap.bindings().filter((b) => b.source === 'builtin');
    expect(addRule(keymap.settings(), 'file.newFile', 'Alt+N', builtins)).toEqual({ rules: [], disabled: [] });
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

describe('keepKnownCommands', () => {
  it('drops rules for commands that no longer exist', () => {
    const settings = { rules: [{ id: 'file.newFile' as const, keybind: 'Alt+N' }, { id: 'gone.command' as never, keybind: 'Alt+G' }], disabled: ['ok'] };
    expect(keepKnownCommands(settings, (id) => id !== 'gone.command')).toEqual({ rules: [{ id: 'file.newFile', keybind: 'Alt+N' }], disabled: ['ok'] });
    expect(keepKnownCommands(emptyKeybindSettings(), () => true)).toEqual(emptyKeybindSettings());
  });
});

describe('migrating saved keybinds', () => {
  const settings = (rules: KeybindSettings['rules'], disabled: string[] = []): KeybindSettings => ({ rules, disabled });

  it('leaves settings alone when nothing moved', () => {
    const saved = settings([{ id: 'file.newFolder', keybind: 'Alt+F' }], ['edit.redo Mod+Y']);
    expect(migrateKeybinds(saved, shortcuts)).toEqual(saved);
    expect(migrateKeybinds(emptyKeybindSettings(), shortcuts)).toEqual(emptyKeybindSettings());
  });

  it('keeps Ctrl+N off for someone who turned it off when it was New Project', () => {
    const keymap = withSettings(settings([], ['file.new Mod+N']));
    expect(keymap.settings()).toEqual(settings([], ['file.newFile Mod+N']));
    expect(keymap.commandFor('Mod+N')).toBeNull();
    // New Project still gets its new key, and New File keeps its fallback.
    expect(keymap.keybindsFor('file.new')).toEqual(['Mod+Shift+N', 'Alt+Shift+N']);
    expect(keymap.keybindsFor('file.newFile')).toEqual(['Alt+N']);
  });

  it('keeps Ctrl+N on the command someone gave it to', () => {
    // They picked Compile Now for Ctrl+N, which turned it off for New Project.
    const keymap = withSettings(settings([{ id: 'view.compileNow', keybind: 'Mod+N' }], ['file.new Mod+N']));
    expect(keymap.settings()).toEqual(settings([{ id: 'view.compileNow', keybind: 'Mod+N' }]));
    expect(keymap.commandFor('Mod+N')?.id).toBe('view.compileNow');
  });

  it('swaps a rule that is now built in for the built-in one', () => {
    // They gave Ctrl+N to New File themselves. Now it's the default, so the rule goes.
    const keymap = withSettings(settings([{ id: 'file.newFile', keybind: 'Mod+N' }], ['file.new Mod+N']));
    expect(keymap.settings()).toEqual(emptyKeybindSettings());
    expect(keymap.commandFor('Mod+N')?.id).toBe('file.newFile');
    expect(keymap.bindings().filter((b) => b.id === 'file.newFile' && b.keybind === 'Mod+N')).toHaveLength(1);
    // One that had lost its key to another command stays off, as a built-in.
    const lost = migrateKeybinds(settings([{ id: 'file.new', keybind: 'Mod+Shift+N', off: true }, { id: 'view.compileNow', keybind: 'Mod+Shift+N' }]), shortcuts);
    expect(lost).toEqual(settings([{ id: 'view.compileNow', keybind: 'Mod+Shift+N' }], ['file.new Mod+Shift+N']));
    // An odd saved mix, an on rule and its built-in off, ends up on.
    expect(migrateKeybinds(settings([{ id: 'file.newFile', keybind: 'Mod+N' }], ['file.newFile Mod+N']), shortcuts)).toEqual(emptyKeybindSettings());
  });

  it('lets a rule someone added keep a key a new default wants', () => {
    const keymap = withSettings(settings([{ id: 'view.compileNow', keybind: 'Mod+Shift+N' }]));
    expect(keymap.commandFor('Mod+Shift+N')?.id).toBe('view.compileNow');
    expect(keymap.settings().rules).toEqual([{ id: 'view.compileNow', keybind: 'Mod+Shift+N' }]);
  });

  it('runs on every load without changing its own output, and skips moves that do not apply', () => {
    const once = migrateKeybinds(settings([], ['file.new Mod+N']), shortcuts);
    expect(migrateKeybinds(once, shortcuts)).toEqual(once);
    // With the old key still built in, a turned-off key means what it says.
    const old = [{ id: 'file.new' as const, keybind: 'Mod+N' }];
    expect(migrateKeybinds(settings([], ['file.new Mod+N']), old)).toEqual(settings([], ['file.new Mod+N']));
  });
});
