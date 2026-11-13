import type { CommandId } from '../ui/menuBar';
import { detectPlatform, formatKeybind, isAssignableKeybind, normalizeKeybind, type Platform } from '../ui/modifierShortcutLabels';

/**
 * A keybind for a command. `native` ones are only labels: the browser or the editor
 * already does the right thing for them (like Ctrl+C), so the app leaves the key alone.
 */
export type Shortcut = { id: CommandId; keybind: string; native?: boolean };

/** A keybind someone added in Settings. `off` is set when another command won its key. */
export type KeybindRule = { id: CommandId; keybind: string; off?: boolean };

/** What Settings changed: the added rules, in order, and the built-in keybinds turned off. */
export type KeybindSettings = { rules: KeybindRule[]; disabled: string[] };

/** One keybind as Settings lists it, built-in or added, on or off. */
export type Binding = Shortcut & { source: 'builtin' | 'rule'; off: boolean; ruleIndex?: number };

export const emptyKeybindSettings = (): KeybindSettings => ({ rules: [], disabled: [] });

/** How a turned-off built-in keybind is stored, so turning off Ctrl+Y for Redo leaves Ctrl+Shift+Z alone. */
export const builtinKey = (shortcut: Pick<Shortcut, 'id' | 'keybind'>) => `${shortcut.id} ${shortcut.keybind}`;

/** Drop rules for commands this build doesn't have. Settings (state/settings.ts) stores the rest. */
export function keepKnownCommands(settings: KeybindSettings, isCommand: (id: string) => boolean): KeybindSettings {
  return { rules: settings.rules.filter((rule) => isCommand(rule.id)), disabled: settings.disabled.slice() };
}

/**
 * The one table every shortcut label and key press reads from: menus, toolbar tooltips,
 * the palette, the tour, Settings, and the keydown handler.
 * Built-in keybinds come first, then the rules from Settings. When two commands want the
 * same key, the last rule wins, and with no rule the first built-in does.
 */
export function createKeymap(builtins: readonly Shortcut[], platform: () => Platform = detectPlatform, initial: KeybindSettings = emptyKeybindSettings()) {
  let settings = initial;
  let bindings: Binding[] = [];
  let byKey = new Map<string, Binding>();
  let byCommand = new Map<CommandId, string[]>();

  const rebuild = () => {
    const disabled = new Set(settings.disabled);
    const builtinBindings = builtins.flatMap((shortcut): Binding[] => {
      const keybind = normalizeKeybind(shortcut.keybind, platform());
      return keybind ? [{ ...shortcut, keybind, source: 'builtin', off: disabled.has(builtinKey({ id: shortcut.id, keybind })) }] : [];
    });
    const ruleBindings = settings.rules.flatMap((rule, ruleIndex): Binding[] => {
      const keybind = normalizeKeybind(rule.keybind, platform());
      return keybind && isAssignableKeybind(keybind) ? [{ id: rule.id, keybind, source: 'rule', off: Boolean(rule.off), ruleIndex }] : [];
    });
    bindings = [...builtinBindings, ...ruleBindings];
    byKey = new Map();
    for (const binding of bindings) {
      if (binding.off) continue;
      const current = byKey.get(binding.keybind);
      if (!current || binding.source === 'rule') byKey.set(binding.keybind, binding);
    }
    byCommand = new Map();
    for (const binding of bindings) {
      if (byKey.get(binding.keybind) !== binding) continue;
      const keys = byCommand.get(binding.id) ?? [];
      if (!keys.includes(binding.keybind)) byCommand.set(binding.id, [...keys, binding.keybind]);
    }
  };
  rebuild();

  return {
    /** The platform the keybinds are read for. */
    platform,
    /** The shortcut a stored keybind runs, if any. */
    commandFor: (keybind: string): Shortcut | null => byKey.get(keybind) ?? null,
    /** Every keybind a command has right now, the main one first. */
    keybindsFor: (id: CommandId): string[] => byCommand.get(id)?.slice() ?? [],
    /** The main keybind of a command, labeled for this platform, like "Ctrl+S" or "⌘S". */
    labelFor(id: CommandId): string | undefined {
      const keybind = byCommand.get(id)?.[0];
      return keybind ? formatKeybind(keybind, platform()) : undefined;
    },
    /** Every keybind, built-in and added, on and off, for Settings to list. */
    bindings: (): Binding[] => bindings.slice(),
    /** The commands that want a key and aren't turned off. More than one means a conflict. */
    claimants: (keybind: string): Binding[] => bindings.filter((binding) => !binding.off && binding.keybind === keybind),
    settings: (): KeybindSettings => ({ rules: settings.rules.map((rule) => ({ ...rule })), disabled: settings.disabled.slice() }),
    setSettings(next: KeybindSettings) {
      settings = next;
      rebuild();
    },
  };
}

export type Keymap = ReturnType<typeof createKeymap>;

/** Add a keybind for a command. Returns the settings unchanged if it already has that key. */
export function addRule(settings: KeybindSettings, id: CommandId, keybind: string, builtins: readonly Shortcut[]): KeybindSettings {
  // Adding back a built-in keybind that was turned off just turns it on again.
  const builtin = builtins.find((shortcut) => shortcut.id === id && shortcut.keybind === keybind);
  if (builtin && settings.disabled.includes(builtinKey(builtin))) {
    return { ...settings, disabled: settings.disabled.filter((key) => key !== builtinKey(builtin)) };
  }
  if (builtin || settings.rules.some((rule) => rule.id === id && rule.keybind === keybind)) return settings;
  return { ...settings, rules: [...settings.rules, { id, keybind }] };
}

/** Turn a keybind off (built-in) or remove it (added), or turn it back on. */
export function toggleBinding(settings: KeybindSettings, binding: Binding): KeybindSettings {
  if (binding.source === 'builtin') {
    const key = builtinKey(binding);
    const disabled = binding.off ? settings.disabled.filter((k) => k !== key) : [...settings.disabled, key];
    return { ...settings, disabled };
  }
  const rules = settings.rules.slice();
  if (binding.off) rules[binding.ruleIndex!] = { id: binding.id, keybind: binding.keybind };
  else rules.splice(binding.ruleIndex!, 1);
  return { ...settings, rules };
}

/** Give a key to one command: every other command that wants it gets that keybind turned off. */
export function pickWinner(settings: KeybindSettings, claimants: Binding[], winner: CommandId): KeybindSettings {
  let next = { rules: settings.rules.slice(), disabled: settings.disabled.slice() };
  for (const binding of claimants) {
    if (binding.id === winner || binding.off) continue;
    if (binding.source === 'builtin') next = { ...next, disabled: [...next.disabled, builtinKey(binding)] };
    else next.rules[binding.ruleIndex!] = { id: binding.id, keybind: binding.keybind, off: true };
  }
  return next;
}
