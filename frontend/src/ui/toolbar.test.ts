import { createToolbar, phonePlace, PHONE_TOOLBAR_KEEP } from './toolbar';
import { mountAppShell } from '../test/appShell';
import type { CommandId } from './menuBar';
import { createKeymap } from '../app/keymap';
import { shortcuts } from '../app/commands';

describe('createToolbar', () => {
  const setup = (disabled: CommandId[] = [], platform: 'mac' | 'other' = 'other', phone = { on: false }) => {
    mountAppShell();
    const keymap = createKeymap(shortcuts, () => platform);
    const root = document.getElementById('toolbar')!;
    const calls: CommandId[] = [];
    const toolbar = createToolbar(root, {
      getCommandState: (id) => ({ enabled: !disabled.includes(id), checked: id === 'view.layoutSplit' ? true : undefined }),
      onCommand: (id) => calls.push(id),
      shortcutLabel: (id) => keymap.labelFor(id),
      isCollapsed: () => phone.on,
    });
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(':scope > button[data-command]'));
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

  describe('on a phone (#186)', () => {
    const more = () => document.querySelector<HTMLButtonElement>('.toolbar-more .menu-trigger')!;
    const moreItems = () => Array.from(document.querySelectorAll<HTMLButtonElement>('#toolbar-more-menu .menu-item'));
    const press = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

    it('keeps compile and share, hides the layout buttons, and moves the rest to More', () => {
      const { buttons } = setup();
      const place = Object.fromEntries(buttons.map((button) => [button.dataset.command, button.dataset.phonePlace]));
      expect(place).toEqual({
        'file.newFile': 'more',
        'file.upload': 'more',
        'file.saveNow': 'more',
        'view.compileNow': 'bar',
        'file.export': 'more',
        'share.copyLink': 'bar',
        'view.layoutSplit': 'hidden',
        'view.layoutEditorOnly': 'hidden',
        'view.layoutPreviewOnly': 'hidden',
        'app.commandPalette': 'more',
        'help.documentation': 'more',
      });
      expect(PHONE_TOOLBAR_KEEP.map(phonePlace)).toEqual(['bar', 'bar']);
      // Every action that leaves the bar is in More, in toolbar order, so nothing becomes unreachable.
      const overflow = buttons.filter((button) => button.dataset.phonePlace === 'more').map((button) => button.dataset.command);
      expect(moreItems().map((item) => item.dataset.command)).toEqual(overflow);
      expect(moreItems().map((item) => item.querySelector('.menu-item-label')!.textContent)).toEqual(['New file', 'Upload files', 'Save now', 'Export', 'Command palette', 'Documentation']);
      // The same keybinds as the menus.
      expect(moreItems().find((item) => item.dataset.command === 'file.saveNow')!.querySelector('[data-shortcut]')!.textContent).toBe('Ctrl+S');
      moreItems().forEach((item) => {
        expect(item.getAttribute('role')).toBe('menuitem');
        expect(item.querySelector('svg')).toBeTruthy();
      });
    });

    it('runs the command from More, and disables the same items as the toolbar', () => {
      const { calls } = setup(['file.saveNow']);
      more().click();
      expect(more().getAttribute('aria-expanded')).toBe('true');
      const save = moreItems().find((item) => item.dataset.command === 'file.saveNow')!;
      expect(save.disabled).toBe(true);
      save.click();
      expect(calls).toEqual([]);
      moreItems().find((item) => item.dataset.command === 'file.export')!.click();
      expect(calls).toEqual(['file.export']);
      expect(more().getAttribute('aria-expanded')).toBe('false');
    });

    it('steps through only the buttons that show, then More, with the arrow keys', () => {
      const phone = { on: true };
      const { root, toolbar } = setup([], 'other', phone);
      toolbar.viewportChanged();
      const compile = root.querySelector<HTMLButtonElement>('[data-command="view.compileNow"]')!;
      const share = root.querySelector<HTMLButtonElement>(':scope > [data-command="share.copyLink"]')!;
      expect(compile.tabIndex).toBe(0);
      compile.focus();
      press(compile, 'ArrowRight');
      expect(document.activeElement).toBe(share);
      press(share, 'ArrowRight');
      expect(document.activeElement).toBe(more());
      expect(more().tabIndex).toBe(0);
      press(more(), 'ArrowRight');
      expect(document.activeElement).toBe(compile);
      press(compile, 'End');
      expect(document.activeElement).toBe(more());

      // More opens like a menu bar menu: Down opens it on the first item, Escape goes back to More.
      press(more(), 'ArrowDown');
      expect(document.activeElement).toBe(moreItems()[0]);
      press(moreItems()[0], 'End');
      expect(document.activeElement).toBe(moreItems().at(-1));
      // Left and Right inside the menu don't move along the toolbar.
      press(moreItems().at(-1)!, 'ArrowRight');
      expect(document.activeElement).toBe(moreItems().at(-1));
      press(moreItems().at(-1)!, 'Escape');
      expect(document.activeElement).toBe(more());
      expect(more().getAttribute('aria-expanded')).toBe('false');

      // Back to a wide window: the tab stop moves off More, which is hidden there.
      phone.on = false;
      press(more(), 'ArrowDown');
      toolbar.viewportChanged();
      expect(more().getAttribute('aria-expanded')).toBe('false');
      expect(more().tabIndex).toBe(-1);
      expect(root.querySelector<HTMLButtonElement>('[data-command="file.newFile"]')!.tabIndex).toBe(0);
    });

    it('works without a More menu in the page', () => {
      document.body.innerHTML = '<div id="bare" role="toolbar"><button data-command="file.saveNow" data-tooltip="Save now"></button></div>';
      const root = document.getElementById('bare')!;
      const toolbar = createToolbar(root, { getCommandState: () => ({ enabled: true }), onCommand: () => {}, isCollapsed: () => true });
      toolbar.viewportChanged();
      toolbar.refresh();
      toolbar.refreshShortcuts();
      expect(root.querySelector('button')!.dataset.phonePlace).toBe('more');
    });
  });
});
