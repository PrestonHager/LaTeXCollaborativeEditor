import { createMenuBar, type CommandId } from './menuBar';

type TestMenu = { label: string; items: { commandId: CommandId; label: string; shortcut?: string; checkable?: boolean }[] };

/** Write the same Basecoat menu markup index.html uses into container. */
function withMenus(container: HTMLElement, menus: TestMenu[]) {
  container.innerHTML = menus
    .map((menu, index) => {
      const items = menu.items
        .map((item) => {
          const role = item.checkable ? 'role="menuitemcheckbox" aria-checked="false"' : 'role="menuitem"';
          const chord = item.shortcut ? `<span class="menu-item-shortcut" data-shortcut></span>` : '';
          return `<button type="button" class="menu-item" ${role} data-command="${item.commandId}"><span class="menu-item-label">${item.label}</span>${chord}</button>`;
        })
        .join('');
      return `<div class="menu-root dropdown-menu" data-menu-label="${menu.label}">
        <button type="button" class="menu-trigger btn" aria-haspopup="menu" aria-controls="menu-${index}" aria-expanded="false">${menu.label}</button>
        <div id="menu-${index}" class="menu-popover" data-popover aria-hidden="true"><div class="menu-list" role="menu">${items}</div></div>
      </div>`;
    })
    .join('');
  return container;
}

