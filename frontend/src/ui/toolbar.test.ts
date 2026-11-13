import { createToolbar } from './toolbar';
import { mountAppShell } from '../test/appShell';
import type { CommandId } from './menuBar';
import { createKeymap } from '../app/keymap';
import { shortcuts } from '../app/commands';

describe('createToolbar', () => {
  const setup = (disabled: CommandId[] = [], platform: 'mac' | 'other' = 'other') => {
    mountAppShell();
    const keymap = createKeymap(shortcuts, () => platform);
    const root = document.getElementById('toolbar')!;
    const calls: CommandId[] = [];
    const toolbar = createToolbar(root, {
      getCommandState: (id) => ({ enabled: !disabled.includes(id), checked: id === 'view.layoutSplit' ? true : undefined }),
      onCommand: (id) => calls.push(id),
      shortcutLabel: (id) => keymap.labelFor(id),
    });
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-command]'));
    return { root, toolbar, calls, buttons };
  };

  it('covers the common actions with labeled icon buttons', () => {
    const { buttons } = setup();
    const ids = buttons.map((button) => button.dataset.command);
    expect(ids).toEqual(expect.arrayContaining(['file.newFile', 'file.upload', 'file.saveNow', 'view.compileNow', 'share.copyLink']));
    buttons.forEach((button) => {
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.dataset.tooltip).toBeTruthy();
      expect(button.querySelector('svg')).toBeTruthy();
    });
    const save = buttons.find((button) => button.dataset.command === 'file.saveNow')!;
    expect(save.dataset.tooltip).toBe('Save now (Ctrl+S)');
    const compile = buttons.find((button) => button.dataset.command === 'view.compileNow')!;
    expect(compile.dataset.tooltip).toBe('Compile now (Ctrl+Enter)');
    // Buttons without a keybind keep just their text.
    const upload = buttons.find((button) => button.dataset.command === 'file.upload')!;
    expect(upload.dataset.tooltip).not.toContain('(');
  });

  it('shows Mac keybinds on a Mac, and refreshes them when asked', () => {
    const { buttons, toolbar } = setup([], 'mac');
    const save = buttons.find((button) => button.dataset.command === 'file.saveNow')!;
    expect(save.dataset.tooltip).toBe('Save now (⌘S)');
    toolbar.refreshShortcuts();
    expect(save.dataset.tooltip).toBe('Save now (⌘S)');
  });

  it('runs commands, but not disabled ones', () => {
    const { calls, buttons, toolbar } = setup(['file.saveNow']);
    const byId = (id: string) => buttons.find((button) => button.dataset.command === id)!;
    byId('view.compileNow').click();
    byId('file.saveNow').click();
    expect(calls).toEqual(['view.compileNow']);
    expect(byId('file.saveNow').getAttribute('aria-disabled')).toBe('true');
    expect(byId('view.layoutSplit').getAttribute('aria-pressed')).toBe('true');
    expect(byId('file.upload').hasAttribute('aria-pressed')).toBe(false);
    toolbar.refresh();
  });

  it('keeps one button in the tab order and moves with the arrow keys', () => {
    const { root, buttons } = setup();
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    expect(buttons[0].tabIndex).toBe(0);
    const press = (key: string) => root.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    press('ArrowRight');
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons[1].tabIndex).toBe(0);
    expect(buttons[0].tabIndex).toBe(-1);
    press('ArrowLeft');
    press('ArrowLeft');
    expect(document.activeElement).toBe(buttons.at(-1));
    press('Home');
    expect(document.activeElement).toBe(buttons[0]);
    press('End');
    expect(document.activeElement).toBe(buttons.at(-1));
    press('a');
    expect(document.activeElement).toBe(buttons.at(-1));
  });
});
