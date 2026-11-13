import { createCommandPalette, scoreCommand } from './commandPalette';
import { paletteOnlyCommands, themeSwitchCommands } from './paletteCommands';
import { mountAppShell } from '../test/appShell';

const mountPalette = () => {
  mountAppShell();
  return document.getElementById('command-palette')!;
};

describe('createCommandPalette', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('filters commands and executes selected command', () => {
    const calls: string[] = [];
    const palette = createCommandPalette(mountPalette(), {
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

  it('renders Basecoat command groups with icons and shortcuts', () => {
    const palette = createCommandPalette(mountPalette(), { onSelect: () => {} });
    palette.setCommands([
      { id: 'file.new', label: 'New', section: 'File', enabled: true, shortcut: 'Ctrl+N' },
      { id: 'help.about', label: 'About', section: 'Help', enabled: true },
    ]);
    palette.open();

    expect(document.querySelector('.command-palette.command > header input')).toBeTruthy();
    const groups = document.querySelectorAll('.command-palette-list[role="menu"] > [role="group"]');
    expect(groups.length).toBe(2);
    const first = document.querySelector('.command-palette-list [role="menuitem"]') as HTMLButtonElement;
    expect(first.classList.contains('active')).toBe(true);
    expect(first.querySelector('svg')).toBeTruthy();
    expect(first.querySelector('[data-shortcut]')?.textContent).toBe('Ctrl+N');
  });

  it('promotes recently executed commands and renders section headers', () => {
    const calls: string[] = [];
    const palette = createCommandPalette(mountPalette(), {
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
    const palette = createCommandPalette(mountPalette(), {
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
    const palette = createCommandPalette(mountPalette(), { onSelect: () => {} });
    palette.setCommands([{ id: 'file.new', label: 'New', section: 'File', enabled: true }]);
    palette.open();
    const input = document.querySelector('.command-palette-input') as HTMLInputElement;
    input.value = 'zzznomatch';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector('.command-palette-empty')).toBeTruthy();
  });

  it('closes on overlay click, Escape, and toggle', () => {
    const palette = createCommandPalette(mountPalette(), { onSelect: () => {} });
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
    const palette = createCommandPalette(mountPalette(), { onSelect: (id) => calls.push(id) });
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
    const palette = createCommandPalette(mountPalette(), { onSelect: (id) => calls.push(id) });
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
    const palette = createCommandPalette(mountPalette(), { onSelect: (id) => calls.push(id) });
    palette.setCommands([{ id: 'file.new', label: 'New', section: 'File', enabled: false }]);
    palette.open();
    (document.querySelector('.command-palette-item') as HTMLButtonElement).click();
    expect(calls).toHaveLength(0);
    expect(palette.isOpen()).toBe(true);
  });

  it('dedupes recent commands and sorts by label when scores tie', () => {
    const palette = createCommandPalette(mountPalette(), { onSelect: () => {} });
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

describe('palette descriptions', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const typeQuery = (value: string) => {
    const input = document.querySelector('.command-palette-input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const labels = () => Array.from(document.querySelectorAll('.command-palette-label')).map((el) => el.textContent);

  it('shows a one-line description under each command', () => {
    const palette = createCommandPalette(mountPalette(), { onSelect: () => {} });
    palette.setCommands([{ id: 'help.reportBug', label: 'Report a Bug', section: 'Help', enabled: true, description: 'Open a bug report on GitHub.' }]);
    palette.open();
    expect(document.querySelector('.command-palette-description')?.textContent).toBe('Open a bug report on GitHub.');
    const input = document.querySelector('.command-palette-input') as HTMLInputElement;
    expect(input.getAttribute('aria-activedescendant')).toBe(document.querySelector('.command-palette-item')!.id);
  });

  it('matches whole words in descriptions, after label matches', () => {
    const palette = createCommandPalette(mountPalette(), { onSelect: () => {} });
    palette.setCommands([
      { id: 'help.reportBug', label: 'Report a Bug', section: 'Help', enabled: true, description: 'Open a bug report on GitHub.' },
      { id: 'help.shortcuts', label: 'Keyboard Shortcuts', section: 'Help', enabled: true, description: 'Open the list of keyboard shortcuts.' },
      { id: 'file.saveNow', label: 'Save Now', section: 'File', enabled: true, description: 'Save right away instead of waiting for autosave.' },
    ]);
    palette.open();
    typeQuery('github');
    expect(labels()).toEqual(['Help: Report a Bug']);
    typeQuery('autosave');
    expect(labels()).toEqual(['File: Save Now']);
    typeQuery('waiting autosave');
    expect(labels()).toEqual(['File: Save Now']);
    typeQuery('zzzz');
    expect(labels()).toEqual([]);
  });

  it('scores label matches above description matches', () => {
    const save = { id: 'file.saveNow' as const, label: 'Save Now', section: 'File', enabled: true, description: 'Save right away.' };
    expect(scoreCommand('save', save)).toBeGreaterThan(1);
    expect(scoreCommand('right away', save)).toBe(1);
    expect(scoreCommand('nothing', save)).toBeNull();
    expect(scoreCommand('nothing', { ...save, description: undefined })).toBeNull();
  });

  it('gives every menu command and palette-only command a description, and finds help commands', () => {
    mountAppShell();
    const items = Array.from(document.querySelectorAll<HTMLElement>('.menu-item[data-command]'));
    for (const item of items) expect(item.dataset.description, item.dataset.command).toBeTruthy();
    for (const command of [...paletteOnlyCommands, ...themeSwitchCommands]) expect(command.description, command.id).toBeTruthy();
    const help = items.filter((item) => item.closest('[data-menu-label="Help"]')).map((item) => item.dataset.command);
    expect(help).toEqual(
      expect.arrayContaining(['help.documentation', 'help.shortcuts', 'help.tour', 'help.reportBug', 'help.requestFeature', 'help.about']),
    );
  });

  it('puts focus back after closing, then runs the command', () => {
    const order: string[] = [];
    const opener = document.createElement('button');
    const palette = createCommandPalette(mountPalette(), {
      onSelect: (id) => order.push(`${id}:${document.activeElement === opener}`),
    });
    document.body.append(opener);
    opener.focus();
    palette.setCommands([{ id: 'help.tour', label: 'Show Tour', section: 'Help', enabled: true }]);
    palette.open();
    expect(document.activeElement).not.toBe(opener);
    (document.querySelector('.command-palette-item') as HTMLButtonElement).click();
    expect(order).toEqual(['help.tour:true']);
    palette.open();
    palette.close();
    palette.close();
    expect(document.activeElement).toBe(opener);
  });
});
