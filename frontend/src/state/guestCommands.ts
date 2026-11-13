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
  'file.renameDrive',
  'file.saveNow',
  'file.clearLocalDocs',
  'file.rename',
  'view.toggleSaveNow',
]);

/** Check if this tab may run a command. Guests can't run host-only ones. */
export const canRunCommand = (commandId: CommandId, isGuest: boolean): boolean =>
  !isGuest || !HOST_ONLY_COMMANDS.has(commandId);

// The host's New Project confirm, which has to say it hits everyone in the room.
export const NEW_PROJECT_CONFIRM =
  'Start a new project? This clears the project for everyone in the room. The current one stays saved where it is.';
