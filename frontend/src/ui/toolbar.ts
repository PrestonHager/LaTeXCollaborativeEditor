import { createMenuBar, type CommandId, type CommandState } from './menuBar';
import { commandIcon } from './icons';

type ToolbarOptions = {
  getCommandState: (commandId: CommandId) => CommandState;
  onCommand: (commandId: CommandId) => void;
  /** The keybind label to show for a command, if it has one. */
  shortcutLabel?: (commandId: CommandId) => string | undefined;
  /** True on a phone (under 640px), where the toolbar keeps a few buttons and puts the rest in More (#186). */
  isCollapsed?: () => boolean;
};

/** Where a toolbar action goes on a phone: on the bar, in the More menu, or nowhere. */
export type PhonePlace = 'bar' | 'more' | 'hidden';

/** The actions that stay on the bar on a phone, because they're the ones people use most there. */
export const PHONE_TOOLBAR_KEEP: readonly CommandId[] = ['view.compileNow', 'share.copyLink'];

/**
 * Where a toolbar action goes on a phone. Compile and share stay. The layout buttons go, since the
 * Editor/Preview switch does their job (#185). Everything else moves to the More menu.
 */
export function phonePlace(commandId: CommandId): PhonePlace {
  if (PHONE_TOOLBAR_KEEP.includes(commandId)) return 'bar';
  if (commandId.startsWith('view.layout')) return 'hidden';
  return 'more';
}

/** Build a More menu item for a toolbar button: the same command, icon and label. */
function moreItem(button: HTMLButtonElement, commandId: CommandId): HTMLButtonElement {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'menu-item';
  item.setAttribute('role', 'menuitem');
  item.dataset.command = commandId;
  const label = document.createElement('span');
  label.className = 'menu-item-label';
  label.textContent = button.dataset.tooltip ?? button.getAttribute('aria-label') ?? commandId;
  item.append(label);
  return item;
}

/**
 * Wire up the toolbar in index.html. Each button runs the same command as its menu item.
 * Only one button is in the tab order at a time, and the arrow keys move between them,
 * which is how screen readers expect a role="toolbar" to work.
 * On a phone the More button takes the actions that don't fit (see `phonePlace`).
 */
export function createToolbar(root: HTMLElement, options: ToolbarOptions) {
  const isCollapsed = options.isCollapsed ?? (() => false);
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(':scope > button[data-command]'));
  const moreRoot = root.querySelector<HTMLElement>('.toolbar-more');
  const moreTrigger = moreRoot?.querySelector<HTMLButtonElement>('.menu-trigger') ?? null;
  let current: HTMLButtonElement | undefined = buttons[0];

  /** The buttons that show right now, in order, for the arrow keys and the one tab stop. */
  const shown = (): HTMLButtonElement[] => {
    if (!isCollapsed()) return buttons;
    const bar = buttons.filter((button) => button.dataset.phonePlace === 'bar');
    return moreTrigger ? [...bar, moreTrigger] : bar;
  };

  const setCurrent = (button: HTMLButtonElement | undefined) => {
    const list = shown();
    current = button && list.includes(button) ? button : list[0];
    [...buttons, ...(moreTrigger ? [moreTrigger] : [])].forEach((each) => {
      each.tabIndex = each === current ? 0 : -1;
    });
  };

  const moreList = moreRoot?.querySelector<HTMLElement>('[role="menu"]');
  buttons.forEach((button) => {
    const commandId = button.dataset.command as CommandId;
    // First, add the command's icon unless the HTML already has one.
    if (!button.querySelector('svg, i')) button.prepend(commandIcon(commandId));
    // Keep the tooltip from the HTML, refreshShortcuts adds the keybind to it.
    button.dataset.tooltipText = button.dataset.tooltip ?? '';
    const place = phonePlace(commandId);
    button.dataset.phonePlace = place;
    if (place === 'more') moreList?.append(moreItem(button, commandId));
    button.addEventListener('click', () => {
      setCurrent(button);
      if (options.getCommandState(commandId).enabled) options.onCommand(commandId);
    });
  });

  // The More menu works like the menus in the menu bar: same keys, same disabled items, same shortcuts.
  const moreMenu = moreRoot
    ? createMenuBar(moreRoot, { ...options, isCollapsed: undefined, arrowsBetweenMenus: false })
    : null;
  moreTrigger?.addEventListener('click', () => setCurrent(moreTrigger));

  root.addEventListener('keydown', (event) => {
    // Keys inside the More menu belong to it.
    if ((event.target as Element | null)?.closest?.('[data-popover]')) return;
    const list = shown();
    const index = current ? list.indexOf(current) : -1;
    const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
    let next: number;
    if (event.key in keys) next = (Math.max(index, 0) + keys[event.key] + list.length) % list.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = list.length - 1;
    else return;
    event.preventDefault();
    moreMenu?.closeMenus();
    setCurrent(list[next]);
    list[next]?.focus();
  });

  const refresh = () => {
    buttons.forEach((button) => {
      const state = options.getCommandState(button.dataset.command as CommandId);
      // aria-disabled instead of disabled, so the button stays reachable and its tooltip still reads.
      button.setAttribute('aria-disabled', state.enabled ? 'false' : 'true');
      // Toggles like the layout buttons show as pressed when they're on.
      if (state.checked !== undefined) button.setAttribute('aria-pressed', state.checked ? 'true' : 'false');
    });
    moreMenu?.refresh();
  };

  /** Put each button's keybind in its tooltip, like "Save now (Ctrl+S)". Call again when the keybinds change. */
  const refreshShortcuts = () => {
    buttons.forEach((button) => {
      const text = button.dataset.tooltipText;
      if (!text) return;
      const shortcut = options.shortcutLabel?.(button.dataset.command as CommandId);
      button.dataset.tooltip = shortcut ? `${text} (${shortcut})` : text;
    });
    moreMenu?.refreshShortcuts();
  };

  setCurrent(buttons[0]);
  refresh();
  refreshShortcuts();
  return {
    refresh,
    refreshShortcuts,
    /** The window crossed the phone breakpoint: close More, and keep the tab stop on a button that shows. */
    viewportChanged() {
      moreMenu?.closeMenus();
      setCurrent(current);
    },
  };
}
