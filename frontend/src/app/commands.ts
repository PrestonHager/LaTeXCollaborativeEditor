import type { CommandId, CommandState, MenuEntry } from '../ui/menuBar';
import type { PaletteCommand } from '../ui/commandPalette';
import { devPaletteCommands, paletteOnlyCommands, themeSwitchCommands } from '../ui/paletteCommands';
import type { ThemeMode } from '../state/appSession';
import { NEW_PROJECT_CONFIRM, canRunCommand, replaceProjectConfirm, type ReplaceAction } from '../state/guestCommands';
import type { StorageProvider, ProjectSummary } from '../storage/providers/types';
import type { openGooglePicker } from '../storage/providers/googlePicker';
import { LEGACY_PREFIX } from '../storage/providers/googleDrive';
import { describeError } from '../storage/errors';
import type { BlobStore } from '../project/blobStore';
import type { ProjectContent, ProjectDoc } from '../project/projectDoc';
import { projectToZip, starterProject } from '../project/projectIo';
import { isTextPath, joinPath } from '../project/paths';
import type { ProjectState } from './projectState';
import type { ThemeController } from './theme';
import type { Layout } from './layout';
import type { PreviewCompile } from './previewCompile';

export type CommandHandler = () => Promise<void> | void;

// How long an OK on the import confirm still counts, after the browser blocked the file picker.
const IMPORT_CONFIRM_KEEP_MS = 60_000;
export const IMPORT_PICKER_BLOCKED = 'The browser blocked the file picker. Choose Upload .zip again.';

type PickerSelection = Awaited<ReturnType<typeof openGooglePicker>>;

/** Everything the commands reach into. main.ts builds this once and owns all of it. */
export type CommandContext = {
  isClient: boolean;
  projectState: ProjectState;
  themeState: ThemeController;
  layout: Pick<Layout, 'mode' | 'setMode'>;
  compile: Pick<PreviewCompile, 'compileNow'>;
  localAppProvider: StorageProvider & { clear(): Promise<void> };
  driveProvider: StorageProvider & {
    moveProject(projectId: string, folderId: string): Promise<void>;
    isSignedIn(): boolean;
    disconnect(): Promise<void>;
  };
  blobs: BlobStore;
  localDownload: { download(fileName: string, data: string | Uint8Array, type?: string): void };
  autosave: {
    enable(): void;
    markDirty(): void;
    saveNow(): Promise<boolean>;
    setPaused(paused: boolean): void;
    enqueue(task: () => Promise<void>): Promise<void>;
  };
  session: { broadcastMetadata(metadata: { title: string; storage: string }): void };
  editor: { focus(): void; selectAll(): void };
  fileTree: { currentFolder(): string };
  projectsDialog: { open(projects: ProjectSummary[]): void };
  uploadDialog: { open(folder?: string): void };
  zipInput: HTMLInputElement;
  shareButtonEl: HTMLElement;
  // These get swapped out or made later, so we read them each time we need them.
  readonly project: ProjectDoc;
  readonly undo: { undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean };
  readonly activeFileId: string | null;
  readonly menuBar: { refresh(): void; entries(): MenuEntry[] };
  readonly commandPalette: { toggle(): void; isOpen(): boolean; setCommands(commands: PaletteCommand[]): void };
  readonly settingsDialog: { open(): void };
  readonly toolbar: { refresh(): void };
  // App actions that still live in main.ts.
  /** How many guests are in the host's room right now. Always 0 in a guest tab. */
  guestCount(): number;
  projectName(): string;
  setStatus(message: string): void;
  showNotice(message: string, isError?: boolean): void;
  persistAppSession(): void;
  runFileOp(op: () => void): void;
  openFile(id: string | null): void;
  downloadFile(path: string): Promise<void>;
  switchProject(content: ProjectContent, provider: StorageProvider, id: string | null): Promise<void>;
  openStoredProject(provider: StorageProvider, id: string): Promise<void>;
  useProvider(provider: StorageProvider, id: string | null): void;
  switchToDrive(): void;
  promptForProjectName(): boolean;
  renameProject(): Promise<void>;
  ensureDrivePickerConfig(): boolean;
  ensureDriveConnected(): Promise<boolean>;
  pickFromDrive(kind: 'project' | 'folder'): Promise<PickerSelection | undefined>;
  showDriveAccount(): void;
  /** File > Add Files from Drive, see driveAddFiles.ts. */
  addFilesFromDrive(): Promise<void>;
  // The Help menu. These open a docs page, a GitHub form, the tour, or the About dialog.
  openDocs(topic: 'gettingStarted' | 'shortcuts'): void;
  openBugForm(): void;
  /** Opens GitHub's private vulnerability form. Security reports never go to a public issue. */
  openSecurityReport(): void;
  openFeatureForm(): void;
  startTour(): void;
  openAbout(): void;
};

