import { createKeymap } from './keymap';
import { shortcuts } from './commands';

describe('createKeymap', () => {
  it('finds the command for a keybind, and the keybinds for a command', () => {
    const keymap = createKeymap(shortcuts, () => 'other');
    expect(keymap.commandFor('Mod+S')?.id).toBe('file.saveNow');
    expect(keymap.commandFor('Mod+C')).toEqual({ id: 'edit.copy', keybind: 'Mod+C', native: true });
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

  it('gives a key to the first command that lists it, and skips bad keybinds', () => {
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
  });
});
