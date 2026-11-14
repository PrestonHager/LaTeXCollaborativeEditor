import { commandIcon } from './icons';
import { keepOnScreen } from './keepOnScreen';

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
  /**
   * True on a phone, where CSS shows only the one-button menu (`[data-collapsed-menu]`) instead of
   * File, Edit, View and Help (#186). Left and Right then only step between the triggers that show.
   */
  isCollapsed?: () => boolean;
  /** False for a lone dropdown, like the toolbar's More menu, so Left and Right go to the toolbar instead. */
  arrowsBetweenMenus?: boolean;
};

/**
 * Fill the one-button phone menu with a copy of every other menu's items, grouped under its name.
 * Called before the items are wired, so the copies get the same icons, state and keys as the originals.
 */
function fillCollapsedMenu(root: HTMLElement) {
  const collapsed = root.querySelector<HTMLElement>('.menu-root[data-collapsed-menu]');
  const list = collapsed?.querySelector<HTMLElement>('[role="menu"]');
  if (!collapsed || !list || list.childElementCount) return;
  root.querySelectorAll<HTMLElement>('.menu-root:not([data-collapsed-menu])').forEach((menuRoot, index) => {
    const label = menuRoot.dataset.menuLabel ?? '';
    const source = menuRoot.querySelector('[role="menu"]');
    if (!source) return;
    if (index > 0) {
      const separator = document.createElement('hr');
      separator.setAttribute('role', 'separator');
      list.append(separator);
    }
    const group = document.createElement('div');
    group.setAttribute('role', 'group');
    group.className = 'menu-group';
    const heading = document.createElement('div');
    heading.className = 'menu-group-heading';
    heading.id = `${collapsed.id || 'menu-collapsed'}-${label.toLowerCase()}`;
    heading.textContent = label;
    // Screen readers say "File group" on the first item of each group, like moving into the File menu.
    heading.setAttribute('role', 'presentation');
    group.setAttribute('aria-labelledby', heading.id);
    group.append(heading);
    Array.from(source.children).forEach((child) => group.append(child.cloneNode(true)));
    list.append(group);
  });
}

/**
 * Wire up the Basecoat dropdown menus already in the page (see index.html).
 * Each `.menu-root` holds a `.menu-trigger` and a `[data-popover]` of `.menu-item[data-command]` buttons.
 */
export function createMenuBar(root: HTMLElement, options: MenuBarOptions) {
  const isCollapsed = options.isCollapsed ?? (() => false);
  const arrowsBetweenMenus = options.arrowsBetweenMenus ?? true;
  fillCollapsedMenu(root);
  // The root can be one menu on its own, like the toolbar's More menu, or a bar of them.
  const menuRoots = root.matches('.menu-root') ? [root] : Array.from(root.querySelectorAll<HTMLElement>('.menu-root'));
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

  /** The triggers on screen: the one Menu button on a phone, File to Help everywhere else. */
  const shownTriggers = () => {
    const collapsed = isCollapsed();
    return triggerButtons.filter((trigger) => (trigger.closest('[data-collapsed-menu]') !== null) === collapsed);
  };

  const moveTriggerFocus = (offset: number, currentTrigger: HTMLButtonElement) => {
    const triggers = shownTriggers();
    const index = triggers.indexOf(currentTrigger);
    if (index < 0) return;
    const nextIndex = (index + offset + triggers.length) % triggers.length;
    triggers[nextIndex]?.focus();
  };

  /** Move focus within a menu: by `offset` from the current item, or to the first or last item. */
  const moveMenuItemFocus = (menuLabel: string, currentItem: HTMLButtonElement, offset: number | 'first' | 'last') => {
    const items = menuItemByLabel.get(menuLabel) ?? [];
    const enabled = items.filter((item) => !item.disabled);
    const index = enabled.indexOf(currentItem);
    if (index < 0 || !enabled.length) return;
    const nextIndex = offset === 'first' ? 0 : offset === 'last' ? enabled.length - 1 : (index + offset + enabled.length) % enabled.length;
    enabled[nextIndex]?.focus();
  };

  /**
   * Keep an open menu inside the window (#186: at 390px the File menu ran 54px past the right edge).
   * The phone menu is a full-width sheet (style.css) that starts just under its button.
   */
  const placeMenu = (menuRoot: HTMLElement, popover: HTMLElement) => {
    if (menuRoot.hasAttribute('data-collapsed-menu')) {
      const trigger = menuRoot.querySelector<HTMLElement>('.menu-trigger');
      const bottom = trigger?.getBoundingClientRect().bottom ?? 0;
      popover.style.setProperty('--menu-top', `${Math.round(bottom + 4)}px`);
      return;
    }
    keepOnScreen(popover);
  };

  const updateOpenState = () => {
    menuRoots.forEach((menuRoot) => {
      const label = menuRoot.dataset.menuLabel ?? '';
      const isOpen = label === openMenuLabel;
      menuRoot.classList.toggle('is-open', isOpen);
      const trigger = menuRoot.querySelector<HTMLButtonElement>('.menu-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      // Basecoat shows and hides the popover from aria-hidden.
      const popover = menuRoot.querySelector<HTMLElement>('[data-popover]');
      if (popover) {
        popover.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        if (isOpen) placeMenu(menuRoot, popover);
      }
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

  menuRoots.forEach((menuRoot) => {
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
      if (arrowsBetweenMenus && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
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
      // The phone menu's items are copies, so the palette lists each command once.
      if (!menuRoot.hasAttribute('data-collapsed-menu')) entries.push({
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
        if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          moveMenuItemFocus(menuLabel, itemButton, event.key === 'Home' ? 'first' : 'last');
          return;
        }
        if (arrowsBetweenMenus && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
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
    /** Close any open menu, since the window crossed the phone breakpoint and the other set of triggers shows now. */
    closeMenus,
    destroy() {
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onDocumentKeyDown);
    },
  };
}
