import * as Y from 'yjs';
import { ProjectDoc } from '../project/projectDoc';
import { starterProject } from '../project/projectIo';
import type { BlobStore } from '../project/blobStore';
import { createMenuBar, type CommandId, type MenuEntry } from '../ui/menuBar';
import { mountAppShell } from '../test/appShell';
import { MemoryProvider } from '../test/memoryProvider';
import type { PaletteCommand } from '../ui/commandPalette';
import type { StorageProvider } from '../storage/providers/types';
import { replaceProjectDialog } from '../state/guestCommands';
import type { ConfirmOptions, PromptOptions } from '../ui/dialogs';
import { ProjectState, type DriveLike } from './projectState';
import { createThemeController } from './theme';
import { createLayout } from './layout';
import { IMPORT_PICKER_BLOCKED, createCommands, shortcuts, type CommandContext } from './commands';
import { OfflineError } from './lazy';
import { createKeymap, type Keymap } from './keymap';
import { normalizeKeybind } from '../ui/modifierShortcutLabels';
import { createEditorPane } from '../ui/editor';
import { paletteOnlyCommands, themeSwitchCommands } from '../ui/paletteCommands';

class FakeLocal extends MemoryProvider {
  clear = vi.fn(async () => {
    this.projects.clear();
  });
}

class FakeDrive extends MemoryProvider {
  signedIn = true;
  moveProject = vi.fn(async (_projectId: string, _folderId: string) => {});
  disconnect = vi.fn(async () => {
    this.signedIn = false;
  });
  isSignedIn() {
    return this.signedIn;
  }
  hasUsableToken() {
    return this.signedIn;
  }
  legacyProjectId() {
    return null;
  }
}

function setup(options: { isClient?: boolean; entries?: MenuEntry[]; keymap?: Keymap } = {}) {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined }));
  const local = new FakeLocal();
  const drive = new FakeDrive();
  const projectState = new ProjectState(local, drive as DriveLike);
  const themeState = createThemeController();
  const div = () => document.createElement('div');
  const layout = createLayout({ splitRoot: div(), splitter: div(), editorPane: div(), previewPane: div() });
  const project = new ProjectDoc(new Y.Doc());
  project.replaceAll(starterProject('Paper'));
  let palette: PaletteCommand[] = [];
  let paletteOpen = false;
  const undo = { undo: vi.fn(), redo: vi.fn(), canUndo: vi.fn(() => true), canRedo: vi.fn(() => false) };
  const app = {
    isClient: options.isClient ?? false,
    projectState,
    themeState,
    layout,
    compile: { compileNow: vi.fn() },
    localAppProvider: local,
    driveProvider: drive,
    blobs: { get: vi.fn(async () => undefined) } as unknown as BlobStore,
    exportDialog: { open: vi.fn(), runNow: vi.fn(async () => true) },
    autosave: {
      enable: vi.fn(),
      markDirty: vi.fn(),
      saveNow: vi.fn(async () => true),
      setPaused: vi.fn(),
      enqueue: vi.fn((task: () => Promise<void>) => task()),
    },
    session: { broadcastMetadata: vi.fn() },
    editor: { focus: vi.fn(), selectAll: vi.fn(), insertText: vi.fn(() => true) },
    keymap: options.keymap ?? createKeymap(shortcuts, () => 'other'),
    fileTree: { currentFolder: vi.fn(() => '') },
    projectsDialog: { open: vi.fn() },
    uploadDialog: { open: vi.fn() },
    templates: { openNew: vi.fn(async () => {}), saveAsTemplate: vi.fn(async () => {}), editProfile: vi.fn(async () => {}) },
    zipInput: { click: vi.fn() } as unknown as HTMLInputElement,
    shareButtonEl: { click: vi.fn() } as unknown as HTMLElement,
    project,
    undo,
    activeFileId: project.getMainFileId() as string | null,
    menuBar: { refresh: vi.fn(), entries: () => options.entries ?? [] },
    commandPalette: {
      toggle: vi.fn(() => {
        paletteOpen = !paletteOpen;
      }),
      isOpen: () => paletteOpen,
      setCommands: (next: PaletteCommand[]) => {
        palette = next;
      },
    },
    settingsDialog: { open: vi.fn() },
    guestCount: vi.fn(() => 0),
    projectName: () => project.getName() || 'Untitled',
    setStatus: vi.fn(),
    showNotice: vi.fn(),
    persistAppSession: vi.fn(),
    runFileOp: vi.fn((op: () => void) => op()),
    openFile: vi.fn(),
    downloadFile: vi.fn(async () => {}),
    switchProject: vi.fn(async () => {}),
    openStoredProject: vi.fn(async () => {}),
    useProvider: vi.fn((provider: StorageProvider, id: string | null) => projectState.use(provider, id)),
    switchToDrive: vi.fn(() => projectState.use(drive, null)),
    promptForProjectName: vi.fn(async () => true),
    // The in-app dialogs answer yes, and the name prompt cancels, unless a test says otherwise.
    confirmDialog: vi.fn(async (_options: ConfirmOptions) => true),
    promptDialog: vi.fn(async (_options: PromptOptions): Promise<string | null> => null),
    renameProject: vi.fn(async () => {}),
    ensureDrivePickerConfig: vi.fn(() => true),
    ensureDriveConnected: vi.fn(async () => true),
    pickFromDrive: vi.fn(async () => ({ id: 'f1', name: 'Folder', isFolder: true }) as never),
    showDriveAccount: vi.fn(),
    addFilesFromDrive: vi.fn(async () => {}),
    toolbar: { refresh: vi.fn() },
    openDocs: vi.fn(),
    openBugForm: vi.fn(),
    openSecurityReport: vi.fn(),
    openFeatureForm: vi.fn(),
    startTour: vi.fn(),
    openAbout: vi.fn(),
  } satisfies CommandContext;
  const commands = createCommands(app);
  // Run a command and let its promise settle.
  const run = async (id: CommandId) => {
    commands.executeCommand(id);
    await settle();
  };
  return { app, commands, run, local, drive, projectState, themeState, layout, project, undo, palette: () => palette };
}

