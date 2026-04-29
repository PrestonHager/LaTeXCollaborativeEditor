import './style.css';
import { createEditorPane } from './ui/editor';
import { createPreviewPane } from './ui/preview';
import { createEditHistory } from './ui/history';
import { createMenuBar, type CommandId, type CommandState } from './ui/menuBar';
import { createCommandPalette, type PaletteCommand } from './ui/commandPalette';
import { setupShareButton } from './ui/shareButton';
import { SessionController } from './collab/session';
import { LocalDownloadStorage } from './storage/localDownload';
import { GoogleDriveProvider } from './storage/providers/googleDrive';
import { AutosaveController } from './storage/autosave';
import { LocalAppStorageProvider } from './storage/providers/localAppStorage';
import type { StorageProvider } from './storage/providers/types';
import { openGooglePicker } from './storage/providers/googlePicker';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');

app.innerHTML = `
  <header class="topbar">
    <h1 id="doc-title" class="doc-title">Untitled</h1>
    <div id="menu-bar"></div>
    <button id="share-btn">Share</button>
    <a id="share-link" class="muted" href="" target="_blank" rel="noreferrer"></a>
    <span id="connection-status" class="pill">Disconnected</span>
    <span id="compile-status" class="pill">Idle</span>
    <span id="autosave-status" class="pill">Autosave Off</span>
  </header>
  <main class="split">
    <section id="editor-pane" class="pane"></section>
    <section id="preview-pane" class="pane"></section>
  </main>
  <footer class="footer">
    <span id="diagnostics" class="diagnostics">No diagnostics.</span>
    <nav class="legal-nav">
      <a href="./privacy.html" target="_blank" rel="noreferrer">Privacy</a>
      <a href="./tos.html" target="_blank" rel="noreferrer">ToS</a>
      <a href="https://github.com/PrestonHager/LaTeXCollaborativeEditor" target="_blank" rel="noreferrer">Repository</a>
    </nav>
  </footer>
`;

const editor = createEditorPane(document.getElementById('editor-pane')!);
const preview = createPreviewPane(document.getElementById('preview-pane')!);
const shareLinkEl = document.getElementById('share-link') as HTMLAnchorElement;
const compileStatusEl = document.getElementById('compile-status')!;
const diagnosticsEl = document.getElementById('diagnostics')!;
const autosaveStatusEl = document.getElementById('autosave-status')!;
const titleEl = document.getElementById('doc-title')!;
const roomId = new URLSearchParams(location.search).get('room');
const isClient = Boolean(roomId);
const COMPILE_DEBOUNCE_MS = 500;
const COMPILE_MIN_INTERVAL_MS = 900;

const localDownload = new LocalDownloadStorage();
const localAppProvider = new LocalAppStorageProvider();
const driveProvider = new GoogleDriveProvider();
let activeProvider: StorageProvider = localAppProvider;
let documentName = 'Untitled';
let saveNowEnabled = true;
const hostStorageLabel = 'Saved on host local storage';
const driveApiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;

const toTexName = (name: string) => (name.endsWith('.tex') ? name : `${name}.tex`);
const stripTexName = (name: string) => (name.endsWith('.tex') ? name.slice(0, -4) : name);

const promptForDocumentName = (): boolean => {
  if (documentName !== 'Untitled') return true;
  const next = window.prompt('Enter a document name before saving:', '');
  if (!next || !next.trim()) return false;
  documentName = next.trim();
  titleEl.textContent = documentName;
  return true;
};

const autosave = new AutosaveController({
  provider: () => activeProvider,
  getContent: () => editor.getText(),
  getFileName: () => toTexName(documentName),
  onStatus: (status) => {
    autosaveStatusEl.textContent = status;
  },
});
if (!isClient) {
  void localAppProvider.connect().then(() => autosave.enable());
} else {
  autosaveStatusEl.textContent = hostStorageLabel;
}

