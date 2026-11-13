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
      title: 'Replace the whole project?',
      message:
        'New Project closes every file and folder here for everyone in the room and starts a new project with only main.tex. ' +
        'This project stays saved where it is. To add one file instead, cancel and use File > New File.',
      confirmLabel: 'Start new project',
      destructive: true,
      focusCancel: true,
    });
  });

  it('warns the host that Open and Import replace it for everyone in the room', () => {
    expect(replaceProjectDialog('open')).toMatchObject({ title: 'Open another project?', confirmLabel: 'Choose a project', destructive: true });
    expect(replaceProjectDialog('import')).toMatchObject({ title: 'Upload a .zip as a new project?', confirmLabel: 'Choose a .zip' });
    expect(replaceProjectDialog('import').message).toMatch(/^This replaces the project for everyone in the room\./);
  });

  it('drops the warning and the red button when nobody else is in the room', () => {
    expect(replaceProjectDialog('open', false)).toMatchObject({ message: 'The current project stays saved where it is.', destructive: false });
  });

  it('still says New Project replaces the whole project when nobody else is in the room', () => {
    const dialog = replaceProjectDialog('new', false);
    // Not red with nobody else in the room, but focus still starts on Cancel, so Ctrl+Shift+N then Enter does nothing.
    expect(dialog).toMatchObject({ title: 'Replace the whole project?', confirmLabel: 'Start new project', destructive: false, focusCancel: true });
    expect(replaceProjectDialog('open', false)).not.toHaveProperty('focusCancel');
    expect(dialog.message).toMatch(/^New Project closes every file and folder here and starts a new project with only main\.tex\./);
    expect(dialog.message).toContain('use File > New File');
    expect(dialog.message).not.toContain('everyone in the room');
  });
});
