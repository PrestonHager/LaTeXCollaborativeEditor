/**
 * Primary modifier key label for shortcut display (menus, command palette).
 * Uses the Command symbol on Apple platforms; "Ctrl" elsewhere or when unknown.
 */
export function primaryModifierLabel(): '⌘' | 'Ctrl' {
  if (typeof navigator === 'undefined') return 'Ctrl';
  try {
    const platform = navigator.platform ?? '';
    const ua = navigator.userAgent ?? '';
    if (/Mac|iPhone|iPod|iPad/i.test(platform) || /Mac OS X|Macintosh/.test(ua)) {
      return '⌘';
    }
  } catch {
    /* ignore */
  }
  return 'Ctrl';
}

/** Builds a display chord like `Ctrl+Shift+O` or `⌘+Shift+O`. @param rest e.g. `N`, `Shift+O` */
export function formatPrimaryChord(rest: string): string {
  return `${primaryModifierLabel()}+${rest}`;
}
