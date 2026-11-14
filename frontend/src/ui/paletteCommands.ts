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
  { id: 'share.copyLink', section: 'Share', label: 'Copy share link', description: 'Copy the link for others to join, or open Share to start sharing.' },
  { id: 'edit.goToDefinition', section: 'Edit', label: 'Go to definition', description: 'Jump to the \\label, .bib entry or \\newcommand for the key or command at the cursor.' },
  { id: 'edit.findReferences', section: 'Edit', label: 'Find references', description: 'List every place the label or citation at the cursor is defined and used.' },
  { id: 'edit.renameLabel', section: 'Edit', label: 'Rename label…', description: 'Rename the label at the cursor and every reference to it, in every file.' },
  { id: 'view.focusEditor', section: 'View', label: 'Focus editor', description: 'Put the cursor back in the editor.' },
];

/** Folders on this computer, in the desktop app only (#178). Pass whether this is the desktop app. */
export const desktopPaletteCommands = (desktop: boolean): PaletteOnlyCommand[] =>
  desktop
    ? [
        { id: 'file.openFolder', section: 'File', label: 'Open Folder as Project', description: 'Open a folder on this computer as the project.' },
        { id: 'file.saveToFolder', section: 'File', label: 'Save to a Folder', description: 'Save the project to a folder on this computer from now on.' },
      ]
    : [];

// Regression testing helpers, only in npm run dev. See dev/regression/checklist.md.
export const devPaletteCommands: PaletteOnlyCommand[] = import.meta.env.DEV
  ? [
      { id: 'dev.openTestProject', section: 'Dev', label: 'Open regression test project', description: 'Load the test LaTeX project that exercises every preview feature.' },
      { id: 'dev.openChecklist', section: 'Dev', label: 'Open regression checklist', description: 'Open the regression checklist in a new tab.' },
    ]
  : [];
