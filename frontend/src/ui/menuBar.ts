import { commandIcon } from './icons';
import { formatPrimaryChord } from './modifierShortcutLabels';

export type CommandId =
  | 'app.commandPalette'
  | 'app.openSettings'
  | 'file.new'
  | 'file.rename'
  | 'file.openLocal'
  | 'file.openDrive'
  | 'file.download'
  | 'file.connectDrive'
  | 'file.disconnectDrive'
  | 'file.saveToDrive'
  | 'file.moveDrive'
  | 'file.renameDrive'
  | 'file.saveNow'
  | 'file.clearLocalDocs'
  | 'file.newFile'
  | 'file.newFolder'
  | 'file.upload'
  | 'file.importZip'
  | 'file.downloadFile'
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
};

/** A menu entry as read from the HTML, so the command palette can list the same commands. */
export type MenuEntry = {
  commandId: CommandId;
  label: string;
  section: string;
  shortcut?: string;
  /** What the command does, from the item's data-description, for the palette. */
  description?: string;
  /** False when the HTML marks the item `data-palette="false"`. */
  inPalette: boolean;
};

type MenuBarOptions = {
  getCommandState: (commandId: CommandId) => CommandState;
  onCommand: (commandId: CommandId) => void;
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

  root.querySelectorAll<HTMLElement>('.menu-root').forEach((menuRoot) => {
    const menuLabel = menuRoot.dataset.menuLabel ?? '';
    const trigger = menuRoot.querySelector<HTMLButtonElement>('.menu-trigger');
    if (!trigger) return;

    trigger.addEventListener('click', () => {
      openMenuLabel = openMenuLabel === menuLabel ? null : menuLabel;
      updateOpenState();
      if (openMenuLabel === menuLabel) focusFirstEnabledItem(menuLabel);
    });
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
        openMenuLabel = menuLabel;
        updateOpenState();
        focusFirstEnabledItem(menuLabel);
      }
    });
    triggerButtons.push(trigger);

    const items = Array.from(menuRoot.querySelectorAll<HTMLButtonElement>('.menu-item[data-command]'));
    menuItemByLabel.set(menuLabel, items);
    items.forEach((itemButton) => {
      const commandId = itemButton.dataset.command as CommandId;

      // First, fill in what the HTML leaves to us: the icon and the platform's shortcut text.
      itemButton.prepend(commandIcon(commandId));
      const shortcutEl = itemButton.querySelector<HTMLElement>('[data-chord]');
      const shortcut = shortcutEl ? formatPrimaryChord(shortcutEl.dataset.chord ?? '') : undefined;
      if (shortcutEl && shortcut) shortcutEl.textContent = shortcut;
      entries.push({
        commandId,
        label: itemButton.querySelector('.menu-item-label')?.textContent?.trim() ?? commandId,
        section: menuLabel,
        shortcut,
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
          moveTriggerFocus(event.key === 'ArrowRight' ? 1 : -1, trigger);
          const focused = document.activeElement as HTMLButtonElement | null;
          if (focused?.classList.contains('menu-trigger')) focused.click();
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
        // Checkbox items are marked in the HTML, we only flip their state.
        if (button.getAttribute('role') === 'menuitemcheckbox') {
          button.setAttribute('aria-checked', state.checked ? 'true' : 'false');
        }
      });
    });
  };

  refresh();

  return {
    refresh,
    /** Every menu item in page order, for building the command palette. */
    entries: () => entries.slice(),
    destroy() {
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onDocumentKeyDown);
    },
  };
}