const session = new SessionController({
  isHost: !isClient,
  onConnectionState: (status) => {
    document.getElementById('connection-status')!.textContent = status;
  },
  onRemoteText: (text) => editor.setText(text, false),
  onRemoteMetadata: ({ title, storage }) => {
    documentName = title;
    titleEl.textContent = title;
    autosaveStatusEl.textContent = storage;
  },
  getLocalText: () => editor.getText(),
  getLocalMetadata: () => ({
    title: documentName,
    storage: hostStorageLabel,
  }),
});

let compileTimer: ReturnType<typeof setTimeout> | null = null;
let throttleTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSource = '';
let lastCompiledSource: string | null = null;
let lastCompileStartedAt = 0;
let compileSequence = 0;

const runCompile = async (source: string) => {
  if (source === lastCompiledSource) return;
  const seq = ++compileSequence;
  lastCompileStartedAt = Date.now();
  compileStatusEl.textContent = 'Compiling';
  preview.setLoading(true);
  try {
    await preview.renderLatex(source);
    if (seq !== compileSequence) return;
    lastCompiledSource = source;
    compileStatusEl.textContent = 'Compiled';
    diagnosticsEl.textContent = 'No diagnostics.';
  } catch (error) {
    if (seq !== compileSequence) return;
    compileStatusEl.textContent = 'Compile Error';
    diagnosticsEl.textContent = String(error);
  } finally {
    if (seq === compileSequence) {
      preview.setLoading(false);
    }
  }
};

const requestCompile = (source: string) => {
  const elapsed = Date.now() - lastCompileStartedAt;
  if (elapsed >= COMPILE_MIN_INTERVAL_MS) {
    void runCompile(source);
    return;
  }
  if (throttleTimer) clearTimeout(throttleTimer);
  const waitMs = COMPILE_MIN_INTERVAL_MS - elapsed;
  throttleTimer = setTimeout(() => {
    throttleTimer = null;
    void runCompile(source);
  }, waitMs);
};

const scheduleCompile = (source: string) => {
  pendingSource = source;
  if (compileTimer) {
    clearTimeout(compileTimer);
  }
  compileStatusEl.textContent = 'Waiting';
  compileTimer = setTimeout(() => {
    requestCompile(pendingSource);
    compileTimer = null;
  }, COMPILE_DEBOUNCE_MS);
};

const history = createEditHistory({
  initialText: editor.getText(),
  limit: 100,
});
let applyingHistoryChange = false;

const runWithHistoryApply = (nextText: string) => {
  applyingHistoryChange = true;
  editor.setText(nextText, true);
  applyingHistoryChange = false;
};

const openLocalDocument = () => {
  const names = localAppProvider.listDocuments?.() ?? [];
  if (!names.length) {
    autosaveStatusEl.textContent = 'No local docs found';
    return;
  }

  const picked = window.prompt(`Open which local document?\n${names.join('\n')}`, names[0]);
  if (!picked || !picked.trim()) return;

  let selectedName = picked.trim();
  if (!names.includes(selectedName) && names.includes(`${selectedName}.tex`)) {
    selectedName = `${selectedName}.tex`;
  }

  const content = localAppProvider.loadDocument?.(selectedName) ?? null;
  if (content === null) {
    autosaveStatusEl.textContent = `Local doc not found: ${selectedName}`;
    return;
  }

  documentName = selectedName.endsWith('.tex') ? selectedName.slice(0, -4) : selectedName;
  titleEl.textContent = documentName;
  activeProvider = localAppProvider;
  autosave.enable();
  editor.setText(content);
  autosaveStatusEl.textContent = `Opened local doc: ${selectedName}`;
};

const ensureDriveConnected = async () => {
  autosaveStatusEl.textContent = 'Drive: Connecting...';
  const connected = await driveProvider.connect();
  if (!connected) {
    autosaveStatusEl.textContent = driveProvider.status();
    return false;
  }
  autosaveStatusEl.textContent = 'Drive: Connected';
  return true;
};

