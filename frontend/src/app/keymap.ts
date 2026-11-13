import type { CommandId } from '../ui/menuBar';
import { detectPlatform, formatKeybind, normalizeKeybind, type Platform } from '../ui/modifierShortcutLabels';

/**
 * A keybind for a command. `native` ones are only labels: the browser or the editor
 * already does the right thing for them (like Ctrl+C), so the app leaves the key alone.
 */
export type Shortcut = { id: CommandId; keybind: string; native?: boolean };

/**
 * The one table every shortcut label and key press reads from: menus, toolbar tooltips,
 * the palette, the tour, and the keydown handler.
 */
export function createKeymap(builtins: readonly Shortcut[], platform: () => Platform = detectPlatform) {
  let byKey = new Map<string, Shortcut>();
  let byCommand = new Map<CommandId, string[]>();

  const rebuild = () => {
    byKey = new Map();
    byCommand = new Map();
    for (const shortcut of builtins) {
      const keybind = normalizeKeybind(shortcut.keybind, platform());
      // The first command listed for a key gets it.
      if (!keybind || byKey.has(keybind)) continue;
      byKey.set(keybind, { ...shortcut, keybind });
      byCommand.set(shortcut.id, [...(byCommand.get(shortcut.id) ?? []), keybind]);
    }
  };
  rebuild();

  return {
    /** The platform the keybinds are read for. */
    platform,
    /** The shortcut a stored keybind runs, if any. */
    commandFor: (keybind: string): Shortcut | null => byKey.get(keybind) ?? null,
    /** Every keybind for a command, the main one first. */
    keybindsFor: (id: CommandId): string[] => byCommand.get(id)?.slice() ?? [],
    /** The main keybind of a command, labeled for this platform, like "Ctrl+S" or "⌘S". */
    labelFor(id: CommandId): string | undefined {
      const keybind = byCommand.get(id)?.[0];
      return keybind ? formatKeybind(keybind, platform()) : undefined;
    },
  };
}

export type Keymap = ReturnType<typeof createKeymap>;
