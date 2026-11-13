import type { CommandId } from '../ui/menuBar';
import { detectPlatform, formatKeybind, isAssignableKeybind, normalizeKeybind, type Platform } from '../ui/modifierShortcutLabels';
import type { ReservedKey } from './reservedKeys';

/**
 * A keybind for a command. `native` ones are only labels: the browser or the editor
 * already does the right thing for them (like Ctrl+C), so the app leaves the key alone.
 * `fallback` is a second key that always works, shown first where the browser keeps `keybind` for itself
 * (see reservedKeys.ts). It's per platform, since Option+letter types a character on a Mac.
 */
export type Shortcut = { id: CommandId; keybind: string; native?: boolean; fallback?: { mac?: string; other?: string } };

/** A keybind someone added in Settings. `off` is set when another command won its key. */
export type KeybindRule = { id: CommandId; keybind: string; off?: boolean };

/** What Settings changed: the added rules, in order, and the built-in keybinds turned off. */
export type KeybindSettings = { rules: KeybindRule[]; disabled: string[] };

/**
 * One keybind as Settings lists it, built-in or added, on or off.
 * `reserved` says the browser or OS keeps this key here, so it may never reach the page.
 * `fallbackFor` marks a built-in fallback key, and names the main key it stands in for where the browser keeps that one.
 */
export type Binding = Omit<Shortcut, 'fallback'> & { source: 'builtin' | 'rule'; off: boolean; ruleIndex?: number; reserved?: ReservedKey; fallbackFor?: string };

export const emptyKeybindSettings = (): KeybindSettings => ({ rules: [], disabled: [] });

/** How a turned-off built-in keybind is stored, so turning off Ctrl+Y for Redo leaves Ctrl+Shift+Z alone. */
export const builtinKey = (shortcut: Pick<Shortcut, 'id' | 'keybind'>) => `${shortcut.id} ${shortcut.keybind}`;

/** Drop rules for commands this build doesn't have. Settings (state/settings.ts) stores the rest. */
export function keepKnownCommands(settings: KeybindSettings, isCommand: (id: string) => boolean): KeybindSettings {
  return { rules: settings.rules.filter((rule) => isCommand(rule.id)), disabled: settings.disabled.slice() };
}

/**
 * Built-in keys that moved from one command to another. Turning one off is stored under the command
 * that had it, so migrateKeybinds carries that over to the command that has it now.
 */
export const MOVED_BUILTINS: readonly { keybind: string; from: CommandId; to: CommandId }[] = [
  // New File took Ctrl+N from New Project, which moved to Ctrl+Shift+N.
  { keybind: 'Mod+N', from: 'file.new', to: 'file.newFile' },
];

/**
 * Bring saved keybind settings up to date with this build's built-in keybinds, so changed defaults
 * keep what the person chose. It only changes what can't happen any more, so it's safe to run on every load.
 * - A key they turned off for a command that no longer has it stays off for the command that has it now,
 *   unless a keybind they added already takes that key.
 * - A keybind they added that's now built in is dropped, and a built-in one is used in its place
 *   (turned off, if theirs had lost its key to another command).
 */
export function migrateKeybinds(settings: KeybindSettings, builtins: readonly Shortcut[], moved = MOVED_BUILTINS): KeybindSettings {
  const disabled = settings.disabled.slice();
  const ruleTakes = (keybind: string) => settings.rules.some((rule) => !rule.off && rule.keybind === keybind);
  const turnOff = (key: string) => {
    if (!disabled.includes(key)) disabled.push(key);
  };
  for (const move of moved) {
    const old = builtinKey({ id: move.from, keybind: move.keybind });
    const index = disabled.indexOf(old);
    // Still built in for the old command, so the stored key still means what it says.
    if (index === -1 || builtins.some((shortcut) => builtinKey(shortcut) === old)) continue;
    disabled.splice(index, 1);
    if (!ruleTakes(move.keybind)) turnOff(builtinKey({ id: move.to, keybind: move.keybind }));
  }
  const rules = settings.rules.filter((rule) => {
    const builtin = builtins.find((shortcut) => shortcut.id === rule.id && shortcut.keybind === rule.keybind);
    if (!builtin) return true;
    if (rule.off) turnOff(builtinKey(builtin));
    return false;
  });
  // A key their own rule took for this command needs the built-in one on, not left off by the step above.
  for (const rule of settings.rules) {
    if (!rule.off && builtins.some((shortcut) => shortcut.id === rule.id && shortcut.keybind === rule.keybind)) {
      const key = builtinKey(rule);
      const index = disabled.indexOf(key);
      if (index !== -1) disabled.splice(index, 1);
    }
  }
  return { rules, disabled };
}