const ensureDrivePickerConfig = () => {
  if (driveApiKey) return true;
  autosaveStatusEl.textContent = 'Drive: API key missing';
  return false;
};

const commandRegistry: Record<CommandId, () => Promise<void> | void> = {
  'app.commandPalette': () => {
    commandPalette.toggle();
  },
  'file.new': () => {
    const confirmed = window.confirm('Start a new document? Unsaved changes will be replaced.');
    if (!confirmed) return;
    documentName = 'Untitled';
    titleEl.textContent = documentName;
    editor.setText('\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n');
    autosaveStatusEl.textContent = isClient ? hostStorageLabel : 'Autosave On';
  },
  'file.openLocal': () => {
    if (isClient) return;
    openLocalDocument();
  },
  'file.openDrive': async () => {
    if (isClient) return;
    if (!ensureDrivePickerConfig()) return;
    if (!(await ensureDriveConnected())) return;
    autosaveStatusEl.textContent = 'Drive: Opening picker...';
    const picked = await openGooglePicker({
      accessToken: driveProvider.getAccessToken(),
      apiKey: driveApiKey!,
      kind: 'file',
    });
    if (!picked) {
      autosaveStatusEl.textContent = 'Drive: File selection canceled';
      return;
    }
    autosaveStatusEl.textContent = `Drive: Loading ${picked.name}`;
    try {
      const opened = await driveProvider.openDocument(picked.id);
      documentName = stripTexName(opened.name);
      titleEl.textContent = documentName;
      activeProvider = driveProvider;
      autosave.enable();
      editor.setText(opened.content);
      autosaveStatusEl.textContent = `Drive: Opened ${opened.name}`;
    } catch (error) {
      autosaveStatusEl.textContent = String(error);
    }
  },
  'file.download': () => {
    if (!promptForDocumentName()) return;
    localDownload.download(toTexName(documentName), editor.getText());
  },
  'file.connectDrive': async () => {
    if (isClient) return;
    if (!(await ensureDriveConnected())) return;
    activeProvider = driveProvider;
    autosave.enable();
    autosaveStatusEl.textContent =
      documentName === 'Untitled' ? 'Drive: Connected (name doc to save)' : 'Drive: Connected';
  },
  'file.saveToDrive': async () => {
    if (isClient) return;
    if (!promptForDocumentName()) return;
    if (!(await ensureDriveConnected())) return;
    activeProvider = driveProvider;
    autosave.enable();
    autosaveStatusEl.textContent = 'Drive: Saving...';
    try {
      await autosave.saveNow();
      autosaveStatusEl.textContent = `Drive: Saved ${toTexName(documentName)}`;
    } catch (error) {
      autosaveStatusEl.textContent = String(error);
    }
  },
  'file.moveDrive': async () => {
    if (isClient) return;
    if (!ensureDrivePickerConfig()) return;
    if (!(await ensureDriveConnected())) return;
    const fileRef = driveProvider.getCurrentFileRef();
    if (!fileRef) {
      autosaveStatusEl.textContent = 'Drive: Open a Drive file first';
      return;
    }
    autosaveStatusEl.textContent = 'Drive: Select destination folder...';
    const folder = await openGooglePicker({
      accessToken: driveProvider.getAccessToken(),
      apiKey: driveApiKey!,
      kind: 'folder',
    });
    if (!folder) {
      autosaveStatusEl.textContent = 'Drive: Move canceled';
      return;
    }
    try {
      await driveProvider.moveFile(fileRef.id, folder.id);
      autosaveStatusEl.textContent = `Drive: Move successful (${folder.name})`;
    } catch (error) {
      autosaveStatusEl.textContent = String(error);
    }
  },
  'file.renameDrive': async () => {
    if (isClient) return;
    if (!(await ensureDriveConnected())) return;
    const fileRef = driveProvider.getCurrentFileRef();
    if (!fileRef) {
      autosaveStatusEl.textContent = 'Drive: Open a Drive file first';
      return;
    }
    const nextName = window.prompt('Rename Drive file:', fileRef.name);
    if (!nextName || !nextName.trim()) return;
    try {
      await driveProvider.renameFile(fileRef.id, nextName.trim());
      documentName = stripTexName(nextName.trim());
      titleEl.textContent = documentName;
      autosaveStatusEl.textContent = 'Drive: Rename successful';
    } catch (error) {
      autosaveStatusEl.textContent = String(error);
    }
  },
  'file.saveNow': async () => {
    if (isClient || !saveNowEnabled) return;
    if (!promptForDocumentName()) return;
    await autosave.saveNow();
  },
  'file.clearLocalDocs': async () => {
    if (isClient) return;
    await localAppProvider.clear?.();
    autosaveStatusEl.textContent = 'Local saved docs cleared';
  },
  'edit.undo': () => {
    const next = history.undo();
    if (next === null) return;
    runWithHistoryApply(next);
  },
  'edit.redo': () => {
    const next = history.redo();
    if (next === null) return;
    runWithHistoryApply(next);
  },
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
  'view.toggleSaveNow': () => {
    if (isClient) return;
    saveNowEnabled = !saveNowEnabled;
    autosaveStatusEl.textContent = saveNowEnabled ? 'Autosave On' : 'Save Now Disabled';
    menuBar.refresh();
  },
  'view.compileNow': () => {
    if (compileTimer) {
      clearTimeout(compileTimer);
      compileTimer = null;
    }
    requestCompile(editor.getText());
  },
  'help.shortcuts': () => {
    window.alert('Shortcuts:\nCtrl/Cmd+P Command Palette\nCtrl/Cmd+N New\nCtrl/Cmd+Z Undo\nCtrl/Cmd+Shift+Z or Ctrl/Cmd+Y Redo\nCtrl/Cmd+S Save\nCtrl/Cmd+Shift+S Download\nCtrl/Cmd+O Open Local\nCtrl/Cmd+Shift+O Open Drive\nCtrl/Cmd+Shift+C Compile');
  },
  'help.about': () => {
    window.open('https://github.com/PrestonHager/LaTeXCollaborativeEditor', '_blank', 'noreferrer');
  },
};

