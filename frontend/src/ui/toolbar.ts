import type { CommandId, CommandState } from './menuBar';
import { commandIcon } from './icons';
import { formatPrimaryChord } from './modifierShortcutLabels';

type ToolbarOptions = {
  getCommandState: (commandId: CommandId) => CommandState;
  onCommand: (commandId: CommandId) => void;
};

/**
 * Wire up the toolbar in index.html. Each button runs the same command as its menu item.
 * Only one button is in the tab order at a time, and the arrow keys move between them,
 * which is how screen readers expect a role="toolbar" to work.
 */
export function createToolbar(root: HTMLElement, options: ToolbarOptions) {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-command]'));
  let current = 0;

  const setCurrent = (index: number) => {
    current = index;
    buttons.forEach((button, i) => {
      button.tabIndex = i === current ? 0 : -1;
    });
  };

  buttons.forEach((button, index) => {
    const commandId = button.dataset.command as CommandId;
    // First, add the command's icon unless the HTML already has one.
    if (!button.querySelector('svg, i')) button.prepend(commandIcon(commandId));
    // Then put the platform's shortcut in the tooltip, like "Save now (Ctrl+S)".
    const chord = button.dataset.chord;
    if (chord && button.dataset.tooltip) {
      button.dataset.tooltip = `${button.dataset.tooltip} (${formatPrimaryChord(chord)})`;
    }
    button.addEventListener('click', () => {
      setCurrent(index);
      if (options.getCommandState(commandId).enabled) options.onCommand(commandId);
    });
  });

  root.addEventListener('keydown', (event) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
    let next = current;
    if (event.key in keys) next = (current + keys[event.key] + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    event.preventDefault();
    setCurrent(next);
    buttons[next].focus();
  });

  const refresh = () => {
    buttons.forEach((button) => {
      const state = options.getCommandState(button.dataset.command as CommandId);
      // aria-disabled instead of disabled, so the button stays reachable and its tooltip still reads.
      button.setAttribute('aria-disabled', state.enabled ? 'false' : 'true');
      // Toggles like the layout buttons show as pressed when they're on.
      if (state.checked !== undefined) button.setAttribute('aria-pressed', state.checked ? 'true' : 'false');
    });
  };

  setCurrent(0);
  refresh();
  return { refresh };
}
