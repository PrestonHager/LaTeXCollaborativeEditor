import { commandIcon } from './icons';

export type CommandId =
  | 'app.commandPalette'
  | 'app.openSettings'
  | 'app.editProfile'
  | 'file.new'
  | 'file.rename'
  | 'file.saveAsTemplate'
  | 'file.openLocal'
  | 'file.openDrive'
  | 'file.download'
  | 'file.connectDrive'
  | 'file.disconnectDrive'
  | 'file.saveToDrive'
  | 'file.moveDrive'
  | 'file.addFromDrive'
  | 'file.renameDrive'
  | 'file.saveNow'
  | 'file.clearLocalDocs'
  | 'file.newFile'
  | 'file.newFolder'
  | 'file.upload'
  | 'file.importZip'
  | 'file.downloadFile'
  | 'file.export'
  | 'share.copyLink'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.cut'
  | 'edit.copy'
  | 'edit.paste'
  | 'edit.selectAll'
  | 'view.toggleEditorTheme'
  | 'view.togglePreviewTheme'
  | 'view.darkMode'
  | 'view.lightMode'
  | 'view.systemTheme'
  | 'view.togglePauseSaving'
  | 'view.compileNow'
  | 'view.focusEditor'
  | 'view.layoutSplit'
  | 'view.layoutEditorOnly'
  | 'view.layoutPreviewOnly'
  | 'help.documentation'
  | 'help.shortcuts'
  | 'help.tour'
  | 'help.reportBug'
  | 'help.reportSecurity'
  | 'help.requestFeature'
  | 'help.about'
  | 'dev.openTestProject'
  | 'dev.openChecklist';

export type CommandState = {
  enabled: boolean;
  checked?: boolean;
  /** A label for right now, like "Undo Delete chapter.tex". Leave it out for the menu's own label. */
  label?: string;
};

/** A menu entry as read from the HTML, so the command palette can list the same commands. */
export type MenuEntry = {
  commandId: CommandId;
  label: string;
  section: string;
  /** The command's keybind label, like "Ctrl+S" or "⌘S", from the shortcut table. */
  shortcut?: string;
  /** What the command does, from the item's data-description, for the palette. */
  description?: string;
  /** False when the HTML marks the item `data-palette="false"`. */
  inPalette: boolean;
};

type MenuBarOptions = {
  getCommandState: (commandId: CommandId) => CommandState;
  onCommand: (commandId: CommandId) => void;
  /** The keybind label to show for a command, if it has one. */
  shortcutLabel?: (commandId: CommandId) => string | undefined;
};

/**
 * Wire up the Basecoat dropdown menus already in the page (see index.html).
 * Each `.menu-root` holds a `.menu-trigger` and a `[data-popover]` of `.menu-item[data-command]` buttons.
 */