/** Let pending promises (like a dialog's answer) settle. */
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const key = (k: string, extra: Partial<KeyboardEventInit> = {}) => new KeyboardEvent('keydown', { key: k, ctrlKey: true, cancelable: true, ...extra });

describe('commands', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('shortcuts', () => {
    it('lists every built-in keybind in its stored form, once', () => {
      const keys = shortcuts.map((shortcut) => shortcut.keybind);
      for (const keybind of keys) expect(normalizeKeybind(keybind, 'other'), keybind).toBe(keybind);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('keeps Compile Now off Ctrl+Shift+C, which opens the inspector (#21)', () => {
      expect(shortcuts.find((shortcut) => shortcut.id === 'view.compileNow')?.keybind).toBe('Mod+Enter');
      expect(shortcuts.some((shortcut) => shortcut.keybind === 'Mod+Shift+C')).toBe(false);
    });

    it('fills the menu shortcut labels from the table', () => {
      mountAppShell();
      const keymap = createKeymap(shortcuts, () => 'other');
      createMenuBar(document.getElementById('menu-bar')!, {
        getCommandState: () => ({ enabled: true }),
        onCommand: () => undefined,
        shortcutLabel: (id) => keymap.labelFor(id),
      }).destroy();
      const label = (id: string) => document.querySelector(`.menu-item[data-command="${id}"] [data-shortcut]`)?.textContent;
      expect(label('file.saveNow')).toBe('Ctrl+S');
      expect(label('file.openDrive')).toBe('Ctrl+Shift+O');
      expect(label('edit.redo')).toBe('Ctrl+Shift+Z');
      expect(label('view.compileNow')).toBe('Ctrl+Enter');
      expect(label('app.commandPalette')).toBe('Ctrl+P');
      expect(label('file.new')).toBe('Ctrl+Shift+N');
      expect(label('file.newFile')).toBe('Ctrl+N');
      expect(label('file.newFolder')).toBe('');
      // No keybind lives in the HTML any more.
      expect(document.querySelector('[data-chord]')).toBeNull();
    });
  });

  it('has a handler for every menu item and palette-only command', () => {
    mountAppShell();
    const { commands } = setup();
    const menuIds = Array.from(document.querySelectorAll<HTMLElement>('[data-command]')).map((item) => item.dataset.command!);
    const ids = [...menuIds, ...paletteOnlyCommands.map((c) => c.id), ...themeSwitchCommands.map((c) => c.id), ...shortcuts.map((s) => s.id)];
    for (const id of ids) expect(commands.commandRegistry, id).toHaveProperty([id]);
  });

  it('builds the palette from the real menus plus palette-only commands', () => {
    mountAppShell();
    const menuBar = createMenuBar(document.getElementById('menu-bar')!, { getCommandState: () => ({ enabled: true }), onCommand: () => undefined });
    const { commands, projectState } = setup({ entries: menuBar.entries() });
    let palette = commands.buildPaletteCommands();
    const ids = palette.map((command) => command.id);
    expect(ids).toContain('file.new');
    expect(ids).not.toContain('view.toggleEditorTheme');
    expect(ids).toEqual(expect.arrayContaining(['share.copyLink', 'view.focusEditor', 'view.darkMode', 'view.lightMode']));
    // Both themes are already system, so that switch is hidden.
    expect(ids).not.toContain('view.systemTheme');
    expect(palette.find((command) => command.id === 'view.togglePauseSaving')?.label).toBe('Pause Saving');
    projectState.savingPaused = true;
    palette = commands.buildPaletteCommands();
    expect(palette.find((command) => command.id === 'view.togglePauseSaving')?.label).toBe('Resume Saving');
    expect(palette.find((command) => command.id === 'file.saveNow')?.enabled).toBe(false);
    menuBar.destroy();
  });

  describe('command state', () => {
    it('turns off host-only commands for guests', () => {
      const { commands } = setup({ isClient: true });
      expect(commands.getCommandState('file.new').enabled).toBe(false);
      expect(commands.getCommandState('file.saveNow').enabled).toBe(false);
      expect(commands.getCommandState('view.togglePauseSaving')).toEqual({ enabled: false, checked: false });
      expect(commands.getCommandState('file.disconnectDrive').enabled).toBe(false);
      // Guests have the host's project here, so they can add files.
      expect(commands.getCommandState('file.newFile').enabled).toBe(true);
    });

    it('lets guests add files only once the project arrives', () => {
      const { commands, project } = setup({ isClient: true });
      project.replaceAll({ name: '', files: [] });
      expect(commands.getCommandState('file.upload').enabled).toBe(false);
    });

    it('follows the provider, open file, undo stack, and layout', () => {
      const { commands, app, projectState, drive, layout } = setup();
      expect(commands.getCommandState('file.moveDrive').enabled).toBe(false);
      expect(commands.getCommandState('file.addFromDrive').enabled).toBe(false);
      projectState.use(drive, 'folder');
      expect(commands.getCommandState('file.moveDrive').enabled).toBe(true);
      expect(commands.getCommandState('file.addFromDrive').enabled).toBe(true);
      expect(commands.getCommandState('file.downloadFile').enabled).toBe(true);
      app.activeFileId = null;
      expect(commands.getCommandState('file.downloadFile').enabled).toBe(false);
      expect(commands.getCommandState('edit.undo').enabled).toBe(true);
      expect(commands.getCommandState('edit.redo').enabled).toBe(false);
      expect(commands.getCommandState('view.layoutSplit').checked).toBe(true);
      layout.setMode('preview-only');
      expect(commands.getCommandState('view.layoutPreviewOnly').checked).toBe(true);
      expect(commands.getCommandState('view.layoutEditorOnly').checked).toBe(false);
      expect(commands.getCommandState('help.about').enabled).toBe(true);
    });

    it('turns on Disconnect Google Drive only while signed in', () => {
      const { commands, drive } = setup();
      expect(commands.getCommandState('file.disconnectDrive').enabled).toBe(true);
      drive.signedIn = false;
      expect(commands.getCommandState('file.disconnectDrive').enabled).toBe(false);
    });

    it('checks Pause Saving while saving is paused', () => {
      const { commands, projectState } = setup();
      expect(commands.getCommandState('view.togglePauseSaving')).toEqual({ enabled: true, checked: false });
      expect(commands.getCommandState('file.saveNow').enabled).toBe(true);
      projectState.savingPaused = true;
      expect(commands.getCommandState('view.togglePauseSaving')).toEqual({ enabled: true, checked: true });
      expect(commands.getCommandState('file.saveNow').enabled).toBe(false);
    });
  });

  describe('running commands', () => {
    it('reports errors from commands and refreshes the menus', async () => {
      const { commands, app, run } = setup();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      app.settingsDialog.open.mockImplementation(() => {
        throw new Error('sync failure');
      });
      commands.executeCommand('app.openSettings');
      expect(app.showNotice).toHaveBeenCalledWith('sync failure', true);
      app.renameProject.mockRejectedValue(new Error('async failure'));
      await run('file.rename');
      expect(app.showNotice).toHaveBeenCalledWith('async failure', true);
      expect(app.menuBar.refresh).toHaveBeenCalled();
    });

    it('redraws the menus, toolbar and palette once per command, after it finishes', async () => {
      const { commands, app } = setup();
      const palette = vi.spyOn(app.commandPalette, 'setCommands');
      commands.executeCommand('help.about');
      expect(app.menuBar.refresh).toHaveBeenCalledTimes(1);
      expect(app.toolbar.refresh).toHaveBeenCalledTimes(1);
      expect(palette).toHaveBeenCalledTimes(1);

      let finish = () => {};
      app.renameProject.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
      app.menuBar.refresh.mockClear();
      commands.executeCommand('file.rename');
      // Still running, so nothing to redraw yet.
      expect(app.menuBar.refresh).not.toHaveBeenCalled();
      finish();
      await settle();
      expect(app.menuBar.refresh).toHaveBeenCalledTimes(1);
    });

    it('hands a part of the app that did not load to loadFailed, named after the command', async () => {
      const entries = [{ commandId: 'file.rename', label: 'Rename Project', section: 'File' }] as MenuEntry[];
      const { app, run } = setup({ entries });
      const loadFailed = vi.fn();
      Object.assign(app, { loadFailed });
      const offline = new OfflineError();
      app.renameProject.mockRejectedValue(offline);
      await run('file.rename');
      expect(loadFailed).toHaveBeenCalledWith('Rename Project', offline);
      expect(app.showNotice).not.toHaveBeenCalled();

      const chunk = new TypeError('Failed to fetch dynamically imported module: https://x/assets/zip-abc.js');
      app.openAbout.mockImplementation(() => {
        throw chunk;
      });
      await run('help.about');
      expect(loadFailed).toHaveBeenCalledWith('That command', chunk);
    });

    it('skips host-only commands for guests', async () => {
      const { app, run } = setup({ isClient: true });
      for (const id of ['file.new', 'file.openLocal', 'file.openDrive', 'file.importZip', 'file.connectDrive', 'file.saveToDrive', 'file.moveDrive', 'file.addFromDrive', 'file.saveNow', 'file.clearLocalDocs'] as CommandId[]) {
        await run(id);
      }
      expect(app.addFilesFromDrive).not.toHaveBeenCalled();
      expect(app.switchProject).not.toHaveBeenCalled();
      expect(app.projectsDialog.open).not.toHaveBeenCalled();
      expect(app.zipInput.click).not.toHaveBeenCalled();
      expect(app.autosave.enable).not.toHaveBeenCalled();
      expect(app.ensureDriveConnected).not.toHaveBeenCalled();
    });

    it('blocks host-only commands for guests before their handlers run', async () => {
      const { app, run, commands, projectState, drive } = setup({ isClient: true });
      // These handlers don't check for guests themselves, so only the guest check stops them.
      await run('file.rename');
      await run('file.renameDrive');
      expect(app.renameProject).not.toHaveBeenCalled();
      await run('view.togglePauseSaving');
      expect(projectState.savingPaused).toBe(false);
      expect(app.autosave.setPaused).not.toHaveBeenCalled();
      await run('file.disconnectDrive');
      expect(drive.disconnect).not.toHaveBeenCalled();
      // Guests still get the commands that don't touch the shared project.
      await run('help.about');
      expect(app.openAbout).toHaveBeenCalled();
      // A blocked command returns right away, without touching the menus.
      app.menuBar.refresh.mockClear();
      commands.executeCommand('file.new');
      expect(app.menuBar.refresh).not.toHaveBeenCalled();
    });

    it('opens the template picker for New Project, which does its own asking', async () => {
      const { app, run } = setup();
      await run('file.new');
      expect(app.templates.openNew).toHaveBeenCalledTimes(1);
      expect(app.confirmDialog).not.toHaveBeenCalled();
      expect(app.switchProject).not.toHaveBeenCalled();
    });

    it('opens Save as Template and the profile through the template dialogs', async () => {
      const { app, run } = setup();
      await run('file.saveAsTemplate');
      await run('app.editProfile');
      expect(app.templates.saveAsTemplate).toHaveBeenCalledTimes(1);
      expect(app.templates.editProfile).toHaveBeenCalledTimes(1);
    });

    it('lets guests edit their own profile but not save the host\'s project as a template', async () => {
      const { app, run, commands } = setup({ isClient: true });
      await run('file.saveAsTemplate');
      await run('app.editProfile');
      expect(app.templates.saveAsTemplate).not.toHaveBeenCalled();
      expect(app.templates.editProfile).toHaveBeenCalledTimes(1);
      expect(commands.getCommandState('file.saveAsTemplate').enabled).toBe(false);
    });

    it('reports a picker error that is not a load failure', async () => {
      const { app, run } = setup();
      app.templates.openNew.mockRejectedValueOnce(new Error('Broken'));
      await run('file.new');
      expect(app.showNotice).toHaveBeenCalledWith('Broken', true);
      expect(app.switchProject).not.toHaveBeenCalled();
    });

    it('falls back to an empty project, after confirming, when the template picker cannot load', async () => {
      const { app, run, local } = setup();
      app.templates.openNew.mockRejectedValue(new OfflineError());
      const confirm = app.confirmDialog.mockResolvedValue(false);
      await run('file.new');
      // With nobody in the room it isn't a destructive action, so the button isn't red.
      expect(confirm).toHaveBeenCalledWith(replaceProjectDialog('new', false));
      expect(confirm.mock.calls[0][0]).toMatchObject({ title: 'Replace the whole project?', confirmLabel: 'Start new project', destructive: false });
      expect(app.switchProject).not.toHaveBeenCalled();
      app.guestCount.mockReturnValue(1);
      await run('file.new');
      expect(confirm).toHaveBeenLastCalledWith(replaceProjectDialog('new', true));
      expect(app.switchProject).not.toHaveBeenCalled();
      confirm.mockResolvedValue(true);
      await run('file.new');
      expect(app.switchProject).toHaveBeenCalledWith(expect.objectContaining({ mainPath: 'main.tex' }), local, null);
    });

    it('opens local projects and imports zips', async () => {
      const { app, run, local } = setup();
      await local.createProject('Old');
      await run('file.openLocal');
      expect(app.projectsDialog.open).toHaveBeenCalledWith([expect.objectContaining({ name: 'Old' })]);
      await run('file.importZip');
      expect(app.zipInput.click).toHaveBeenCalled();
    });

    it('opens and imports without asking when no guest is in the room', async () => {
      const { app, run } = setup();
      const confirm = app.confirmDialog;
      await run('file.openLocal');
      await run('file.openDrive');
      await run('file.importZip');
      expect(confirm).not.toHaveBeenCalled();
      expect(app.projectsDialog.open).toHaveBeenCalled();
      expect(app.openStoredProject).toHaveBeenCalled();
      expect(app.zipInput.click).toHaveBeenCalled();
    });

    it('asks the host before opening or importing while guests are in the room', async () => {
      const { app, run, drive } = setup();
      app.guestCount.mockReturnValue(2);
      const confirm = app.confirmDialog.mockResolvedValue(false);
      await run('file.openLocal');
      await run('file.openDrive');
      await run('file.importZip');
      // Cancel stops before any dialog, sign-in, or file picker opens.
      expect(confirm.mock.calls).toEqual([[replaceProjectDialog('open')], [replaceProjectDialog('open')], [replaceProjectDialog('import')]]);
      expect(confirm.mock.calls[2][0]).toMatchObject({ confirmLabel: 'Choose a .zip', destructive: true });
      expect(app.projectsDialog.open).not.toHaveBeenCalled();
      expect(app.ensureDriveConnected).not.toHaveBeenCalled();
      expect(app.pickFromDrive).not.toHaveBeenCalled();
      expect(app.openStoredProject).not.toHaveBeenCalled();
      expect(app.zipInput.click).not.toHaveBeenCalled();
      expect(app.switchProject).not.toHaveBeenCalled();
      expect(app.setStatus).not.toHaveBeenCalled();
      // OK goes ahead as before.
      confirm.mockResolvedValue(true);
      await run('file.openLocal');
      await run('file.openDrive');
      await run('file.importZip');
      expect(app.projectsDialog.open).toHaveBeenCalled();
      expect(app.openStoredProject).toHaveBeenCalledWith(drive, 'f1');
      expect(app.zipInput.click).toHaveBeenCalled();
    });

    it('asks once for Upload .zip in the Open dialog after the host OKs Open', async () => {
      const { app, run, commands } = setup();
      app.guestCount.mockReturnValue(1);
      const confirm = app.confirmDialog.mockResolvedValue(true);
      await run('file.openLocal');
      commands.importZipFromOpenDialog();
      // No dialog in between, so the picker opens inside the same click.
      expect(app.zipInput.click).toHaveBeenCalledTimes(1);
      expect(confirm.mock.calls).toEqual([[replaceProjectDialog('open')]]);
      // The other ways in still ask.
      await run('file.importZip');
      expect(confirm).toHaveBeenLastCalledWith(replaceProjectDialog('import'));
      expect(app.zipInput.click).toHaveBeenCalledTimes(2);
      // A canceled Open doesn't count as a yes.
      confirm.mockResolvedValue(false);
      await run('file.openLocal');
      confirm.mockClear();
      commands.importZipFromOpenDialog();
      await settle();
      expect(confirm).toHaveBeenCalledWith(replaceProjectDialog('import'));
      expect(app.zipInput.click).toHaveBeenCalledTimes(2);
    });

    it('asks in the Open dialog when a guest joined after it opened', async () => {
      const { app, run, commands } = setup();
      const confirm = app.confirmDialog.mockResolvedValue(false);
      await run('file.openLocal');
      expect(confirm).not.toHaveBeenCalled();
      app.guestCount.mockReturnValue(1);
      commands.importZipFromOpenDialog();
      await settle();
      expect(confirm).toHaveBeenCalledWith(replaceProjectDialog('import'));
      expect(app.zipInput.click).not.toHaveBeenCalled();
    });

    it('never imports from the Open dialog in a guest tab', () => {
      const { app, commands } = setup({ isClient: true });
      commands.importZipFromOpenDialog();
      expect(app.zipInput.click).not.toHaveBeenCalled();
    });

    it('says so when the browser no longer counts the click, and skips the confirm on the retry', async () => {
      const { app, run } = setup();
      app.guestCount.mockReturnValue(1);
      const confirm = app.confirmDialog.mockResolvedValue(true);
      vi.stubGlobal('navigator', { userActivation: { isActive: false } });
      await run('file.importZip');
      expect(app.zipInput.click).not.toHaveBeenCalled();
      expect(app.showNotice).toHaveBeenCalledWith(IMPORT_PICKER_BLOCKED);
      // The retry is a fresh click, so the picker opens without asking again.
      vi.stubGlobal('navigator', { userActivation: { isActive: true } });
      await run('file.importZip');
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(app.zipInput.click).toHaveBeenCalledTimes(1);
      // That OK only counts once.
      await run('file.importZip');
      expect(confirm).toHaveBeenCalledTimes(2);
    });

    it('opens a Drive folder or a single legacy file', async () => {
      const { app, run, drive } = setup();
      await run('file.openDrive');
      expect(app.openStoredProject).toHaveBeenLastCalledWith(drive, 'f1');
      app.pickFromDrive.mockResolvedValueOnce({ id: 'file-1', name: 'old.tex', isFolder: false } as never);
      await run('file.openDrive');
      expect(app.openStoredProject).toHaveBeenLastCalledWith(drive, expect.stringContaining('file-1'));
      app.pickFromDrive.mockResolvedValueOnce(null as never);
      await run('file.openDrive');
      expect(app.setStatus).toHaveBeenLastCalledWith('Drive: Selection canceled');
      app.pickFromDrive.mockResolvedValueOnce(undefined as never);
      app.ensureDrivePickerConfig.mockReturnValueOnce(false);
      await run('file.openDrive');
      expect(app.openStoredProject).toHaveBeenCalledTimes(2);
    });

    it('adds files and folders in the current folder', async () => {
      const { app, run, project } = setup();
      app.fileTree.currentFolder.mockReturnValue('chapters');
      const prompt = app.promptDialog.mockResolvedValue('intro');
      await run('file.newFile');
      expect(project.findByPath('chapters/intro.tex')).toBeDefined();
      expect(app.openFile).toHaveBeenCalled();
      const fileAsk = prompt.mock.calls[0][0];
      expect(fileAsk).toMatchObject({ title: 'New file', label: 'File name', initialValue: 'chapter.tex', confirmLabel: 'Create file' });
      // The name is checked inline, with the .tex it would get.
      expect(fileAsk.validate?.('intro')).toBe('chapters/intro.tex already exists.');
      expect(fileAsk.validate?.('')).toBe('Enter a name.');
      expect(fileAsk.validate?.('a:b')).toBe("Names can't contain :.");
      expect(fileAsk.validate?.('notes.md')).toBeNull();
      // A taken name gets the next free one, with the folder and the .tex it would get.
      expect(fileAsk.suggest?.('intro')).toEqual({ value: 'intro (2)', message: "chapters/intro.tex already exists, so here's chapters/intro (2).tex instead." });
      expect(fileAsk.suggest?.('notes.md')).toBeNull();
      expect(fileAsk.suggest?.('a:b')).toBeNull();
      prompt.mockResolvedValue('figures');
      await run('file.newFolder');
      expect(project.findByPath('chapters/figures')?.kind).toBe('folder');
      const folderAsk = prompt.mock.calls[1][0];
      expect(folderAsk).toMatchObject({ title: 'New folder', confirmLabel: 'Create folder' });
      expect(folderAsk.validate?.('figures')).toBe('chapters/figures already exists.');
      expect(folderAsk.suggest?.('figures')?.value).toBe('figures (2)');
      // Cancel adds nothing.
      prompt.mockResolvedValue(null);
      await run('file.newFile');
      await run('file.newFolder');
      expect(app.openFile).toHaveBeenCalledTimes(1);
      // A name taken between the check and the click still shows the error, not a crash.
      prompt.mockResolvedValue('intro');
      await run('file.newFile');
      expect(app.openFile).toHaveBeenCalledTimes(1);
      await run('file.upload');
      expect(app.uploadDialog.open).toHaveBeenCalledWith('chapters');
    });

    it('downloads the project and the open file, and opens the Export dialog', async () => {
      const { app, run } = setup();
      await run('file.download');
      // Download Project .zip is the zip exporter with no dialog.
      await vi.waitFor(() => expect(app.exportDialog.runNow).toHaveBeenCalledWith('zip'));
      expect(app.exportDialog.open).not.toHaveBeenCalled();
      await run('file.export');
      expect(app.exportDialog.open).toHaveBeenCalledTimes(1);
      await run('file.downloadFile');
      expect(app.downloadFile).toHaveBeenCalledWith('main.tex');
    });

    it('lets guests export, since it only reads the project', () => {
      const { commands } = setup({ isClient: true });
      expect(commands.getCommandState('file.export').enabled).toBe(true);
      expect(commands.getCommandState('file.download').enabled).toBe(true);
    });

    it('connects and saves to Drive', async () => {
      const { app, run, projectState, project } = setup();
      await run('file.connectDrive');
      expect(projectState.isDrive()).toBe(true);
      expect(app.setStatus).toHaveBeenLastCalledWith('Drive: Connected');
      expect(app.autosave.markDirty).toHaveBeenCalled();
      project.setName('');
      await run('file.connectDrive');
      expect(app.setStatus).toHaveBeenLastCalledWith('Drive: Connected (name the project to save)');
      project.setName('Paper');
      await run('file.saveToDrive');
      expect(app.setStatus).toHaveBeenLastCalledWith('Drive: Saved Paper');
      expect(app.session.broadcastMetadata).toHaveBeenCalledWith({ title: 'Paper', storage: 'Saved on host Google Drive' });
      app.ensureDriveConnected.mockResolvedValueOnce(false);
      await run('file.connectDrive');
      app.promptForProjectName.mockResolvedValueOnce(false);
      await run('file.saveToDrive');
      expect(app.autosave.saveNow).toHaveBeenCalledTimes(1);
    });

    it('runs Add Files from Drive for the host, and keeps it off for guests on Drive', async () => {
      const { app, run, commands, projectState, drive } = setup();
      projectState.use(drive, 'p1');
      await run('file.addFromDrive');
      expect(app.addFilesFromDrive).toHaveBeenCalledTimes(1);
      const guest = setup({ isClient: true });
      guest.projectState.use(guest.drive, 'p1');
      expect(guest.commands.getCommandState('file.addFromDrive').enabled).toBe(false);
      expect(commands.getCommandState('file.addFromDrive').enabled).toBe(true);
    });

    it('moves a Drive project only once it is on Drive', async () => {
      const { app, run, projectState, drive } = setup();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await run('file.moveDrive');
      expect(app.setStatus).toHaveBeenLastCalledWith('Drive: Save the project to Drive first');
      projectState.use(drive, 'p1');
      await run('file.moveDrive');
      expect(drive.moveProject).toHaveBeenCalledWith('p1', 'f1');
      expect(app.setStatus).toHaveBeenLastCalledWith('Drive: Moved to Folder');
      app.pickFromDrive.mockResolvedValueOnce(null as never);
      await run('file.moveDrive');
      expect(app.setStatus).toHaveBeenLastCalledWith('Drive: Move canceled');
      drive.moveProject.mockRejectedValueOnce(new Error('nope'));
      await run('file.moveDrive');
      expect(app.setStatus).toHaveBeenLastCalledWith('nope');
    });

    it('saves now unless saving is paused or Drive signed out', async () => {
      const { app, run, projectState, drive } = setup();
      await run('file.saveNow');
      expect(app.autosave.saveNow).toHaveBeenCalledTimes(1);
      projectState.use(drive, 'p1');
      drive.signedIn = false;
      await run('file.saveNow');
      expect(app.setStatus).toHaveBeenLastCalledWith('Drive: Session expired. Use File > Connect Google Drive to sign in again.');
      projectState.savingPaused = true;
      await run('file.saveNow');
      expect(app.autosave.saveNow).toHaveBeenCalledTimes(1);
    });

    it('clears local projects after confirming', async () => {
      const { app, run, local } = setup();
      await run('file.clearLocalDocs');
      expect(app.setStatus).toHaveBeenLastCalledWith('No local projects to clear');
      await local.createProject('Old');
      const confirm = app.confirmDialog.mockResolvedValue(false);
      await run('file.clearLocalDocs');
      expect(local.clear).not.toHaveBeenCalled();
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete all local projects?', confirmLabel: 'Delete 1 project', destructive: true }));
      confirm.mockResolvedValue(true);
      await run('file.clearLocalDocs');
      expect(local.clear).toHaveBeenCalled();
      expect(app.useProvider).toHaveBeenCalledWith(local, null);
      expect(app.setStatus).toHaveBeenLastCalledWith('Local projects cleared');
    });

    it('runs the edit commands against the editor and undo stack', async () => {
      const { app, run, undo } = setup();
      // jsdom has no execCommand or clipboard, so we give it both.
      const exec = vi.fn();
      document.execCommand = exec;
      vi.stubGlobal('navigator', { ...navigator, clipboard: { readText: vi.fn(async () => '\\section{Pasted}') } });
      for (const id of ['edit.undo', 'edit.redo', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.selectAll', 'view.focusEditor'] as CommandId[]) {
        await run(id);
      }
      expect(undo.undo).toHaveBeenCalled();
      expect(undo.redo).toHaveBeenCalled();
      // Paste reads the clipboard itself, since browsers block execCommand('paste') (#21).
      expect(exec.mock.calls.map(([name]) => name)).toEqual(['cut', 'copy']);
      expect(app.editor.insertText).toHaveBeenCalledWith('\\section{Pasted}');
      expect(app.editor.selectAll).toHaveBeenCalled();
      expect(app.editor.focus).toHaveBeenCalledTimes(4);
    });

    it('says so when the browser will not let Paste read the clipboard', async () => {
      const { app, run } = setup();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.stubGlobal('navigator', { ...navigator, clipboard: { readText: vi.fn(async () => Promise.reject(new DOMException('Denied', 'NotAllowedError'))) } });
      await run('edit.paste');
      expect(app.editor.insertText).not.toHaveBeenCalled();
      expect(app.showNotice).toHaveBeenCalledWith("The browser didn't allow reading the clipboard. Press Ctrl+V to paste instead.", true);
      // Older browsers have no clipboard API at all.
      vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
      await run('edit.paste');
      expect(app.showNotice).toHaveBeenCalledTimes(2);
    });

    it('says so when there is no text file to paste into', async () => {
      const { app, run } = setup();
      vi.stubGlobal('navigator', { ...navigator, clipboard: { readText: vi.fn(async () => 'x') } });
      vi.mocked(app.editor.insertText).mockReturnValue(false);
      await run('edit.paste');
      expect(app.showNotice).toHaveBeenCalledWith('Open a text file to paste into it.');
    });

    it('cycles and sets themes', async () => {
      const { app, run, themeState, palette } = setup();
      await run('view.toggleEditorTheme');
      expect(themeState.editorTheme).toBe('dark');
      await run('view.togglePreviewTheme');
      expect(themeState.previewTheme).toBe('dark');
      await run('view.lightMode');
      expect([themeState.editorTheme, themeState.previewTheme]).toEqual(['light', 'light']);
      expect(palette().map((command) => command.id)).not.toContain('view.lightMode');
      await run('view.darkMode');
      await run('view.systemTheme');
      expect(themeState.editorTheme).toBe('system');
      expect(app.persistAppSession).toHaveBeenCalledTimes(5);
    });

    it('names the file op Undo and Redo will do, in the menu state and the palette', () => {
      mountAppShell();
      const menuBar = createMenuBar(document.getElementById('menu-bar')!, { getCommandState: () => ({ enabled: true }), onCommand: () => undefined });
      const t = setup({ entries: menuBar.entries() });
      expect(t.commands.getCommandState('edit.undo').label).toBeUndefined();
      Object.assign(t.undo, { undoLabel: () => 'Delete chapter.tex', redoLabel: () => 'Rename a.tex' });
      expect(t.commands.getCommandState('edit.undo').label).toBe('Undo Delete chapter.tex');
      expect(t.commands.getCommandState('edit.redo').label).toBe('Redo Rename a.tex');
      t.commands.refreshCommands();
      expect(t.palette().find((command) => command.id === 'edit.undo')?.label).toBe('Undo Delete chapter.tex');
    });

    it('pauses and resumes saving for hosts only', async () => {
      mountAppShell();
      const menuBar = createMenuBar(document.getElementById('menu-bar')!, { getCommandState: () => ({ enabled: true }), onCommand: () => undefined });
      const host = setup({ entries: menuBar.entries() });
      await host.run('view.togglePauseSaving');
      expect(host.projectState.savingPaused).toBe(true);
      expect(host.app.autosave.setPaused).toHaveBeenLastCalledWith(true);
      expect(host.app.persistAppSession).toHaveBeenCalled();
      expect(host.palette().find((command) => command.id === 'view.togglePauseSaving')?.label).toBe('Resume Saving');
      await host.run('view.togglePauseSaving');
      expect(host.projectState.savingPaused).toBe(false);
      expect(host.app.autosave.setPaused).toHaveBeenLastCalledWith(false);
      expect(host.palette().find((command) => command.id === 'view.togglePauseSaving')?.label).toBe('Pause Saving');
      const guest = setup({ isClient: true });
      guest.commands.setSavingPaused(true);
      expect(guest.projectState.savingPaused).toBe(false);
      expect(guest.app.autosave.setPaused).not.toHaveBeenCalled();
      menuBar.destroy();
    });

    it('disconnects Drive and moves saves to this browser', async () => {
      const { app, run, projectState, drive, local } = setup();
      projectState.use(drive, 'folder-1');
      await run('file.disconnectDrive');
      expect(app.useProvider).toHaveBeenCalledWith(local, null);
      expect(projectState.activeProvider).toBe(local);
      expect(app.autosave.enqueue).toHaveBeenCalled();
      expect(drive.disconnect).toHaveBeenCalled();
      expect(app.showDriveAccount).toHaveBeenCalled();
      expect(app.showNotice).toHaveBeenCalledWith('Disconnected Google Drive. Edits now save in this browser.');
      expect(app.autosave.saveNow).toHaveBeenCalled();
      // Once signed out, there's nothing left to disconnect.
      await run('file.disconnectDrive');
      expect(drive.disconnect).toHaveBeenCalledTimes(1);
    });

    it('disconnects Drive without switching provider when saves are already local', async () => {
      const { app, run, drive } = setup();
      await run('file.disconnectDrive');
      expect(app.useProvider).not.toHaveBeenCalled();
      expect(drive.disconnect).toHaveBeenCalled();
    });

    it('runs the view, share, and help commands', async () => {
      const { app, run, layout } = setup();
      await run('view.layoutEditorOnly');
      expect(layout.mode).toBe('editor-only');
      await run('view.layoutPreviewOnly');
      expect(layout.mode).toBe('preview-only');
      await run('view.layoutSplit');
      expect(layout.mode).toBe('split');
      await run('view.compileNow');
      expect(app.compile.compileNow).toHaveBeenCalled();
      await run('share.copyLink');
      expect(app.shareButtonEl.click).toHaveBeenCalled();
      await run('app.openSettings');
      expect(app.settingsDialog.open).toHaveBeenCalled();
      await run('file.renameDrive');
      expect(app.renameProject).toHaveBeenCalled();
      await run('app.commandPalette');
      expect(app.commandPalette.toggle).toHaveBeenCalled();
      await run('help.documentation');
      expect(app.openDocs).toHaveBeenCalledWith('gettingStarted');
      await run('help.shortcuts');
      expect(app.openDocs).toHaveBeenCalledWith('shortcuts');
      await run('help.tour');
      expect(app.startTour).toHaveBeenCalled();
      await run('help.reportBug');
      expect(app.openBugForm).toHaveBeenCalled();
      expect(app.openSecurityReport).not.toHaveBeenCalled();
      await run('help.reportSecurity');
      expect(app.openSecurityReport).toHaveBeenCalled();
      await run('help.requestFeature');
      expect(app.openFeatureForm).toHaveBeenCalled();
      await run('help.about');
      expect(app.openAbout).toHaveBeenCalled();
      // Every command refreshes the toolbar along with the menus.
      expect(app.toolbar.refresh).toHaveBeenCalled();
    });
  });

  describe('keyboard', () => {
    it('toggles the palette on Ctrl+P and ignores shortcuts while it is open', () => {
      const { commands, app } = setup();
      const event = key('p');
      commands.handleKeydown(event);
      expect(event.defaultPrevented).toBe(true);
      expect(app.commandPalette.isOpen()).toBe(true);
      commands.handleKeydown(key('s'));
      expect(app.autosave.saveNow).not.toHaveBeenCalled();
    });

    it('runs enabled shortcuts and leaves the rest alone', () => {
      const { commands, app, undo } = setup();
      const settings = key(',');
      commands.handleKeydown(settings);
      expect(settings.defaultPrevented).toBe(true);
      expect(app.settingsDialog.open).toHaveBeenCalled();
      // Redo is off, so the browser keeps the key.
      const redo = key('y');
      commands.handleKeydown(redo);
      expect(redo.defaultPrevented).toBe(false);
      expect(undo.redo).not.toHaveBeenCalled();
      // Plain keys and keys the editor already took do nothing.
      commands.handleKeydown(key('s', { ctrlKey: false }));
      const handled = key('z');
      handled.preventDefault();
      commands.handleKeydown(handled);
      expect(undo.undo).not.toHaveBeenCalled();
    });

    it('matches keybinds exactly, so Ctrl+Shift+S is not Ctrl+S', () => {
      const { commands, app } = setup();
      commands.handleKeydown(key('S', { shiftKey: true }));
      expect(app.exportDialog.runNow).toHaveBeenCalledWith('zip');
      expect(app.autosave.saveNow).not.toHaveBeenCalled();
      commands.handleKeydown(key('E', { shiftKey: true }));
      expect(app.exportDialog.open).toHaveBeenCalledTimes(1);
      const shiftC = key('C', { shiftKey: true });
      commands.handleKeydown(shiftC);
      expect(shiftC.defaultPrevented).toBe(false);
    });

    it('runs New File on Ctrl+N and New Project on Ctrl+Shift+N', async () => {
      const { commands, app } = setup();
      const newFile = key('n');
      commands.handleKeydown(newFile);
      expect(newFile.defaultPrevented).toBe(true);
      expect(app.promptDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'New file' }));
      expect(app.confirmDialog).not.toHaveBeenCalled();
      const newProject = key('N', { shiftKey: true });
      commands.handleKeydown(newProject);
      expect(newProject.defaultPrevented).toBe(true);
      await vi.waitFor(() => expect(app.templates.openNew).toHaveBeenCalled());
    });

    it('runs Compile Now on Ctrl+Enter', () => {
      const { commands, app } = setup();
      const event = key('Enter');
      commands.handleKeydown(event);
      expect(event.defaultPrevented).toBe(true);
      expect(app.compile.compileNow).toHaveBeenCalled();
    });

    it('leaves native keys like Ctrl+C and Ctrl+V to the browser', () => {
      const { commands } = setup();
      const exec = vi.fn();
      document.execCommand = exec;
      for (const k of ['c', 'v', 'x', 'a']) {
        const event = key(k);
        commands.handleKeydown(event);
        expect(event.defaultPrevented, k).toBe(false);
      }
      expect(exec).not.toHaveBeenCalled();
    });

    it('does not take the Windows key for Ctrl', () => {
      const { commands, app } = setup();
      const event = key('p', { ctrlKey: false, metaKey: true });
      commands.handleKeydown(event);
      expect(event.defaultPrevented).toBe(false);
      expect(app.commandPalette.isOpen()).toBe(false);
    });

    it('uses Cmd, not Ctrl, on a Mac', () => {
      const { commands, app } = setup({ keymap: createKeymap(shortcuts, () => 'mac') });
      commands.handleKeydown(key('p', { ctrlKey: true }));
      expect(app.commandPalette.isOpen()).toBe(false);
      commands.handleKeydown(key('p', { ctrlKey: false, metaKey: true }));
      expect(app.commandPalette.isOpen()).toBe(true);
    });

    it("lets the editor keep its own keys while you type, even when a rule wants one", async () => {
      // Scrolling the cursor into view measures text, which jsdom can't do.
      Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
      Range.prototype.getBoundingClientRect = () => new DOMRect();
      const keymap = createKeymap(shortcuts, () => 'other', {
        rules: [
          { id: 'file.download', keybind: 'Mod+]' },
          { id: 'view.compileNow', keybind: 'Alt+K' },
        ],
        disabled: [],
      });
      const { commands, app } = setup({ keymap });
      const container = document.createElement('div');
      document.body.append(container);
      const editor = createEditorPane(container);
      editor.setText('x');
      window.addEventListener('keydown', commands.handleKeydown);
      const press = (init: KeyboardEventInit) => {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        editor.getView().contentDOM.dispatchEvent(event);
        return event;
      };
      try {
        // Ctrl+] indents in the editor, so the rule giving it to Download doesn't fire there.
        press({ key: ']', code: 'BracketRight', keyCode: 221, ctrlKey: true });
        expect(editor.getText()).toBe('  x');
        expect(app.exportDialog.runNow).not.toHaveBeenCalled();
        // Plain typing never reaches a command.
        for (const key of ['a', 'K', ' ']) expect(press({ key }).defaultPrevented, key).toBe(false);
        press({ key: 'Enter', keyCode: 13 });
        expect(editor.getText()).toContain('\n');
        expect(app.compile.compileNow).not.toHaveBeenCalled();
        // A rule on a key the editor doesn't use works from the editor too.
        press({ key: 'k', code: 'KeyK', altKey: true });
        expect(app.compile.compileNow).toHaveBeenCalledTimes(1);
        // Outside the editor, the rule gets Ctrl+].
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', code: 'BracketRight', ctrlKey: true, cancelable: true }));
        await vi.waitFor(() => expect(app.exportDialog.runNow).toHaveBeenCalled());
      } finally {
        window.removeEventListener('keydown', commands.handleKeydown);
        container.remove();
      }
    });

    it('lists every command once for Settings, menus first', () => {
      mountAppShell();
      const menuBar = createMenuBar(document.getElementById('menu-bar')!, { getCommandState: () => ({ enabled: true }), onCommand: () => undefined });
      const { commands } = setup({ entries: menuBar.entries() });
      const list = commands.listCommands();
      const ids = list.map((command) => command.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids[0]).toBe('file.new');
      expect(ids).toEqual(expect.arrayContaining(['share.copyLink', 'view.darkMode', 'view.toggleEditorTheme', 'edit.paste']));
      expect(list.find((command) => command.id === 'file.saveNow')).toMatchObject({ label: 'Save Now', section: 'File' });
      menuBar.destroy();
    });

    it('puts keybind labels on palette-only commands too', () => {
      const keymap = createKeymap([...shortcuts, { id: 'share.copyLink', keybind: 'Alt+L' }], () => 'other');
      const { commands } = setup({ keymap });
      expect(commands.buildPaletteCommands().find((command) => command.id === 'share.copyLink')?.shortcut).toBe('Alt+L');
    });
  });
});
