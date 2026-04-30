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

  it('shows empty state when filter matches nothing', () => {
    const palette = createCommandPalette({ onSelect: () => {} });
    palette.setCommands([{ id: 'file.new', label: 'New', section: 'File', enabled: true }]);
    palette.open();
    const input = document.querySelector('.command-palette-input') as HTMLInputElement;
    input.value = 'zzznomatch';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector('.command-palette-empty')).toBeTruthy();
  });

  it('closes on overlay click, Escape, and toggle', () => {
    const palette = createCommandPalette({ onSelect: () => {} });
    palette.setCommands([{ id: 'file.new', label: 'New', section: 'File', enabled: true }]);
    palette.open();
    expect(palette.isOpen()).toBe(true);
    document.querySelector('.command-palette-overlay')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(palette.isOpen()).toBe(false);
    palette.open();
    const input = document.querySelector('.command-palette-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(palette.isOpen()).toBe(false);
    palette.open();
    palette.toggle();
    expect(palette.isOpen()).toBe(false);
    palette.toggle();
    expect(palette.isOpen()).toBe(true);
  });

  it('navigates active row with arrow keys and runs Enter on active command', () => {
    const calls: string[] = [];
    const palette = createCommandPalette({ onSelect: (id) => calls.push(id) });
    palette.setCommands([
      { id: 'file.new', label: 'New', section: 'File', enabled: true },
      { id: 'help.about', label: 'About', section: 'Help', enabled: true },
    ]);
    palette.open();
    const input = document.querySelector('.command-palette-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(calls).toEqual(['file.new']);
  });

  it('ignores Enter when active command is disabled or arrows on empty list', () => {
    const calls: string[] = [];
    const palette = createCommandPalette({ onSelect: (id) => calls.push(id) });
    palette.setCommands([{ id: 'file.new', label: 'New', section: 'File', enabled: false }]);
    palette.open();
    const input = document.querySelector('.command-palette-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(calls).toHaveLength(0);

    input.value = 'nomatchzzz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(calls).toHaveLength(0);
  });

  it('does not select disabled rows from click', () => {
    const calls: string[] = [];
    const palette = createCommandPalette({ onSelect: (id) => calls.push(id) });
    palette.setCommands([{ id: 'file.new', label: 'New', section: 'File', enabled: false }]);
    palette.open();
    (document.querySelector('.command-palette-item') as HTMLButtonElement).click();
    expect(calls).toHaveLength(0);
    expect(palette.isOpen()).toBe(true);
  });

  it('dedupes recent commands and sorts by label when scores tie', () => {
    const palette = createCommandPalette({ onSelect: () => {} });
    palette.setCommands([
      { id: 'help.about', label: 'About', section: 'Help', enabled: true },
      { id: 'file.new', label: 'New', section: 'File', enabled: true },
    ]);
    palette.open();
    let input = document.querySelector('.command-palette-input') as HTMLInputElement;
    input.value = 'about';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    palette.open();
    input = document.querySelector('.command-palette-input') as HTMLInputElement;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const mains = Array.from(document.querySelectorAll('.command-palette-item .command-palette-main')).map(
      (el) => el.textContent ?? '',
    );
    expect(mains[0]).toContain('Help: About');
  });
});