export function createMenuBar(root: HTMLElement, options: MenuBarOptions) {
  const commandButtons = new Map<CommandId, HTMLButtonElement[]>();
  const triggerButtons: HTMLButtonElement[] = [];
  const menuItemByLabel = new Map<string, HTMLButtonElement[]>();
  const entries: MenuEntry[] = [];
  const shortcutEls: { commandId: CommandId; el: HTMLElement }[] = [];
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
      const isOpen = label === openMenuLabel;
      menuRoot.classList.toggle('is-open', isOpen);
      const trigger = menuRoot.querySelector<HTMLButtonElement>('.menu-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      // Basecoat shows and hides the popover from aria-hidden.
      const popover = menuRoot.querySelector<HTMLElement>('[data-popover]');
      if (popover) popover.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    });
  };

  const closeMenus = () => {
    openMenuLabel = null;
    updateOpenState();
  };

  /**
   * Open one menu and close the rest. `focus` says where keyboard focus goes:
   * the first enabled item (click or keyboard), or the menu's trigger (hover).
   */
  const openMenu = (menuLabel: string, focus: 'firstItem' | 'trigger') => {
    openMenuLabel = menuLabel;
    updateOpenState();
    if (focus === 'firstItem') {
      focusFirstEnabledItem(menuLabel);
      return;
    }
    // Hover only moves focus when it is already in the menu bar, so it never steals it from the editor.
    if (root.contains(document.activeElement)) {
      triggerButtons.find((button) => button.closest<HTMLElement>('.menu-root')?.dataset.menuLabel === menuLabel)?.focus();
    }
  };

  /** Arrow keys between menus: move to the next trigger, and keep a menu open if one was. */
  const stepMenu = (offset: number, currentTrigger: HTMLButtonElement) => {
    const wasOpen = openMenuLabel !== null;
    moveTriggerFocus(offset, currentTrigger);
    const focused = document.activeElement;
    const nextLabel = focused instanceof HTMLElement && focused.classList.contains('menu-trigger')
      ? focused.closest<HTMLElement>('.menu-root')?.dataset.menuLabel
      : undefined;
    if (wasOpen && nextLabel !== undefined) openMenu(nextLabel, 'firstItem');
  };

  root.querySelectorAll<HTMLElement>('.menu-root').forEach((menuRoot) => {
    const menuLabel = menuRoot.dataset.menuLabel ?? '';
    const trigger = menuRoot.querySelector<HTMLButtonElement>('.menu-trigger');
    if (!trigger) return;

    trigger.addEventListener('click', () => {
      if (openMenuLabel === menuLabel) closeMenus();
      else openMenu(menuLabel, 'firstItem');
    });
    // Once the menu bar is active (a menu is open), hovering another menu switches to it.
    // Hover only opens menus, it never runs a command. Touch is left to the click handler,
    // since a tap fires pointerenter right before click and would toggle the menu shut.
    trigger.addEventListener('pointerenter', (event) => {
      if ((event as PointerEvent).pointerType === 'touch') return;
      if (openMenuLabel === null || openMenuLabel === menuLabel) return;
      openMenu(menuLabel, 'trigger');
    });
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        stepMenu(event.key === 'ArrowRight' ? 1 : -1, trigger);
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openMenu(menuLabel, 'firstItem');
      }
    });
    triggerButtons.push(trigger);

    const items = Array.from(menuRoot.querySelectorAll<HTMLButtonElement>('.menu-item[data-command]'));
    menuItemByLabel.set(menuLabel, items);
    items.forEach((itemButton) => {
      const commandId = itemButton.dataset.command as CommandId;

      // First, fill in what the HTML leaves to us: the icon and a place for the shortcut text.
      itemButton.prepend(commandIcon(commandId));
      let shortcutEl = itemButton.querySelector<HTMLElement>('[data-shortcut]');
      if (!shortcutEl) {
        shortcutEl = document.createElement('span');
        shortcutEl.className = 'menu-item-shortcut';
        shortcutEl.dataset.shortcut = '';
        itemButton.append(shortcutEl);
      }
      shortcutEls.push({ commandId, el: shortcutEl });
      entries.push({
        commandId,
        label: itemButton.querySelector('.menu-item-label')?.textContent?.trim() ?? commandId,
        section: menuLabel,
        description: itemButton.dataset.description,
        inPalette: itemButton.dataset.palette !== 'false',
      });

      // Then hook up clicks and keyboard navigation.
      itemButton.addEventListener('click', () => {
        if (!options.getCommandState(commandId).enabled) return;
        options.onCommand(commandId);
        closeMenus();
      });
      itemButton.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeMenus();
          trigger.focus();
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          moveMenuItemFocus(menuLabel, itemButton, event.key === 'ArrowDown' ? 1 : -1);
          return;
        }
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          stepMenu(event.key === 'ArrowRight' ? 1 : -1, trigger);
        }
      });

      if (!commandButtons.has(commandId)) commandButtons.set(commandId, []);
      commandButtons.get(commandId)!.push(itemButton);
    });
  });

  const onDocumentClick = (event: MouseEvent) => {
    if (!root.contains(event.target as Node)) closeMenus();
  };
  document.addEventListener('click', onDocumentClick);
  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && openMenuLabel) closeMenus();
  };
  document.addEventListener('keydown', onDocumentKeyDown);

  const refresh = () => {
    commandButtons.forEach((buttons, commandId) => {
      const state = options.getCommandState(commandId);
      buttons.forEach((button) => {
        button.disabled = !state.enabled;
        button.setAttribute('aria-disabled', state.enabled ? 'false' : 'true');
        button.classList.toggle('is-checked', Boolean(state.checked));
        const label = button.querySelector<HTMLElement>('.menu-item-label');
        if (label) {
          label.dataset.label ??= label.textContent ?? '';
          label.textContent = state.label ?? label.dataset.label;
        }
        // Checkbox items are marked in the HTML, we only flip their state.
        if (button.getAttribute('role') === 'menuitemcheckbox') {
          button.setAttribute('aria-checked', state.checked ? 'true' : 'false');
        }
      });
    });
  };

  /** Show each item's keybind from the shortcut table. Call again when the keybinds change. */
  const refreshShortcuts = () => {
    shortcutEls.forEach(({ commandId, el }) => {
      el.textContent = options.shortcutLabel?.(commandId) ?? '';
    });
  };

  refresh();
  refreshShortcuts();

  return {
    refresh,
    refreshShortcuts,
    /** Every menu item in page order, for building the command palette. */
    entries: (): MenuEntry[] => entries.map((entry) => ({ ...entry, shortcut: options.shortcutLabel?.(entry.commandId) })),
    destroy() {
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onDocumentKeyDown);
    },
  };
}