const getCommandState = (commandId: CommandId): CommandState => {
  switch (commandId) {
    case 'file.openLocal':
    case 'file.openDrive':
    case 'file.connectDrive':
    case 'file.saveToDrive':
    case 'file.moveDrive':
    case 'file.renameDrive':
    case 'file.clearLocalDocs':
      return { enabled: !isClient };
    case 'file.saveNow':
      return { enabled: !isClient && saveNowEnabled };
    case 'edit.undo':
      return { enabled: history.canUndo() };
    case 'edit.redo':
      return { enabled: history.canRedo() };
    case 'view.toggleSaveNow':
      return { enabled: !isClient, checked: !saveNowEnabled };
    default:
      return { enabled: true };
  }
};

const menuBar = createMenuBar(document.getElementById('menu-bar')!, {
  menus: [
    {
      label: 'File',
      items: [
        { commandId: 'file.new', label: 'New', shortcut: 'Ctrl/Cmd+N' },
        { commandId: 'file.openLocal', label: 'Open Local', shortcut: 'Ctrl/Cmd+O' },
        { commandId: 'file.openDrive', label: 'Open from Google Drive', shortcut: 'Ctrl/Cmd+Shift+O' },
        { commandId: 'file.download', label: 'Download .tex', shortcut: 'Ctrl/Cmd+Shift+S' },
        { commandId: 'file.connectDrive', label: 'Connect Google Drive' },
        { commandId: 'file.saveToDrive', label: 'Save to Google Drive' },
        { commandId: 'file.moveDrive', label: 'Move to Drive Folder' },
        { commandId: 'file.renameDrive', label: 'Rename in Drive' },
        { commandId: 'file.saveNow', label: 'Save Now', shortcut: 'Ctrl/Cmd+S' },
        { commandId: 'file.clearLocalDocs', label: 'Clear Local Docs' },
      ],
    },
    {
      label: 'Edit',
      items: [
        { commandId: 'edit.undo', label: 'Undo', shortcut: 'Ctrl/Cmd+Z' },
        { commandId: 'edit.redo', label: 'Redo', shortcut: 'Ctrl/Cmd+Shift+Z' },
        { commandId: 'edit.cut', label: 'Cut', shortcut: 'Ctrl/Cmd+X' },
        { commandId: 'edit.copy', label: 'Copy', shortcut: 'Ctrl/Cmd+C' },
        { commandId: 'edit.paste', label: 'Paste', shortcut: 'Ctrl/Cmd+V' },
        { commandId: 'edit.selectAll', label: 'Select All', shortcut: 'Ctrl/Cmd+A' },
      ],
    },
    {
      label: 'View',
      items: [
        { commandId: 'view.toggleSaveNow', label: 'Disable Save Now' },
        { commandId: 'view.compileNow', label: 'Compile Now', shortcut: 'Ctrl/Cmd+Shift+C' },
      ],
    },
    {
      label: 'Help',
      items: [
        { commandId: 'app.commandPalette', label: 'Command Palette', shortcut: 'Ctrl/Cmd+P' },
        { commandId: 'help.shortcuts', label: 'Keyboard Shortcuts' },
        { commandId: 'help.about', label: 'About / Repository' },
      ],
    },
  ],
  getCommandState,
  onCommand: (commandId) => {
    void commandRegistry[commandId]();
    menuBar.refresh();
  },
});

