import { HOST_ONLY_COMMANDS, NEW_PROJECT_CONFIRM, canRunCommand } from './guestCommands';
import type { CommandId } from '../ui/menuBar';

describe('guest commands', () => {
  it('blocks guests from replacing the shared project', () => {
    const replacing: CommandId[] = ['file.new', 'file.openLocal', 'file.openDrive', 'file.importZip'];
    for (const id of replacing) {
      expect(HOST_ONLY_COMMANDS.has(id)).toBe(true);
      expect(canRunCommand(id, true)).toBe(false);
      expect(canRunCommand(id, false)).toBe(true);
    }
  });

  it('blocks guests from the host storage commands', () => {
    const storage: CommandId[] = ['file.saveNow', 'file.saveToDrive', 'file.connectDrive', 'file.clearLocalDocs'];
    expect(storage.every((id) => !canRunCommand(id, true))).toBe(true);
  });

  it('lets guests edit files like any collaborator', () => {
    const editing: CommandId[] = ['file.newFile', 'file.newFolder', 'file.upload', 'file.download', 'edit.undo'];
    expect(editing.every((id) => canRunCommand(id, true))).toBe(true);
  });

  it('warns the host that New Project clears it for everyone in the room', () => {
    expect(NEW_PROJECT_CONFIRM).toContain('clears the project for everyone in the room');
  });
});
