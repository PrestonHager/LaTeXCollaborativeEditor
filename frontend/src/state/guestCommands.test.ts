import { HOST_ONLY_COMMANDS, canRunCommand, replaceProjectDialog } from './guestCommands';
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
    expect(replaceProjectDialog('new')).toEqual({
      title: 'Start a new project?',
      message: 'This clears the project for everyone in the room. The current one stays saved where it is.',
      confirmLabel: 'Start new project',
      destructive: true,
    });
  });

  it('warns the host that Open and Import replace it for everyone in the room', () => {
    expect(replaceProjectDialog('open')).toMatchObject({ title: 'Open another project?', confirmLabel: 'Choose a project', destructive: true });
    expect(replaceProjectDialog('import')).toMatchObject({ title: 'Upload a .zip as a new project?', confirmLabel: 'Choose a .zip' });
    expect(replaceProjectDialog('import').message).toMatch(/^This replaces the project for everyone in the room\./);
  });

  it('drops the warning and the red button when nobody else is in the room', () => {
    expect(replaceProjectDialog('new', false)).toMatchObject({ message: 'The current project stays saved where it is.', destructive: false });
  });
});