/**
 * Ctrl (or Cmd) shortcuts, checked in order. Leave out `shift` to match with or without it.
 * The menus show these from their data-chord attributes in index.html, so keep the two in step.
 * Ctrl+P opens the palette and is handled on its own, and cut, copy, paste, and select all are left to the browser.
 */
export const shortcuts: { key: string; shift?: boolean; id: CommandId }[] = [
  { key: 'n', id: 'file.new' },
  { key: 'z', shift: true, id: 'edit.redo' },
  { key: 'z', id: 'edit.undo' },
  { key: 'y', id: 'edit.redo' },
  { key: 'o', shift: true, id: 'file.openDrive' },
  { key: 's', shift: true, id: 'file.download' },
  { key: 's', id: 'file.saveNow' },
  { key: 'o', id: 'file.openLocal' },
  { key: 'c', shift: true, id: 'view.compileNow' },
  { key: ',', id: 'app.openSettings' },
];

/** The command a Ctrl or Cmd key press runs, if any. */
export function shortcutCommand(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey'>): CommandId | null {
  if (!(event.ctrlKey || event.metaKey)) return null;
  const key = event.key.toLowerCase();
  const match = shortcuts.find((shortcut) => shortcut.key === key && (!shortcut.shift || event.shiftKey));
  return match?.id ?? null;
}