/**
 * The one table every shortcut label and key press reads from: menus, toolbar tooltips,
 * the palette, the tour, Settings, and the keydown handler.
 * Built-in keybinds come first, then the rules from Settings. When two commands want the
 * same key, the last rule wins, and with no rule the first built-in does.
 */
/**
 * The built-in keybinds, the rules from Settings, and the keys this browser keeps for itself.
 * `reserved` reads the kept keys for where the page is now (reservedKeys.ts); call refresh() when that changes.
 */
export function createKeymap(
  builtins: readonly Shortcut[],
  platform: () => Platform = detectPlatform,
  initial: KeybindSettings = emptyKeybindSettings(),
  reserved: () => ReadonlyMap<string, ReservedKey> = () => new Map(),
) {
  let settings = migrateKeybinds(initial, builtins);
  let reservedNow: ReadonlyMap<string, ReservedKey> = new Map();
  let bindings: Binding[] = [];
  let byKey = new Map<string, Binding>();
  let byCommand = new Map<CommandId, string[]>();

  const rebuild = () => {
    const disabled = new Set(settings.disabled);
    reservedNow = reserved();
    const ruleTakes = (id: CommandId, keybind: string) => settings.rules.some((rule) => !rule.off && rule.id === id && normalizeKeybind(rule.keybind, platform()) === keybind);
    const builtinBindings = builtins.flatMap(({ fallback, ...shortcut }): Binding[] => {
      const keybind = normalizeKeybind(shortcut.keybind, platform());
      if (!keybind) return [];
      const kept = reservedNow.get(keybind);
      const main: Binding = { ...shortcut, keybind, source: 'builtin', off: disabled.has(builtinKey({ id: shortcut.id, keybind })), ...(kept ? { reserved: kept } : {}) };
      // The fallback is always on, so it works the same in a tab and an app window (and wherever detection is wrong).
      // Where the browser keeps the main key, the fallback is listed first, so labels show it.
      const spare = !shortcut.native ? fallback?.[platform() === 'mac' ? 'mac' : 'other'] : undefined;
      const spareKey = spare ? normalizeKeybind(spare, platform()) : null;
      if (!spareKey || reservedNow.has(spareKey) || ruleTakes(shortcut.id, spareKey)) return [main];
      return [main, { id: shortcut.id, keybind: spareKey, source: 'builtin', off: disabled.has(builtinKey({ id: shortcut.id, keybind: spareKey })), fallbackFor: keybind }];
    });
    const ruleBindings = settings.rules.flatMap((rule, ruleIndex): Binding[] => {
      const keybind = normalizeKeybind(rule.keybind, platform());
      const kept = keybind ? reservedNow.get(keybind) : undefined;
      return keybind && isAssignableKeybind(keybind) ? [{ id: rule.id, keybind, source: 'rule', off: Boolean(rule.off), ruleIndex, ...(kept ? { reserved: kept } : {}) }] : [];
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
    // A key the browser keeps goes last, so labels show the one that works here.
    for (const [id, keys] of byCommand) byCommand.set(id, [...keys.filter((k) => !reservedNow.has(k)), ...keys.filter((k) => reservedNow.has(k))]);
  };
  rebuild();

  return {
    /** The platform the keybinds are read for. */
    platform,
    /** The shortcut a stored keybind runs, if any. */
    commandFor: (keybind: string): Shortcut | null => byKey.get(keybind) ?? null,
    /** Every keybind a command has right now, the main one first. */
    keybindsFor: (id: CommandId): string[] => byCommand.get(id)?.slice() ?? [],
    /** The main keybind of a command, labeled for this platform, like "Ctrl+S" or "⌘S". A key that works here comes first. */
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
      settings = migrateKeybinds(next, builtins);
      rebuild();
    },
    /** Why the browser or OS keeps a key here, or null when the page gets it. */
    reservedFor: (keybind: string): ReservedKey | null => reservedNow.get(keybind) ?? null,
    /** Read the kept keys again, after the window changed (an app window, fullscreen). */
    refresh: () => rebuild(),
  };
}

export type Keymap = ReturnType<typeof createKeymap>;

/** Add a keybind for a command. Returns the settings unchanged if it already has that key. */
export function addRule(settings: KeybindSettings, id: CommandId, keybind: string, builtins: readonly Pick<Shortcut, 'id' | 'keybind'>[]): KeybindSettings {
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
