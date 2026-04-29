import { createMenuBar, type CommandId } from './menuBar';

describe('createMenuBar', () => {
  it('renders menus and dispatches enabled command clicks', () => {
    const container = document.createElement('div');
    const calls: CommandId[] = [];
    const enabled = new Map<CommandId, boolean>([
      ['file.new', true],
      ['edit.undo', false],
    ]);

    const menuBar = createMenuBar(container, {
      menus: [
        {
          label: 'File',
          items: [{ commandId: 'file.new', label: 'New', shortcut: 'Ctrl+N' }],
        },
        {
          label: 'Edit',
          items: [{ commandId: 'edit.undo', label: 'Undo', shortcut: 'Ctrl+Z' }],
        },
      ],
      getCommandState: (commandId) => ({ enabled: enabled.get(commandId) ?? true }),
      onCommand: (commandId) => calls.push(commandId),
    });

    const triggers = Array.from(container.querySelectorAll('.menu-trigger')) as HTMLButtonElement[];
    triggers[0].click();
    const newItem = container.querySelector('.menu-item') as HTMLButtonElement;
    expect(newItem.disabled).toBe(false);
    newItem.click();
    expect(calls).toEqual(['file.new']);

    triggers[1].click();
    const items = Array.from(container.querySelectorAll('.menu-item')) as HTMLButtonElement[];
    const undoItem = items[1];
    expect(undoItem.disabled).toBe(true);
    undoItem.click();
    expect(calls).toEqual(['file.new']);
    menuBar.destroy();
  });

  it('supports keyboard navigation between triggers and menu items', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const calls: CommandId[] = [];

    const menuBar = createMenuBar(container, {
      menus: [
        {
          label: 'File',
          items: [
            { commandId: 'file.new', label: 'New' },
            { commandId: 'file.download', label: 'Download' },
          ],
        },
        {
          label: 'Edit',
          items: [{ commandId: 'edit.undo', label: 'Undo' }],
        },
      ],
      getCommandState: () => ({ enabled: true }),
      onCommand: (commandId) => calls.push(commandId),
    });

    const triggers = Array.from(container.querySelectorAll('.menu-trigger')) as HTMLButtonElement[];
    triggers[0].focus();
    triggers[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const firstItem = container.querySelector('.menu-root.is-open .menu-item') as HTMLButtonElement;
    expect(document.activeElement).toBe(firstItem);

    firstItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const activeEditItem = container.querySelector('.menu-root.is-open .menu-item') as HTMLButtonElement;
    expect(activeEditItem.textContent).toContain('Undo');

    triggers[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const editItem = container.querySelector('.menu-root.is-open .menu-item') as HTMLButtonElement;
    editItem.click();
    expect(calls).toContain('edit.undo');
    menuBar.destroy();
    container.remove();
  });
});
