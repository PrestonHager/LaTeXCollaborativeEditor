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
  new: 'Start a new project?',
  open: 'Open another project?',
  import: 'Upload a .zip as a new project?',
};

const REPLACE_BUTTONS: Record<ReplaceAction, string> = {
  new: 'Start new project',
  open: 'Choose a project',
  import: 'Choose a .zip',
};

/** What the replace dialog says under its title. It has to say it hits everyone in the room. */
const replaceProjectMessage = (action: ReplaceAction): string =>
  `This ${action === 'new' ? 'clears' : 'replaces'} the project for everyone in the room. The current one stays saved where it is.`;

/**
 * The wording for the host's replace dialog: a title, the message, and a button that names the action.
 * New Project always asks, even with nobody in the room. Open and Upload .zip only ask while guests are in it.
 * It's marked destructive while guests are in the room, since it changes their project too.
 */
export const replaceProjectDialog = (action: ReplaceAction, withGuests = true) => ({
  title: REPLACE_QUESTIONS[action],
  // With nobody in the room there's no one else to warn.
  message: withGuests ? replaceProjectMessage(action) : 'The current project stays saved where it is.',
  confirmLabel: REPLACE_BUTTONS[action],
  destructive: withGuests,
});
