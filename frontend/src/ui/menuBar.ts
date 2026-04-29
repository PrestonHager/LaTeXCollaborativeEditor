export type CommandId =
  | 'app.commandPalette'
  | 'file.new'
  | 'file.openLocal'
  | 'file.openDrive'
  | 'file.download'
  | 'file.connectDrive'
  | 'file.saveToDrive'
  | 'file.moveDrive'
  | 'file.renameDrive'
  | 'file.saveNow'
  | 'file.clearLocalDocs'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.cut'
  | 'edit.copy'
  | 'edit.paste'
  | 'edit.selectAll'
  | 'view.toggleSaveNow'
  | 'view.compileNow'
  | 'help.shortcuts'
  | 'help.about';

export type CommandState = {
  enabled: boolean;
  checked?: boolean;
};

type MenuItem = {
  commandId: CommandId;
  label: string;
  shortcut?: string;
};

type MenuConfig = {
  label: string;
  items: MenuItem[];
};

type MenuBarOptions = {
  menus: MenuConfig[];
  getCommandState: (commandId: CommandId) => CommandState;
  onCommand: (commandId: CommandId) => void;
};

export function createMenuBar(container: HTMLElement, options: MenuBarOptions) {
  const root = document.createElement('div');
  root.className = 'menu-bar';
  root.setAttribute('role', 'menubar');
  container.appendChild(root);

  const commandButtons = new Map<CommandId, HTMLButtonElement[]>();
  const triggerButtons: HTMLButtonElement[] = [];
  const menuItemByLabel = new Map<string, HTMLButtonElement[]>();
  let openMenuLabel: string | null = null;

  const focusFirstEnabledItem = (menuLabel: string) => {
    const items = menuItemByLabel.get(menuLabel) ?? [];
    const target = items.find((item) => !item.disabled);
    target?.focus();
  };

  const moveTriggerFocus = (offset: number, currentTrigger: HTMLButtonElement) => {
    const index = triggerButtons.indexOf(currentTrigger);
    if (index < 0) return;
    const nextIndex = (index + offset + triggerButtons.length) % triggerButtons.length;
    triggerButtons[nextIndex]?.focus();
  };

  const moveMenuItemFocus = (menuLabel: string, currentItem: HTMLButtonElement, offset: number) => {
    const items = menuItemByLabel.get(menuLabel) ?? [];
    const enabled = items.filter((item) => !item.disabled);
    const index = enabled.indexOf(currentItem);
    if (index < 0 || !enabled.length) return;
    const nextIndex = (index + offset + enabled.length) % enabled.length;
    enabled[nextIndex]?.focus();
  };

  const updateOpenState = () => {
    root.querySelectorAll<HTMLElement>('.menu-root').forEach((menuRoot) => {
      const label = menuRoot.dataset.menuLabel ?? '';
      menuRoot.classList.toggle('is-open', label === openMenuLabel);
      const trigger = menuRoot.querySelector<HTMLButtonElement>('.menu-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', openMenuLabel === label ? 'true' : 'false');
    });
  };

  options.menus.forEach((menu) => {
    const menuRoot = document.createElement('div');
    menuRoot.className = 'menu-root';
    menuRoot.dataset.menuLabel = menu.label;

    const trigger = document.createElement('button');
    trigger.className = 'menu-trigger';
    trigger.type = 'button';
    trigger.textContent = menu.label;
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.onclick = () => {
      openMenuLabel = openMenuLabel === menu.label ? null : menu.label;
      updateOpenState();
      if (openMenuLabel === menu.label) focusFirstEnabledItem(menu.label);
    };
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveTriggerFocus(1, trigger);
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveTriggerFocus(-1, trigger);
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openMenuLabel = menu.label;
        updateOpenState();
        focusFirstEnabledItem(menu.label);
      }
    });
    triggerButtons.push(trigger);

    const list = document.createElement('div');
    list.className = 'menu-list';
    list.setAttribute('role', 'menu');

    menu.items.forEach((item) => {
      const itemButton = document.createElement('button');
      itemButton.className = 'menu-item';
      itemButton.type = 'button';
      itemButton.setAttribute('role', 'menuitem');

      const labelSpan = document.createElement('span');
      labelSpan.className = 'menu-item-label';
      labelSpan.textContent = item.label;

      const shortcutSpan = document.createElement('span');
      shortcutSpan.className = 'menu-item-shortcut';
      shortcutSpan.textContent = item.shortcut ?? '';

      itemButton.append(labelSpan, shortcutSpan);
      itemButton.onclick = () => {
        const state = options.getCommandState(item.commandId);
        if (!state.enabled) return;
        options.onCommand(item.commandId);
        openMenuLabel = null;
        updateOpenState();
      };
      itemButton.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          openMenuLabel = null;
          updateOpenState();
          trigger.focus();
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          moveMenuItemFocus(menu.label, itemButton, 1);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          moveMenuItemFocus(menu.label, itemButton, -1);
          return;
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          moveTriggerFocus(1, trigger);
          const focused = document.activeElement as HTMLButtonElement | null;
          if (focused?.classList.contains('menu-trigger')) {
            focused.click();
          }
          return;
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          moveTriggerFocus(-1, trigger);
          const focused = document.activeElement as HTMLButtonElement | null;
          if (focused?.classList.contains('menu-trigger')) {
            focused.click();
          }
        }
      });

      if (!commandButtons.has(item.commandId)) commandButtons.set(item.commandId, []);
      commandButtons.get(item.commandId)!.push(itemButton);
      if (!menuItemByLabel.has(menu.label)) menuItemByLabel.set(menu.label, []);
      menuItemByLabel.get(menu.label)!.push(itemButton);
      list.appendChild(itemButton);
    });

    menuRoot.append(trigger, list);
    root.appendChild(menuRoot);
  });

  const onDocumentClick = (event: MouseEvent) => {
    if (!root.contains(event.target as Node)) {
      openMenuLabel = null;
      updateOpenState();
    }
  };
  document.addEventListener('click', onDocumentClick);
  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !openMenuLabel) return;
    openMenuLabel = null;
    updateOpenState();
  };
  document.addEventListener('keydown', onDocumentKeyDown);

  const refresh = () => {
    commandButtons.forEach((buttons, commandId) => {
      const state = options.getCommandState(commandId);
      buttons.forEach((button) => {
        button.disabled = !state.enabled;
        button.setAttribute('aria-disabled', state.enabled ? 'false' : 'true');
        button.classList.toggle('is-checked', Boolean(state.checked));
      });
    });
  };

  refresh();

  return {
    refresh,
    destroy() {
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onDocumentKeyDown);
      root.remove();
    },
  };
}
