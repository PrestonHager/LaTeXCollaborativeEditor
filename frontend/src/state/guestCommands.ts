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

/** The host's confirm before it replaces the project, which has to say it hits everyone in the room. */
export const replaceProjectConfirm = (action: ReplaceAction): string =>
  `${REPLACE_QUESTIONS[action]} This ${action === 'new' ? 'clears' : 'replaces'} the project for everyone in the room. The current one stays saved where it is.`;

// The host's New Project confirm. New Project always asks, even with nobody in the room.
export const NEW_PROJECT_CONFIRM = replaceProjectConfirm('new');
