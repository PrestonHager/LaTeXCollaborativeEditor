import { createCommandPalette } from './commandPalette';

describe('createCommandPalette', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('filters commands and executes selected command', () => {
    const calls: string[] = [];
    const palette = createCommandPalette({
      onSelect: (id) => calls.push(id),
    });

    palette.setCommands([
      { id: 'file.new', label: 'New', section: 'File', enabled: true, shortcut: 'Ctrl+N' },
      { id: 'help.about', label: 'About', section: 'Help', enabled: true },
    ]);
    palette.open();

    const input = Array.from(document.querySelectorAll('.command-palette-input')).at(-1) as HTMLInputElement;
    input.value = 'about';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(calls).toEqual(['help.about']);
    expect(palette.isOpen()).toBe(false);
  });

  it('promotes recently executed commands and renders section headers', () => {
    const calls: string[] = [];
    const palette = createCommandPalette({
      onSelect: (id) => calls.push(id),
    });
    palette.setCommands([
      { id: 'file.new', label: 'New', section: 'File', enabled: true },
      { id: 'help.about', label: 'About', section: 'Help', enabled: true },
      { id: 'edit.undo', label: 'Undo', section: 'Edit', enabled: true },
    ]);

    palette.open();
    let input = Array.from(document.querySelectorAll('.command-palette-input')).at(-1) as HTMLInputElement;
    input.value = 'about';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(calls).toEqual(['help.about']);

    palette.open();
    input = Array.from(document.querySelectorAll('.command-palette-input')).at(-1) as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const firstItem = document.querySelector('.command-palette-item .command-palette-main');
    expect(firstItem?.textContent).toContain('Help: About');

    const sections = Array.from(document.querySelectorAll('.command-palette-section')).map((el) => el.textContent);
    expect(sections.length).toBeGreaterThan(0);
  });

  it('supports fuzzy query matching for abbreviated input', () => {
    const calls: string[] = [];
    const palette = createCommandPalette({
      onSelect: (id) => calls.push(id),
    });
    palette.setCommands([
      { id: 'file.openDrive', label: 'Open from Google Drive', section: 'File', enabled: true, shortcut: 'Ctrl+Shift+O' },
      { id: 'file.new', label: 'New', section: 'File', enabled: true },
    ]);

    palette.open();
    const input = Array.from(document.querySelectorAll('.command-palette-input')).at(-1) as HTMLInputElement;
    input.value = 'ogd';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(calls).toEqual(['file.openDrive']);
  });
});