history.subscribe(() => menuBar.refresh());

const commandPalette = createCommandPalette({
  onSelect: (commandId) => {
    void commandRegistry[commandId]();
    menuBar.refresh();
  },
});

const buildPaletteCommands = (): PaletteCommand[] => [
  { id: 'app.commandPalette', section: 'Help', label: 'Command Palette', shortcut: 'Ctrl/Cmd+P', enabled: true },
  { id: 'file.new', section: 'File', label: 'New', shortcut: 'Ctrl/Cmd+N', enabled: getCommandState('file.new').enabled },
  { id: 'file.openLocal', section: 'File', label: 'Open Local', shortcut: 'Ctrl/Cmd+O', enabled: getCommandState('file.openLocal').enabled },
  { id: 'file.openDrive', section: 'File', label: 'Open from Google Drive', shortcut: 'Ctrl/Cmd+Shift+O', enabled: getCommandState('file.openDrive').enabled },
  { id: 'file.download', section: 'File', label: 'Download .tex', shortcut: 'Ctrl/Cmd+Shift+S', enabled: getCommandState('file.download').enabled },
  { id: 'file.connectDrive', section: 'File', label: 'Connect Google Drive', enabled: getCommandState('file.connectDrive').enabled },
  { id: 'file.saveToDrive', section: 'File', label: 'Save to Google Drive', enabled: getCommandState('file.saveToDrive').enabled },
  { id: 'file.moveDrive', section: 'File', label: 'Move to Drive Folder', enabled: getCommandState('file.moveDrive').enabled },
  { id: 'file.renameDrive', section: 'File', label: 'Rename in Drive', enabled: getCommandState('file.renameDrive').enabled },
  { id: 'file.saveNow', section: 'File', label: 'Save Now', shortcut: 'Ctrl/Cmd+S', enabled: getCommandState('file.saveNow').enabled },
  { id: 'file.clearLocalDocs', section: 'File', label: 'Clear Local Docs', enabled: getCommandState('file.clearLocalDocs').enabled },
  { id: 'edit.undo', section: 'Edit', label: 'Undo', shortcut: 'Ctrl/Cmd+Z', enabled: getCommandState('edit.undo').enabled },
  { id: 'edit.redo', section: 'Edit', label: 'Redo', shortcut: 'Ctrl/Cmd+Shift+Z', enabled: getCommandState('edit.redo').enabled },
  { id: 'edit.cut', section: 'Edit', label: 'Cut', shortcut: 'Ctrl/Cmd+X', enabled: getCommandState('edit.cut').enabled },
  { id: 'edit.copy', section: 'Edit', label: 'Copy', shortcut: 'Ctrl/Cmd+C', enabled: getCommandState('edit.copy').enabled },
  { id: 'edit.paste', section: 'Edit', label: 'Paste', shortcut: 'Ctrl/Cmd+V', enabled: getCommandState('edit.paste').enabled },
  { id: 'edit.selectAll', section: 'Edit', label: 'Select All', shortcut: 'Ctrl/Cmd+A', enabled: getCommandState('edit.selectAll').enabled },
  { id: 'view.toggleSaveNow', section: 'View', label: 'Disable Save Now', enabled: getCommandState('view.toggleSaveNow').enabled },
  { id: 'view.compileNow', section: 'View', label: 'Compile Now', shortcut: 'Ctrl/Cmd+Shift+C', enabled: getCommandState('view.compileNow').enabled },
  { id: 'help.shortcuts', section: 'Help', label: 'Keyboard Shortcuts', enabled: getCommandState('help.shortcuts').enabled },
  { id: 'help.about', section: 'Help', label: 'About / Repository', enabled: getCommandState('help.about').enabled },
];
commandPalette.setCommands(buildPaletteCommands());

