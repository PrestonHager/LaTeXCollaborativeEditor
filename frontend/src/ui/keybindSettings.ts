import type { CommandId } from './menuBar';
import { addRule, pickWinner, toggleBinding, type Binding, type Keymap, type KeybindSettings } from '../app/keymap';
import { formatKeybind, isAssignableKeybind, keybindFromEvent } from './modifierShortcutLabels';
import { scoreCommand } from './commandPalette';
import { icon, keybindIcons } from './icons';
import { confirmDialog, type ConfirmOptions } from './dialogs';

/** A command Settings can give keybinds to. */
export type KeybindCommand = { id: CommandId; label: string; section: string; description?: string };

type KeybindSettingsOptions = {
  keymap: Keymap;
  /** Where the keys are for, like "Chrome in a browser tab", since browsers keep different keys. */
  contextLabel?: () => string;
  /** Every command, in menu order. */
  commands: () => KeybindCommand[];
  /** The editor's own keys, which it handles first while you type in it. */
  editorKeybinds: ReadonlySet<string>;
  /** Save the new settings and refresh every label. The keymap already has them. */
  onChange: (settings: KeybindSettings) => void;
  /** Ask before Reset all. Defaults to the in-app confirm dialog; tests pass their own answer. */
  confirm?: (options: ConfirmOptions) => boolean | Promise<boolean>;
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

/**
 * The keybind list in Settings: one row per command with its keybinds. You can add keybinds
 * by pressing them, turn built-in ones off, and pick which command gets a key two of them want.
 * Every change goes straight into the keymap, so menus and the palette show it right away.
 */
export function createKeybindSettings(root: HTMLElement, options: KeybindSettingsOptions) {
  const { keymap } = options;
  const search = root.querySelector<HTMLInputElement>('[data-keybind-search]')!;
  const list = root.querySelector<HTMLElement>('[data-keybind-list]')!;
  const resetButton = root.querySelector<HTMLButtonElement>('[data-keybind-reset]')!;
  const context = root.querySelector<HTMLElement>('[data-keybind-context]');
  // The command whose new keybind is being recorded, and what to tell the person about their last try.
  let recording: CommandId | null = null;
  let recordingHint = '';
  let rendering = false;

  /** A selector that finds this list button again after the list is drawn again. */
  const focusSelector = (target: EventTarget | null): string | undefined => {
    if (!(target instanceof HTMLElement) || !list.contains(target)) return undefined;
    const id = target.closest<HTMLElement>('.keybind-row')?.dataset.command;
    if (!id) return undefined;
    const toggle = target.dataset.keybindToggle;
    if (toggle) return `[data-command="${id}"] [data-keybind-toggle="${toggle.replace(/["\\]/g, '\\$&')}"]`;
    return target.matches('[data-keybind-add]') ? `[data-command="${id}"] [data-keybind-add]` : undefined;
  };
  const label = (keybind: string) => formatKeybind(keybind, keymap.platform());
  const commandName = (id: CommandId) => options.commands().find((command) => command.id === id)?.label ?? id;

  const apply = (next: KeybindSettings, focus?: string) => {
    keymap.setSettings(next);
    options.onChange(keymap.settings());
    render(focus);
  };

  /** A keybind on a command's row, with a button to turn it off, remove it, or turn it back on. */
  const chip = (command: KeybindCommand, binding: Binding) => {
    const item = el('span', 'keybind-chip');
    item.dataset.source = binding.source;
    if (binding.off) item.dataset.off = '';
    item.append(el('kbd', '', label(binding.keybind)));
    const button = el('button', 'btn keybind-chip-button');
    button.type = 'button';
    button.dataset.variant = 'ghost';
    button.dataset.size = 'icon-sm';
    button.dataset.keybindToggle = `${binding.source}:${binding.keybind}`;
    const action = binding.off ? 'Turn on' : binding.source === 'builtin' ? 'Turn off' : 'Remove';
    button.setAttribute('aria-label', `${action} ${label(binding.keybind)} for ${command.label}`);
    button.title = action;
    if (binding.off) button.textContent = 'Turn on';
    else button.append(icon(keybindIcons.X, 'size-3'));
    button.addEventListener('click', () => apply(toggleBinding(keymap.settings(), binding), `[data-command="${command.id}"] [data-keybind-add]`));
    item.append(button);
    return item;
  };

  /** Warnings for one of a command's keybinds: another command wants it, the editor or browser uses it. */
  const notes = (command: KeybindCommand, binding: Binding): HTMLElement[] => {
    if (binding.off) return [];
    const out: HTMLElement[] = [];
    const key = label(binding.keybind);
    // The icon, then the text with any buttons right after it.
    const note = (text: string) => {
      const li = el('li', 'keybind-note');
      const body = el('span', '', text);
      li.append(icon(keybindIcons.TriangleAlert, 'size-3'), body);
      out.push(li);
      return body;
    };
    const claimants = keymap.claimants(binding.keybind);
    const others = [...new Set(claimants.map((other) => other.id).filter((id) => id !== command.id))];
    if (others.length) {
      const winner = keymap.commandFor(binding.keybind)?.id;
      const names = others.map(commandName).join(' and ');
      const li = note(`${key} is also set for ${names}. ${winner === command.id ? 'This one wins.' : `${commandName(winner!)} wins.`}`);
      const choose = (id: CommandId, text: string) => {
        const button = el('button', 'btn', text);
        button.type = 'button';
        button.dataset.variant = 'link';
        button.dataset.size = 'sm';
        button.addEventListener('click', () => apply(pickWinner(keymap.settings(), claimants, id), `[data-command="${command.id}"] [data-keybind-add]`));
        li.append(button);
      };
      if (winner === command.id) others.forEach((id) => choose(id, `Give it to ${commandName(id)}`));
      else choose(command.id, 'Use it here');
    }
    if (binding.source === 'rule' && options.editorKeybinds.has(binding.keybind)) {
      note(`The editor uses ${key} too, so while you type in it, the editor's key comes first.`);
    }
    if (binding.reserved) note(reservedNote(command, binding));
    return out;
  };

  /**
   * Say the browser or OS keeps a key here, like "Chrome uses Ctrl+N to open a new window, so Alt+N is used here instead.
   * Ctrl+N works when the app is installed." For a built-in key with a fallback, name the fallback.
   */
  const reservedNote = (command: KeybindCommand, binding: Binding) => {
    const kept = binding.reserved!;
    const key = label(binding.keybind);
    const spare = binding.source === 'builtin' ? keymap.bindings().find((b) => b.id === command.id && b.fallbackFor === binding.keybind) : undefined;
    const uses = `${kept.by} uses ${key} ${kept.what}`;
    const where = kept.keptInAppWindow ? '' : ` ${key} works when the app is installed or in its own window.`;
    if (spare) return `${uses}, so ${label(spare.keybind)} is used here instead.${where}`;
    return `${uses}, so it may not reach the editor here.${where}`;
  };

  /** The button that records a new keybind: press the keys, or Escape to stop. */
  const recorder = (command: KeybindCommand) => {
    const button = el('button', 'btn keybind-recorder', recordingHint || 'Press keys…');
    button.type = 'button';
    button.dataset.variant = 'outline';
    button.dataset.size = 'sm';
    button.dataset.keybindRecorder = '';
    button.setAttribute('aria-label', `Press the new keybind for ${command.label}, or Escape to cancel`);
    // Escape puts focus back on the add button. Leaving the recorder passes where focus went, or null.
    const stop = (focus: string | null = `[data-command="${command.id}"] [data-keybind-add]`) => {
      recording = null;
      recordingHint = '';
      render(focus ?? undefined);
    };
    button.addEventListener('keydown', (event) => {
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
      // Tab and Shift+Tab still move on, so the keyboard never gets stuck here. Losing focus stops recording.
      if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        return;
      }
      // Keep every other key away from the page, the app's shortcuts, and the dialog's own Escape.
      event.preventDefault();
      event.stopPropagation();
      if (plain && event.key === 'Escape') return stop();
      const keybind = keybindFromEvent(event, keymap.platform());
      if (!keybind) return;
      if (!isAssignableKeybind(keybind)) {
        const mods = keymap.platform() === 'mac' ? '⌘, ⌥, or ⌃' : 'Ctrl or Alt';
        recordingHint = `${label(keybind)} is for typing. Add ${mods}.`;
        render('[data-keybind-recorder]');
        return;
      }
      if (keymap.keybindsFor(command.id).includes(keybind)) {
        recordingHint = `${command.label} already has ${label(keybind)}. Press another, or Escape.`;
        render('[data-keybind-recorder]');
        return;
      }
      recording = null;
      recordingHint = '';
      // The built-in keys in effect here, fallbacks included, so adding one back turns it on.
      const builtins = keymap.bindings().filter((binding) => binding.source === 'builtin');
      apply(addRule(keymap.settings(), command.id, keybind, builtins), `[data-command="${command.id}"] [data-keybind-add]`);
    });
    // Clicking or tabbing somewhere else stops recording too. Drawing the list again isn't "somewhere else".
    // Wait until focus has landed, then draw the list again and find the button focus went to.
    button.addEventListener('focusout', () => {
      if (rendering) return;
      setTimeout(() => {
        if (recording !== command.id || document.activeElement?.matches('[data-keybind-recorder]')) return;
        stop(focusSelector(document.activeElement) ?? null);
      }, 0);
    });
    return button;
  };

  const row = (command: KeybindCommand) => {
    const li = el('li', 'keybind-row');
    li.dataset.command = command.id;
    const name = el('span', 'keybind-name');
    name.append(el('span', '', command.label), el('span', 'keybind-section', command.section));
    const chips = el('span', 'keybind-chips');
    const bindings = keymap.bindings().filter((binding) => binding.id === command.id);
    bindings.forEach((binding) => chips.append(chip(command, binding)));
    if (recording === command.id) {
      chips.append(recorder(command));
    } else {
      const add = el('button', 'btn keybind-add');
      add.type = 'button';
      add.dataset.variant = 'ghost';
      add.dataset.size = 'icon-sm';
      add.dataset.keybindAdd = '';
      add.title = 'Add a keybind';
      add.setAttribute('aria-label', `Add a keybind for ${command.label}`);
      add.append(icon(keybindIcons.Plus));
      add.addEventListener('click', () => {
        recording = command.id;
        recordingHint = '';
        render('[data-keybind-recorder]');
      });
      chips.append(add);
    }
    li.append(name, chips);
    const warnings = bindings.flatMap((binding) => notes(command, binding));
    if (warnings.length) {
      const ul = el('ul', 'keybind-notes');
      ul.append(...warnings);
      li.append(ul);
    }
    return li;
  };

  /** Draw the list again, then put focus on `focus` (a selector inside the list) if given. */
  function render(focus?: string) {
    const query = search.value.trim().toLowerCase();
    const commands = options.commands().filter((command) => {
      if (!query) return true;
      // Every keybind the row shows counts, so searching a key finds each command that wants it.
      const shortcut = keymap.bindings().filter((binding) => binding.id === command.id).map((binding) => label(binding.keybind)).join(' ');
      return scoreCommand(query, { ...command, shortcut, enabled: true }) !== null;
    });
    if (context && options.contextLabel) context.textContent = `Keys shown are for ${options.contextLabel()}.`;
    rendering = true;
    try {
      list.replaceChildren(...commands.map(row));
      if (!commands.length) list.append(el('li', 'keybind-empty muted', 'No commands match.'));
      const settings = keymap.settings();
      resetButton.disabled = !settings.rules.length && !settings.disabled.length;
      if (focus) list.querySelector<HTMLElement>(focus)?.focus();
    } finally {
      rendering = false;
    }
  }

  search.addEventListener('input', () => {
    recording = null;
    render();
  });
  resetButton.addEventListener('click', async () => {
    const ask = options.confirm ?? confirmDialog;
    const ok = await ask({
      title: 'Reset keyboard shortcuts?',
      message: 'Every shortcut goes back to its default, and the keybinds you added go away.',
      confirmLabel: 'Reset shortcuts',
      destructive: true,
    });
    if (!ok) return;
    recording = null;
    apply({ rules: [], disabled: [] });
    // Reset turns itself off once there's nothing left to reset, so keep focus in the section.
    (resetButton.disabled ? search : resetButton).focus();
  });

  render();
  return {
    /** Draw the list from the keymap again, like when Settings opens. */
    refresh: () => {
      recording = null;
      recordingHint = '';
      render();
    },
  };
}