describe('createMenuBar', () => {
  it('renders menus and dispatches enabled command clicks', () => {
    const container = document.createElement('div');
    const calls: CommandId[] = [];
    const enabled = new Map<CommandId, boolean>([
      ['file.new', true],
      ['edit.undo', false],
    ]);

    const menuBar = createMenuBar(withMenus(container, [
        {
          label: 'File',
          items: [{ commandId: 'file.new', label: 'New', shortcut: 'Ctrl+N' }],
        },
        {
          label: 'Edit',
          items: [{ commandId: 'edit.undo', label: 'Undo', shortcut: 'Ctrl+Z' }],
        },
      ]), {
      getCommandState: (commandId) => ({ enabled: enabled.get(commandId) ?? true }),
      onCommand: (commandId) => calls.push(commandId),
    });

    const triggers = Array.from(container.querySelectorAll('.menu-trigger')) as HTMLButtonElement[];
    triggers[0].click();
    const newItem = container.querySelector('.menu-item') as HTMLButtonElement;
    expect(newItem.disabled).toBe(false);
    newItem.click();
    expect(calls).toEqual(['file.new']);

    triggers[1].click();
    const items = Array.from(container.querySelectorAll('.menu-item')) as HTMLButtonElement[];
    const undoItem = items[1];
    expect(undoItem.disabled).toBe(true);
    undoItem.click();
    expect(calls).toEqual(['file.new']);
    menuBar.destroy();
  });

  it('supports keyboard navigation between triggers and menu items', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const calls: CommandId[] = [];

    const menuBar = createMenuBar(withMenus(container, [
        {
          label: 'File',
          items: [
            { commandId: 'file.new', label: 'New' },
            { commandId: 'file.download', label: 'Download' },
          ],
        },
        {
          label: 'Edit',
          items: [{ commandId: 'edit.undo', label: 'Undo' }],
        },
      ]), {
      getCommandState: () => ({ enabled: true }),
      onCommand: (commandId) => calls.push(commandId),
    });

    const triggers = Array.from(container.querySelectorAll('.menu-trigger')) as HTMLButtonElement[];
    triggers[0].focus();
    triggers[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const firstItem = container.querySelector('.menu-root.is-open .menu-item') as HTMLButtonElement;
    expect(document.activeElement).toBe(firstItem);

    firstItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const activeEditItem = container.querySelector('.menu-root.is-open .menu-item') as HTMLButtonElement;
    expect(activeEditItem.textContent).toContain('Undo');

    triggers[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const editItem = container.querySelector('.menu-root.is-open .menu-item') as HTMLButtonElement;
    editItem.click();
    expect(calls).toContain('edit.undo');
    menuBar.destroy();
    container.remove();
  });

  it('closes open menu on Escape at document level', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const menuBar = createMenuBar(withMenus(container, [{ label: 'File', items: [{ commandId: 'file.new', label: 'New' }] }]), {
      getCommandState: () => ({ enabled: true }),
      onCommand: () => {},
    });
    const trigger = container.querySelector('.menu-trigger') as HTMLButtonElement;
    trigger.click();
    expect(container.querySelector('.menu-root.is-open')).toBeTruthy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(container.querySelector('.menu-root.is-open')).toBeFalsy();
    menuBar.destroy();
    container.remove();
  });

  it('closes menu when clicking outside the menubar', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const menuBar = createMenuBar(withMenus(container, [{ label: 'File', items: [{ commandId: 'file.new', label: 'New' }] }]), {
      getCommandState: () => ({ enabled: true }),
      onCommand: () => {},
    });
    (container.querySelector('.menu-trigger') as HTMLButtonElement).click();
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(container.querySelector('.menu-root.is-open')).toBeFalsy();
    menuBar.destroy();
    outside.remove();
    container.remove();
  });

  it('wraps ArrowUp/ArrowDown between enabled items', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const menuBar = createMenuBar(withMenus(container, [
        {
          label: 'File',
          items: [
            { commandId: 'file.new', label: 'New' },
            { commandId: 'file.download', label: 'Download' },
          ],
        },
      ]), {
      getCommandState: () => ({ enabled: true }),
      onCommand: () => {},
    });
    const trigger = container.querySelector('.menu-trigger') as HTMLButtonElement;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const items = Array.from(container.querySelectorAll('.menu-item')) as HTMLButtonElement[];
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[0]);
    menuBar.destroy();
    container.remove();
  });

  it('moves trigger focus with ArrowLeft and opens menu with Space', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const menuBar = createMenuBar(withMenus(container, [
        { label: 'File', items: [{ commandId: 'file.new', label: 'New' }] },
        { label: 'Edit', items: [{ commandId: 'edit.undo', label: 'Undo' }] },
      ]), {
      getCommandState: () => ({ enabled: true }),
      onCommand: () => {},
    });
    const triggers = Array.from(container.querySelectorAll('.menu-trigger')) as HTMLButtonElement[];
    triggers[1].focus();
    triggers[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.activeElement).toBe(triggers[0]);
    triggers[0].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(container.querySelector('.menu-root.is-open .menu-item')).toBeTruthy();
    menuBar.destroy();
    container.remove();
  });

  it('Escape on menu item closes menu and returns focus to trigger', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const menuBar = createMenuBar(withMenus(container, [{ label: 'File', items: [{ commandId: 'file.new', label: 'New' }] }]), {
      getCommandState: () => ({ enabled: true }),
      onCommand: () => {},
    });
    const trigger = container.querySelector('.menu-trigger') as HTMLButtonElement;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const item = container.querySelector('.menu-item') as HTMLButtonElement;
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(container.querySelector('.menu-root.is-open')).toBeFalsy();
    expect(document.activeElement).toBe(trigger);
    menuBar.destroy();
    container.remove();
  });

  it('ArrowLeft from item moves to previous trigger and opens its menu', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const menuBar = createMenuBar(withMenus(container, [
        { label: 'File', items: [{ commandId: 'file.new', label: 'New' }] },
        { label: 'Edit', items: [{ commandId: 'edit.undo', label: 'Undo' }] },
      ]), {
      getCommandState: () => ({ enabled: true }),
      onCommand: () => {},
    });
    const triggers = Array.from(container.querySelectorAll('.menu-trigger')) as HTMLButtonElement[];
    triggers[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const editItem = container.querySelector('.menu-root.is-open .menu-item') as HTMLButtonElement;
    editItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    const fileOpen = container.querySelectorAll('.menu-root.is-open')[0];
    expect(fileOpen?.querySelector('.menu-item')?.textContent).toContain('New');
    menuBar.destroy();
    container.remove();
  });

  describe('hover switching', () => {
    const setup = () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const calls: CommandId[] = [];
      const menuBar = createMenuBar(withMenus(container, [
          { label: 'File', items: [{ commandId: 'file.new', label: 'New' }] },
          { label: 'Edit', items: [{ commandId: 'edit.undo', label: 'Undo' }] },
          { label: 'View', items: [{ commandId: 'view.compileNow', label: 'Compile' }] },
        ]), {
        getCommandState: () => ({ enabled: true }),
        onCommand: (id) => calls.push(id),
      });
      const triggers = Array.from(container.querySelectorAll('.menu-trigger')) as HTMLButtonElement[];
      const openLabels = () => Array.from(container.querySelectorAll<HTMLElement>('.menu-root.is-open')).map((el) => el.dataset.menuLabel);
      const hover = (el: HTMLElement, pointerType = 'mouse') => {
        const event = new Event('pointerenter');
        Object.defineProperty(event, 'pointerType', { value: pointerType });
        el.dispatchEvent(event);
      };
      const cleanup = () => {
        menuBar.destroy();
        container.remove();
      };
      return { container, calls, triggers, openLabels, hover, cleanup };
    };

    it('does nothing when no menu is open', () => {
      const { triggers, openLabels, hover, cleanup } = setup();
      hover(triggers[1]);
      expect(openLabels()).toEqual([]);
      cleanup();
    });

    it('switches the open menu to the hovered one and updates ARIA and focus', () => {
      const { triggers, openLabels, hover, calls, cleanup } = setup();
      triggers[0].click();
      expect(openLabels()).toEqual(['File']);
      hover(triggers[1]);
      expect(openLabels()).toEqual(['Edit']);
      expect(triggers[0].getAttribute('aria-expanded')).toBe('false');
      expect(triggers[1].getAttribute('aria-expanded')).toBe('true');
      expect(document.getElementById('menu-0')?.getAttribute('aria-hidden')).toBe('true');
      expect(document.getElementById('menu-1')?.getAttribute('aria-hidden')).toBe('false');
      expect(document.activeElement).toBe(triggers[1]);
      // Hovering only opens menus, it never runs a command.
      expect(calls).toEqual([]);
      cleanup();
    });

    it('hovering the already-open menu keeps it open and focus where it is', () => {
      const { triggers, openLabels, hover, cleanup } = setup();
      triggers[0].click();
      const item = document.activeElement;
      hover(triggers[0]);
      expect(openLabels()).toEqual(['File']);
      expect(document.activeElement).toBe(item);
      cleanup();
    });

    it('ignores touch pointerenter so a tap does not open then toggle shut', () => {
      const { triggers, openLabels, hover, cleanup } = setup();
      triggers[0].click();
      hover(triggers[1], 'touch');
      expect(openLabels()).toEqual(['File']);
      triggers[1].click();
      expect(openLabels()).toEqual(['Edit']);
      cleanup();
    });

    it('does not move focus out of the editor when switching by hover', () => {
      const { triggers, openLabels, hover, cleanup } = setup();
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      triggers[0].click();
      outside.focus();
      hover(triggers[2]);
      expect(openLabels()).toEqual(['View']);
      expect(document.activeElement).toBe(outside);
      outside.remove();
      cleanup();
    });

    it('arrow keys still switch menus after a hover switch', () => {
      const { triggers, openLabels, hover, cleanup } = setup();
      triggers[0].click();
      hover(triggers[1]);
      triggers[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      expect(openLabels()).toEqual(['View']);
      expect((document.activeElement as HTMLElement).textContent).toContain('Compile');
      (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      expect(openLabels()).toEqual(['File']);
      triggers[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
      expect(openLabels()).toEqual(['View']);
      cleanup();
    });

    it('arrow keys on a trigger with no open menu only move focus', () => {
      const { triggers, openLabels, cleanup } = setup();
      triggers[0].focus();
      triggers[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(triggers[1]);
      expect(openLabels()).toEqual([]);
      cleanup();
    });
  });

  it('focuses first enabled item when leading items are disabled', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const enabled = new Map([
      ['file.new', false],
      ['file.download', true],
    ]);
    const menuBar = createMenuBar(withMenus(container, [
        {
          label: 'File',
          items: [
            { commandId: 'file.new', label: 'New' },
            { commandId: 'file.download', label: 'Download' },
          ],
        },
      ]), {
      getCommandState: (id) => ({ enabled: enabled.get(id) ?? true }),
      onCommand: () => {},
    });
    (container.querySelector('.menu-trigger') as HTMLButtonElement).click();
    const items = Array.from(container.querySelectorAll('.menu-item')) as HTMLButtonElement[];
    expect(items[0].disabled).toBe(true);
    expect(document.activeElement).toBe(items[1]);
    menuBar.destroy();
    container.remove();
  });

  it('refresh toggles checked styling from command state', () => {
    const container = document.createElement('div');
    let checked = false;
    const menuBar = createMenuBar(withMenus(container, [{ label: 'View', items: [{ commandId: 'view.toggleEditorTheme', label: 'Theme' }] }]), {
      getCommandState: () => ({ enabled: true, checked }),
      onCommand: () => {},
    });
    const item = container.querySelector('.menu-item') as HTMLButtonElement;
    expect(item.classList.contains('is-checked')).toBe(false);
    checked = true;
    menuBar.refresh();
    expect(item.classList.contains('is-checked')).toBe(true);
    menuBar.destroy();
  });

  it('toggles same trigger click to close menu', () => {
    const container = document.createElement('div');
    const menuBar = createMenuBar(withMenus(container, [{ label: 'File', items: [{ commandId: 'file.new', label: 'New' }] }]), {
      getCommandState: () => ({ enabled: true }),
      onCommand: () => {},
    });
    const trigger = container.querySelector('.menu-trigger') as HTMLButtonElement;
    trigger.click();
    expect(container.querySelector('.menu-root.is-open')).toBeTruthy();
    trigger.click();
    expect(container.querySelector('.menu-root.is-open')).toBeFalsy();
    menuBar.destroy();
  });

  it('uses Basecoat dropdown markup and shows the popover only while open', () => {
    const container = document.createElement('div');
    const labels: Partial<Record<CommandId, string>> = { 'file.new': 'Ctrl+N' };
    const menuBar = createMenuBar(withMenus(container, [{ label: 'File', items: [{ commandId: 'file.new', label: 'New', shortcut: 'N' }] }]), {
      getCommandState: () => ({ enabled: true }),
      onCommand: () => {},
      shortcutLabel: (id) => labels[id],
    });
    const trigger = container.querySelector('.menu-trigger') as HTMLButtonElement;
    const popover = container.querySelector('[data-popover]') as HTMLElement;
    expect(container.querySelector('.dropdown-menu')).toBeTruthy();
    expect(trigger.classList.contains('btn')).toBe(true);
    expect(trigger.getAttribute('aria-controls')).toBe(popover.id);
    expect(popover.getAttribute('aria-hidden')).toBe('true');
    trigger.click();
    expect(popover.getAttribute('aria-hidden')).toBe('false');
    const item = container.querySelector('.menu-item') as HTMLButtonElement;
    expect(item.querySelector('svg')).toBeTruthy();
    expect(item.querySelector('[data-shortcut]')?.textContent).toBe('Ctrl+N');
    expect(menuBar.entries()).toEqual([
      { commandId: 'file.new', label: 'New', section: 'File', shortcut: 'Ctrl+N', inPalette: true },
    ]);
    // A changed keybind shows up once the labels are refreshed.
    labels['file.new'] = '⌘N';
    menuBar.refreshShortcuts();
    expect(item.querySelector('[data-shortcut]')?.textContent).toBe('⌘N');
    expect(menuBar.entries()[0].shortcut).toBe('⌘N');
    menuBar.destroy();
  });

  it('flips aria-checked on checkbox items only', () => {
    const container = document.createElement('div');
    let checked = false;
    const menuBar = createMenuBar(
      withMenus(container, [
        {
          label: 'View',
          items: [
            { commandId: 'view.layoutSplit', label: 'Split View', checkable: true },
            { commandId: 'view.compileNow', label: 'Compile Now' },
          ],
        },
      ]),
      {
        getCommandState: () => ({ enabled: true, checked }),
        onCommand: () => {},
      },
    );
    const [checkItem, plainItem] = Array.from(container.querySelectorAll<HTMLButtonElement>('.menu-item'));
    expect(checkItem.getAttribute('aria-checked')).toBe('false');
    checked = true;
    menuBar.refresh();
    expect(checkItem.getAttribute('aria-checked')).toBe('true');
    expect(plainItem.hasAttribute('aria-checked')).toBe(false);
    menuBar.destroy();
  });
});
