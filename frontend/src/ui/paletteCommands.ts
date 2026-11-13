import type { CommandId } from './menuBar';
import type { ThemeMode } from '../state/appSession';

/** A command that only shows in the palette. Menu commands get their description from index.html. */
export type PaletteOnlyCommand = { id: CommandId; section: string; label: string; description: string };

// The theme switches stand in for the menu's toggles, and set the app, editor, and preview together.
export const themeSwitchCommands: (PaletteOnlyCommand & { theme: ThemeMode })[] = [
  { theme: 'dark', id: 'view.darkMode', section: 'View', label: 'Switch to dark mode', description: 'Use the dark theme for the app, editor, and preview.' },
  { theme: 'light', id: 'view.lightMode', section: 'View', label: 'Switch to light mode', description: 'Use the light theme for the app, editor, and preview.' },
  { theme: 'system', id: 'view.systemTheme', section: 'View', label: 'Switch to system theme', description: 'Follow your system light or dark setting everywhere.' },
];

export const paletteOnlyCommands: PaletteOnlyCommand[] = [
  { id: 'share.copyLink', section: 'Share', label: 'Copy share link', description: 'Start sharing if needed, and copy the link for others to join.' },
  { id: 'view.focusEditor', section: 'View', label: 'Focus editor', description: 'Put the cursor back in the editor.' },
];