/** The command registry, its menu and palette state, and the keyboard shortcuts. */
export function createCommands(app: CommandContext) {
  const {
    isClient,
    projectState,
    themeState,
    layout,
    compile,
    localAppProvider,
    driveProvider,
    blobs,
    localDownload,
    autosave,
    session,
    editor,
    fileTree,
    projectsDialog,
    uploadDialog,
    zipInput,
    shareButtonEl,
    guestCount,
    projectName,
    setStatus,
    showNotice,
    persistAppSession,
    runFileOp,
    openFile,
    downloadFile,
    switchProject,
    openStoredProject,
    useProvider,
    switchToDrive,
    promptForProjectName,
    renameProject,
    ensureDrivePickerConfig,
    ensureDriveConnected,
    pickFromDrive,
    showDriveAccount,
  } = app;
  const { applyEditorTheme, applyPreviewTheme } = themeState;

  /**
   * Ask the host before it swaps out the project while guests are in the room.
   * Ask before any picker or dialog opens, so Cancel leaves everything as it was.
   */
  const confirmReplace = (action: ReplaceAction) => guestCount() === 0 || window.confirm(replaceProjectConfirm(action));
  // When the browser blocked the zip picker after an OK, this is when that OK happened.
  let importConfirmedAt = 0;
  // Whether the host OK'd the confirm for the Open a project dialog that's showing now.
  // Its Upload .zip button replaces the project too, but the host already said yes, so it doesn't ask again.
  let openDialogConfirmed = false;

  /** Pick a .zip to open as a new project. Pass alreadyConfirmed when the host just OK'd replacing the project. */
  function importZip(alreadyConfirmed: boolean) {
    if (isClient) return;
    const confirmedRecently = Date.now() - importConfirmedAt < IMPORT_CONFIRM_KEEP_MS;
    importConfirmedAt = 0;
    if (guestCount() > 0 && !alreadyConfirmed && !confirmedRecently) {
      if (!window.confirm(replaceProjectConfirm('import'))) return;
      // Browsers only open a file picker for a few seconds after a click, and a confirm left open longer uses that up.
      // Then click() would do nothing, so say so and skip the confirm on the next try.
      if (navigator.userActivation?.isActive === false) {
        importConfirmedAt = Date.now();
        showNotice(IMPORT_PICKER_BLOCKED);
        return;
      }
    }
    zipInput.click();
  }

  const commandRegistry: Record<CommandId, CommandHandler> = {
    'app.commandPalette': () => {
      app.commandPalette.toggle();
    },
    'file.new': async () => {
      if (isClient) return;
      if (!window.confirm(NEW_PROJECT_CONFIRM)) return;
      await switchProject(starterProject(''), projectState.activeProvider, null);
    },
    'file.openLocal': async () => {
      if (isClient) return;
      // Only an OK on a real confirm counts. With nobody connected there's nothing to carry over.
      const asked = guestCount() > 0;
      openDialogConfirmed = false;
      if (!confirmReplace('open')) return;
      openDialogConfirmed = asked;
      projectsDialog.open(await localAppProvider.listProjects());
    },
    'file.openDrive': async () => {
      if (isClient) return;
      if (!ensureDrivePickerConfig()) return;
      if (!confirmReplace('open')) return;
      if (!(await ensureDriveConnected())) return;
      setStatus('Drive: Opening picker...');
      const picked = await pickFromDrive('project');
      if (picked === undefined) return;
      if (!picked) {
        setStatus('Drive: Selection canceled');
        return;
      }
      // A folder is a project. A single file opens as a one-file project, like before projects.
      await openStoredProject(driveProvider, picked.isFolder ? picked.id : `${LEGACY_PREFIX}${picked.id}`);
    },
    'file.importZip': () => importZip(false),
    'file.newFile': () => runFileOp(() => {
      const folder = fileTree.currentFolder();
      const name = window.prompt(`New file${folder ? ` in ${folder}/` : ''}:`, 'chapter.tex');
      if (!name || !name.trim()) return;
      // New files are text, so give them a text extension if they don't have one.
      const path = joinPath(folder, isTextPath(name.trim()) ? name.trim() : `${name.trim()}.tex`);
      const id = app.project.createTextFile(path);
      openFile(id);
    }),
    'file.newFolder': () => runFileOp(() => {
      const folder = fileTree.currentFolder();
      const name = window.prompt(`New folder${folder ? ` in ${folder}/` : ''}:`, 'figures');
      if (name && name.trim()) app.project.createFolder(joinPath(folder, name.trim()));
    }),
    'file.upload': () => uploadDialog.open(fileTree.currentFolder()),
    'file.download': async () => {
      const { zip, skipped } = await projectToZip(app.project, blobs);
      localDownload.download(`${projectName()}.zip`, zip, 'application/zip');
      showNotice(skipped.length ? `Downloaded, but still waiting on: ${skipped.join(', ')}` : `Downloaded ${projectName()}.zip`, skipped.length > 0);
    },
    'file.downloadFile': async () => {
      const entry = app.activeFileId ? app.project.get(app.activeFileId) : undefined;
      if (entry) await downloadFile(entry.path);
    },
    'file.connectDrive': async () => {
      if (isClient) return;
      if (!(await ensureDriveConnected())) return;
      switchToDrive();
      autosave.enable();
      setStatus(app.project.getName() ? 'Drive: Connected' : 'Drive: Connected (name the project to save)');
      if (app.project.getName()) autosave.markDirty();
    },
    'file.disconnectDrive': async () => {
      if (isClient || !driveProvider.isSignedIn()) return;
      // First, point saves at this browser, so the next save keeps every edit.
      if (projectState.isDrive()) useProvider(localAppProvider, null);
      // Then let a Drive save that's already running finish before the token goes away.
      await autosave.enqueue(() => driveProvider.disconnect());
      showDriveAccount();
      showNotice('Disconnected Google Drive. Edits now save in this browser.');
      await autosave.saveNow();
    },
    'file.saveToDrive': async () => {
      if (isClient) return;
      if (!promptForProjectName()) return;
      if (!(await ensureDriveConnected())) return;
      switchToDrive();
      autosave.enable();
      setStatus('Drive: Saving...');
      // saveNow reports its own failure reason in the status line, so only overwrite it on success.
      if (await autosave.saveNow()) {
        setStatus(`Drive: Saved ${projectName()}`);
        session.broadcastMetadata({ title: projectName(), storage: projectState.currentStorageLabel() });
      }
    },
    'file.moveDrive': async () => {
      if (isClient) return;
      if (!ensureDrivePickerConfig()) return;
      if (!(await ensureDriveConnected())) return;
      if (!projectState.isDrive() || !projectState.projectId) {
        setStatus('Drive: Save the project to Drive first');
        return;
      }
      setStatus('Drive: Select destination folder...');
      const folder = await pickFromDrive('folder');
      if (folder === undefined) return;
      if (!folder) {
        setStatus('Drive: Move canceled');
        return;
      }
      try {
        await driveProvider.moveProject(projectState.projectId, folder.id);
        setStatus(`Drive: Moved to ${folder.name}`);
      } catch (error) {
        console.error('Drive move failed', error);
        setStatus(describeError(error));
      }
    },
    'file.addFromDrive': () => app.addFilesFromDrive(),
    'file.renameDrive': () => renameProject(),
    'file.saveNow': async () => {
      if (isClient || projectState.savingPaused) return;
      if (!promptForProjectName()) return;
      if (projectState.isDrive() && !driveProvider.isSignedIn()) {
        setStatus('Drive: Session expired. Use File > Connect Google Drive to sign in again.');
        return;
      }
      autosave.enable();
      await autosave.saveNow();
    },
    'file.clearLocalDocs': async () => {
      if (isClient) return;
      // This deletes every project saved in this browser, so make sure first.
      const count = (await localAppProvider.listProjects()).length;
      if (count === 0) {
        setStatus('No local projects to clear');
        return;
      }
      if (!window.confirm(`Delete all ${count} project(s) saved in this browser? This cannot be undone.`)) return;
      await localAppProvider.clear();
      if (projectState.activeProvider === localAppProvider) useProvider(localAppProvider, null);
      setStatus('Local projects cleared');
    },
    'edit.undo': () => app.undo.undo(),
    'edit.redo': () => app.undo.redo(),
    'edit.cut': () => {
      editor.focus();
      document.execCommand('cut');
    },
    'edit.copy': () => {
      editor.focus();
      document.execCommand('copy');
    },
    'edit.paste': () => {
      editor.focus();
      document.execCommand('paste');
    },
    'edit.selectAll': () => {
      editor.selectAll();
    },
    'view.toggleEditorTheme': () => {
      const nextTheme: Record<ThemeMode, ThemeMode> = { dark: 'light', light: 'system', system: 'dark' };
      applyEditorTheme(nextTheme[themeState.editorTheme]);
      persistAppSession();
    },
    'view.togglePreviewTheme': () => {
      const nextTheme: Record<ThemeMode, ThemeMode> = { dark: 'light', light: 'system', system: 'dark' };
      applyPreviewTheme(nextTheme[themeState.previewTheme]);
      persistAppSession();
    },
    'view.darkMode': () => setAllThemes('dark'),
    'view.lightMode': () => setAllThemes('light'),
    'view.systemTheme': () => setAllThemes('system'),
    'view.togglePauseSaving': () => setSavingPaused(!projectState.savingPaused),
    'view.focusEditor': () => editor.focus(),
    'app.openSettings': () => app.settingsDialog.open(),
    'file.rename': () => renameProject(),
    'share.copyLink': () => shareButtonEl.click(),
    'view.compileNow': () => compile.compileNow(),
    'view.layoutSplit': () => {
      layout.setMode('split');
      app.menuBar.refresh();
    },
    'view.layoutEditorOnly': () => {
      layout.setMode('editor-only');
      app.menuBar.refresh();
    },
    'view.layoutPreviewOnly': () => {
      layout.setMode('preview-only');
      app.menuBar.refresh();
    },
    'help.documentation': () => app.openDocs('gettingStarted'),
    'help.shortcuts': () => app.openDocs('shortcuts'),
    'help.tour': () => app.startTour(),
    // NOTE: these only open the GitHub form. The person reads it and submits it themselves.
    'help.reportBug': () => app.openBugForm(),
    'help.reportSecurity': () => app.openSecurityReport(),
    'help.requestFeature': () => app.openFeatureForm(),
    'help.about': () => app.openAbout(),
    // These two only show in the palette in dev builds (see devPaletteCommands).
    'dev.openTestProject': async () => {
      if (import.meta.env.DEV && !isClient) {
        if (!window.confirm('Open the regression test project? The current one stays saved where it is.')) return;
        // Load it lazily, so the test project never ends up in a production bundle.
        const { regressionProject } = await import('../dev/regressionProject');
        await switchProject(await regressionProject(blobs), projectState.activeProvider, null);
      }
    },
    'dev.openChecklist': () => {
      if (import.meta.env.DEV) window.open('./regression.html', '_blank', 'noreferrer');
    },
  };

  // The palette's "Switch to ... mode" commands set the app, editor, and preview together.
  function setAllThemes(theme: ThemeMode) {
    applyEditorTheme(theme);
    applyPreviewTheme(theme);
    persistAppSession();
  }

  function setSavingPaused(paused: boolean) {
    if (isClient) return;
    projectState.savingPaused = paused;
    // Autosave sets the status line, and resuming saves whatever changed while paused.
    autosave.setPaused(paused);
    app.menuBar.refresh();
    persistAppSession();
  }

  /**
   * Run a command and report any error it throws, then refresh the menus.
   * Every menu, palette, and shortcut path goes through here.
   */
  function executeCommand(commandId: CommandId) {
    const report = (error: unknown) => {
      console.error(`Command ${commandId} failed`, error);
      showNotice(describeError(error), true);
    };
    // Guests can't run commands that replace the shared project, however they get triggered.
    if (!canRunCommand(commandId, isClient)) return;
    try {
      const result = commandRegistry[commandId]();
      if (result instanceof Promise) {
        void result.catch(report).finally(refreshCommands);
      }
    } catch (error) {
      report(error);
    }
    refreshCommands();
  }

  // Menus and palette entries depend on app state (theme, save mode), so rebuild both after changes.
  function refreshCommands() {
    app.menuBar.refresh();
    app.toolbar.refresh();
    app.commandPalette.setCommands(buildPaletteCommands());
  }

  const getCommandState = (commandId: CommandId): CommandState => {
    switch (commandId) {
      case 'file.new':
      case 'file.openLocal':
      case 'file.openDrive':
      case 'file.importZip':
      case 'file.connectDrive':
      case 'file.saveToDrive':
      case 'file.renameDrive':
      case 'file.clearLocalDocs':
      case 'file.rename':
      case 'dev.openTestProject':
        return { enabled: !isClient };
      case 'file.moveDrive':
      case 'file.addFromDrive':
        return { enabled: !isClient && projectState.isDrive() };
      case 'file.disconnectDrive':
        return { enabled: !isClient && driveProvider.isSignedIn() };
      case 'file.newFile':
      case 'file.newFolder':
      case 'file.upload':
        // Guests can add files too, once they have the host's project.
        return { enabled: !(isClient && app.project.isEmpty()) };
      case 'file.downloadFile':
        return { enabled: Boolean(app.activeFileId) };
      case 'file.saveNow':
        return { enabled: !isClient && !projectState.savingPaused };
      case 'edit.undo':
        return { enabled: app.undo.canUndo() };
      case 'edit.redo':
        return { enabled: app.undo.canRedo() };
      case 'view.togglePauseSaving':
        return { enabled: !isClient, checked: projectState.savingPaused };
      case 'view.layoutSplit':
        return { enabled: true, checked: layout.mode === 'split' };
      case 'view.layoutEditorOnly':
        return { enabled: true, checked: layout.mode === 'editor-only' };
      case 'view.layoutPreviewOnly':
        return { enabled: true, checked: layout.mode === 'preview-only' };
      default:
        return { enabled: true };
    }
  };

  /** Build the palette from the menu HTML, plus the palette-only commands in paletteCommands.ts. */
  function buildPaletteCommands(): PaletteCommand[] {
    const fromMenus = app.menuBar
      .entries()
      .filter((entry) => entry.inPalette)
      .map((entry) => ({
        id: entry.commandId,
        section: entry.section,
        // The menu shows a checkmark for this one, but the palette has to say which way it goes.
        label: entry.commandId === 'view.togglePauseSaving' && projectState.savingPaused ? 'Resume Saving' : entry.label,
        shortcut: entry.shortcut,
        description: entry.description,
        enabled: getCommandState(entry.commandId).enabled,
      }));
    // Skip the theme switch for the theme that's already in use.
    const themes = themeSwitchCommands
      .filter(({ theme }) => !(themeState.editorTheme === theme && themeState.previewTheme === theme))
      .map(({ id, section, label, description }) => ({ id, section, label, description, enabled: true }));
    const extras = [...paletteOnlyCommands, ...devPaletteCommands].map((command) => ({ ...command, enabled: getCommandState(command.id).enabled }));
    return [...fromMenus, ...themes, ...extras];
  }

  function handleKeydown(event: KeyboardEvent) {
    // The editor already handled this key (like its own undo), so don't run it a second time.
    if (event.defaultPrevented) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      app.commandPalette.toggle();
      return;
    }
    if (app.commandPalette.isOpen()) return;
    const commandId = shortcutCommand(event);
    if (!commandId) return;
    const state = getCommandState(commandId);
    if (!state.enabled) return;
    event.preventDefault();
    executeCommand(commandId);
  }

  /**
   * The Upload .zip button in the Open a project dialog.
   * The host already OK'd replacing the project to open that dialog, so it doesn't ask again.
   * If nobody was connected then, it still asks when a guest has joined since.
   */
  function importZipFromOpenDialog() {
    if (!canRunCommand('file.importZip', isClient)) return;
    importZip(openDialogConfirmed);
    refreshCommands();
  }

  return {
    commandRegistry,
    executeCommand,
    importZipFromOpenDialog,
    refreshCommands,
    getCommandState,
    buildPaletteCommands,
    handleKeydown,
    setSavingPaused,
  };
}

export type Commands = ReturnType<typeof createCommands>;