const runCommand = (commandId: CommandId, event: KeyboardEvent) => {
  const state = getCommandState(commandId);
  if (!state.enabled) return;
  event.preventDefault();
  void commandRegistry[commandId]();
  menuBar.refresh();
  commandPalette.setCommands(buildPaletteCommands());
};

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
    event.preventDefault();
    commandPalette.toggle();
    return;
  }
  if (commandPalette.isOpen()) return;
  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();

  if (key === 'n') return runCommand('file.new', event);
  if (key === 'z' && event.shiftKey) return runCommand('edit.redo', event);
  if (key === 'z') return runCommand('edit.undo', event);
  if (key === 'y') return runCommand('edit.redo', event);
  if (key === 'o' && event.shiftKey) return runCommand('file.openDrive', event);
  if (key === 's' && event.shiftKey) return runCommand('file.download', event);
  if (key === 's') return runCommand('file.saveNow', event);
  if (key === 'o') return runCommand('file.openLocal', event);
  if (key === 'c' && event.shiftKey) return runCommand('view.compileNow', event);
});

editor.onTextChanged((text, sync = true) => {
  scheduleCompile(text);
  if (sync) {
    if (!applyingHistoryChange) {
      history.record(text);
    }
    session.applyLocalText(text);
  } else {
    history.rebase(text);
  }
  if (!isClient && documentName !== 'Untitled') {
    autosave.markDirty();
  }
  menuBar.refresh();
  commandPalette.setCommands(buildPaletteCommands());
});

if (roomId) session.join(roomId);
scheduleCompile(editor.getText());

setupShareButton({
  button: document.getElementById('share-btn') as HTMLButtonElement,
  linkEl: shareLinkEl,
  getRoomId: () => session.ensureRoom(),
  getCurrentUrl: () => location.href,
});

if (!isClient) {
  titleEl.addEventListener('click', async () => {
  const next = window.prompt('Rename document:', documentName);
  if (!next || !next.trim() || next.trim() === documentName) return;

  const oldFileName = toTexName(documentName);
  documentName = next.trim();
  titleEl.textContent = documentName;
  await autosave.renameDocument(oldFileName, toTexName(documentName));
  session.broadcastMetadata({ title: documentName, storage: hostStorageLabel });
  });
}
