/**
 * Keybinds are stored as strings like `Mod+Shift+O`, so one setting works on every platform.
 * `Mod` is the platform's main modifier: Cmd on a Mac, Ctrl everywhere else.
 * The other modifiers are `Ctrl` (only on a Mac, where it's not Mod), `Meta` (the Windows or Super key), `Alt`, and `Shift`.
 * The key comes last: an upper-case letter or digit, a symbol like `,`, or a key name like `Enter` or `F5`.
 */
export type Platform = 'mac' | 'other';

/** Check for a Mac (or iPad/iPhone), preferring the newer userAgentData when it's there. */
export function detectPlatform(nav: Navigator | undefined = globalThis.navigator): Platform {
  if (!nav) return 'other';
  try {
    const uaData = (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
    const platform = uaData?.platform || nav.platform || '';
    if (/mac|iphone|ipad|ipod/i.test(platform)) return 'mac';
    // NOTE: iPadOS reports itself as a Mac, so this still catches it.
    if (/Macintosh|Mac OS X/.test(nav.userAgent ?? '')) return 'mac';
  } catch {
    // Some browsers throw on these in locked-down modes, so just fall back.
  }
  return 'other';
}

export const isMac = () => detectPlatform() === 'mac';

const MODIFIERS = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'] as const;
type Modifier = (typeof MODIFIERS)[number];

// Mac menus list modifiers in this order, like ⌃⌥⇧⌘K.
const MAC_ORDER: Modifier[] = ['Ctrl', 'Alt', 'Shift', 'Meta', 'Mod'];
const MAC_NAMES: Record<string, string> = {
  Mod: '⌘', Meta: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧',
  Enter: '↩', Backspace: '⌫', Delete: '⌦', Escape: '⎋', Tab: '⇥',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space',
};
const OTHER_NAMES: Record<string, string> = {
  Mod: 'Ctrl', Meta: 'Win', Escape: 'Esc', Delete: 'Del',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
};

/** Split a keybind into its modifiers and key, or null if it isn't one. */
function parse(bind: string): { mods: Set<Modifier>; key: string } | null {
  // A trailing "+" is the plus key itself, as in "Mod++".
  const parts = bind.endsWith('++') ? [...bind.slice(0, -2).split('+'), '+'] : bind.split('+');
  const key = parts.pop();
  if (!key) return null;
  const mods = new Set<Modifier>();
  for (const part of parts) {
    const mod = MODIFIERS.find((m) => m.toLowerCase() === part.toLowerCase());
    if (!mod) return null;
    mods.add(mod);
  }
  return { mods, key: key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1) };
}

/**
 * Put a keybind in its stored form, with the modifiers in a fixed order, or return null if it isn't one.
 * On anything but a Mac, Ctrl is the same key as Mod, so it's stored as Mod.
 */
export function normalizeKeybind(bind: string, platform: Platform = detectPlatform()): string | null {
  const parsed = parse(bind.trim());
  if (!parsed || (MODIFIERS as readonly string[]).includes(parsed.key)) return null;
  if (platform !== 'mac' && parsed.mods.delete('Ctrl')) parsed.mods.add('Mod');
  return [...MODIFIERS.filter((m) => parsed.mods.has(m)), parsed.key].join('+');
}

/** Label a stored keybind like "Mod+Shift+O" for this platform: ⇧⌘O on a Mac, Ctrl+Shift+O elsewhere. */
export function formatKeybind(bind: string, platform: Platform = detectPlatform()): string {
  const parsed = parse(bind);
  if (!parsed) return bind;
  if (platform === 'mac') {
    const mods = MAC_ORDER.filter((m) => parsed.mods.has(m)).map((m) => MAC_NAMES[m]);
    return [...new Set(mods), MAC_NAMES[parsed.key] ?? parsed.key].join('');
  }
  // Mod and Ctrl are one key here, so don't say Ctrl twice.
  const mods = MODIFIERS.filter((m) => parsed.mods.has(m)).map((m) => (m === 'Ctrl' ? 'Ctrl' : OTHER_NAMES[m] ?? m));
  return [...new Set(mods), OTHER_NAMES[parsed.key] ?? parsed.key].join('+');
}

/** Check the platform's main modifier only: Cmd on a Mac, Ctrl everywhere else. */
export function hasModKey(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>, platform: Platform = detectPlatform()): boolean {
  return platform === 'mac' ? event.metaKey : event.ctrlKey;
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/** The key part of a key press, the same whatever modifiers changed the character it types. */
function eventKey(event: KeyLike): string | null {
  const { key, code } = event;
  // On a Mac, ⌥⌘N can come in as a dead key (⌥N starts ñ). With ⌘ or ⌃ held it isn't typing, so use the key's position.
  if (key === 'Dead' && (event.metaKey || event.ctrlKey)) {
    const letter = /^Key([A-Z])$/.exec(code ?? '');
    if (letter) return letter[1];
  }
  if (!key || key === 'Unidentified' || key === 'Dead' || ['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'OS'].includes(key)) {
    return null;
  }
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  // Alt on a Mac and Shift on digits change the character (Alt+O types ø), so fall back to the key's position.
  const letter = /^Key([A-Z])$/.exec(code ?? '');
  if (letter) return letter[1];
  const digit = /^Digit(\d)$/.exec(code ?? '');
  if (digit) return digit[1];
  if (key === ' ') return 'Space';
  return key.length === 1 ? key.toUpperCase() : key;
}

/** The stored keybind for a key press, like "Mod+Shift+O", or null for a modifier on its own. */
export function keybindFromEvent(event: KeyLike, platform: Platform = detectPlatform()): string | null {
  const key = eventKey(event);
  if (!key) return null;
  const mods: Modifier[] = [];
  if (hasModKey(event, platform)) mods.push('Mod');
  if (platform === 'mac' && event.ctrlKey) mods.push('Ctrl');
  if (platform !== 'mac' && event.metaKey) mods.push('Meta');
  if (event.altKey) mods.push('Alt');
  // Shift on a symbol key is already in the symbol, like "<" for Shift+",".
  if (event.shiftKey && (key.length > 1 || /^[A-Z0-9]$/.test(key))) mods.push('Shift');
  return [...mods, key].join('+');
}

/**
 * Whether a keybind is safe to give a command. It needs Ctrl, Cmd, Alt, or the Windows key,
 * so plain typing (letters, Enter, Shift+letter) always reaches the editor. F1 to F24 are fine on their own.
 */
export function isAssignableKeybind(bind: string): boolean {
  const parsed = parse(bind);
  if (!parsed) return false;
  if (/^F([1-9]|1\d|2[0-4])$/.test(parsed.key)) return true;
  return ['Mod', 'Ctrl', 'Meta', 'Alt'].some((m) => parsed.mods.has(m as Modifier));
}
