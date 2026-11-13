import type { CommandId } from '../ui/menuBar';

// Commands that replace the whole project or touch the host's storage.
// A guest running one would wipe the project for everyone in the room, so only the host gets them.
export const HOST_ONLY_COMMANDS: ReadonlySet<CommandId> = new Set<CommandId>([
  'file.new',
  'file.openLocal',
  'file.openDrive',
  'file.importZip',
  'file.connectDrive',
  'file.saveToDrive',
  'file.moveDrive',
  'file.addFromDrive',
  'file.renameDrive',
  'file.saveNow',
  'file.clearLocalDocs',
  'file.rename',
  'view.togglePauseSaving',
]);

/** Check if this tab may run a command. Guests can't run host-only ones. */
export const canRunCommand = (commandId: CommandId, isGuest: boolean): boolean =>
  !isGuest || !HOST_ONLY_COMMANDS.has(commandId);

/** The host commands that swap out the whole shared project. */
export type ReplaceAction = 'new' | 'open' | 'import';

const REPLACE_QUESTIONS: Record<ReplaceAction, string> = {
  // Says the whole project, since people press New meaning New File.
  new: 'Replace the whole project?',
  open: 'Open another project?',
  import: 'Upload a .zip as a new project?',
};

const REPLACE_BUTTONS: Record<ReplaceAction, string> = {
  new: 'Start new project',
  open: 'Choose a project',
  import: 'Choose a .zip',
};

// New Project asks even with nobody in the room, so a misclick meant for New File is easy to back out of.
const NEW_PROJECT_MESSAGE = (forRoom: string) =>
  `New Project closes every file and folder here${forRoom} and starts a new project with only main.tex. ` +
  'This project stays saved where it is. To add one file instead, cancel and use File > New File.';

/** What the replace dialog says under its title. It has to say it hits everyone in the room. */
const replaceProjectMessage = (action: ReplaceAction): string =>
  action === 'new' ? NEW_PROJECT_MESSAGE(' for everyone in the room') : 'This replaces the project for everyone in the room. The current one stays saved where it is.';

/**
 * The wording for the host's replace dialog: a title, the message, and a button that names the action.
 * New Project always asks, even with nobody in the room. Open and Upload .zip only ask while guests are in it.
 * It's marked destructive while guests are in the room, since it changes their project too.
 */
export const replaceProjectDialog = (action: ReplaceAction, withGuests = true) => ({
  title: REPLACE_QUESTIONS[action],
  // With nobody in the room there's no one else to warn.
  message: withGuests ? replaceProjectMessage(action) : action === 'new' ? NEW_PROJECT_MESSAGE('') : 'The current project stays saved where it is.',
  confirmLabel: REPLACE_BUTTONS[action],
  destructive: withGuests,
  // New Project asks to catch a misclick, so Ctrl+Shift+N then Enter must not replace the project.
  ...(action === 'new' ? { focusCancel: true } : {}),
});
