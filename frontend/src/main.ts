import './style.css';
import * as Y from 'yjs';
import { createEditorPane } from './ui/editor';
import { createPreviewPane } from './ui/preview';
import { createMenuBar, type CommandId, type CommandState } from './ui/menuBar';
import { createCommandPalette, type PaletteCommand } from './ui/commandPalette';
import { setupShareButton } from './ui/shareButton';
import { renderStaticIcons } from './ui/icons';
import { createSettingsDialog } from './ui/settingsDialog';
import { createFileTree } from './ui/fileTree';
import { createUploadDialog } from './ui/uploadDialog';
import { createProjectsDialog } from './ui/projectsDialog';
import { createFileViewer } from './ui/fileViewer';
import { createToolbar } from './ui/toolbar';
import { createAboutDialog } from './ui/aboutDialog';
import { createTour } from './ui/tour';
import { createNotice, helpForMessage, type NoticeHelp } from './ui/notices';
import { documentationBaseUrl, docsUrl, wireHelpLinks } from './ui/helpLinks';
import { bugReportUrl, featureRequestUrl, type IssueArea } from './ui/issueLinks';
import { connectionFailed, connectionText, isSavedStatus, saveStatusText } from './ui/statusText';
import { devPaletteCommands, paletteOnlyCommands, themeSwitchCommands } from './ui/paletteCommands';
import type { TransportState } from './net/p2pTransport';
import { SessionController } from './collab/session';
import { LocalDownloadStorage } from './storage/localDownload';
import { GoogleDriveProvider, LEGACY_PREFIX } from './storage/providers/googleDrive';
import { AutosaveController } from './storage/autosave';
import { LocalAppStorageProvider } from './storage/providers/localAppStorage';
import type { StorageProvider } from './storage/providers/types';
import { openGooglePicker } from './storage/providers/googlePicker';
import { createThemeController } from './app/theme';
import { createLayout } from './app/layout';
import { ProjectState, toTexName } from './app/projectState';
import { createPreviewCompile } from './app/previewCompile';
import { manifestFromProject, saveProject, type SavedManifest } from './storage/projectSaver';
import type { ConflictChoice, FileConflict } from './storage/conflicts';
import { keepMineAsCopy, takeTheirs } from './storage/conflictResolution';
import { createConflictDialog } from './ui/conflictDialog';
import { createCollabUndo } from './collab/undo';
import {
  readAppSessionState,
  writeAppSessionState,
  encodeYjsState,
  decodeYjsState,
  type PersistedYjsState,
  type ThemeMode,
} from './state/appSession';
import { readHostRoomId, writeHostRoomId } from './state/hostRoom';
import { NEW_PROJECT_CONFIRM, canRunCommand } from './state/guestCommands';
import { describeError } from './storage/errors';
import { BlobStore } from './project/blobStore';
import { LEGACY_TEXT_ID, ProjectDoc, type ProjectContent } from './project/projectDoc';
import { loadProject, projectFromZip, projectToZip, starterProject } from './project/projectIo';
import { MAX_FILE_BYTES, basename, isTextPath, joinPath, mimeType, normalizePath } from './project/paths';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');

// The page shell is Basecoat markup in index.html. First, swap the <i data-lucide> placeholders for icons.
renderStaticIcons();

const editorPane = document.getElementById('editor-pane') as HTMLElement;
const editor = createEditorPane(editorPane);
const preview = createPreviewPane(document.getElementById('preview-pane')!);
const shareButtonEl = document.getElementById('share-btn') as HTMLButtonElement;
const shareLinkEl = document.getElementById('share-link') as HTMLAnchorElement;
const compileStatusEl = document.getElementById('compile-status')!;
const diagnosticsEl = document.getElementById('diagnostics')!;
const autosaveStatusEl = document.getElementById('autosave-status')!;
const connectionStatusEl = document.getElementById('connection-status')!;
const diagnosticsHelpEl = document.getElementById('diagnostics-help') as HTMLAnchorElement;
const editorEmptyEl = document.getElementById('editor-empty') as HTMLElement;
const previewEmptyEl = document.getElementById('preview-empty') as HTMLElement;
const titleEl = document.getElementById('doc-title')!;
const splitRoot = document.getElementById('split-root') as HTMLElement;
const splitter = document.getElementById('splitter') as HTMLElement;
const previewPane = document.getElementById('preview-pane') as HTMLElement;
const appLoadingEl = document.getElementById('app-loading') as HTMLElement;
const appNoticeEl = document.getElementById('app-notice') as HTMLElement;
const activeFileNameEl = document.getElementById('active-file-name') as HTMLElement;
const activeFileMainEl = document.getElementById('active-file-main') as HTMLElement;
const zipInput = document.getElementById('zip-input') as HTMLInputElement;
const layout = createLayout({ splitRoot, splitter, editorPane, previewPane });
const roomId = new URLSearchParams(location.search).get('room');
const isClient = Boolean(roomId);

const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev';
const docsBase = documentationBaseUrl(import.meta.env, location.href);

// Now point every [data-help] link in the page at its docs section.
wireHelpLinks(document, docsBase);

/** The prefilled bug form. It only carries the browser, app version, and a fixed summary. */
const makeBugUrl = (area?: IssueArea, summary?: string) =>
  bugReportUrl({ appVersion: APP_VERSION, userAgent: navigator.userAgent, hostname: location.hostname, area, summary });

const openExternal = (url: string) => window.open(url, '_blank', 'noreferrer');

const localDownload = new LocalDownloadStorage();
const localAppProvider = new LocalAppStorageProvider();
const driveProvider = new GoogleDriveProvider();
const blobs = new BlobStore();
const projectState = new ProjectState(localAppProvider, driveProvider);
const { conflicts, overwrite } = projectState;
let activeFileId: string | null = null;
const themeState = createThemeController();
const { applyEditorTheme, applyPreviewTheme } = themeState;
let hostStorageText = 'Saved on host local storage';
const fileProgress = new Map<string, number>();
const driveApiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
const driveAppId = import.meta.env.VITE_GOOGLE_APP_ID as string | undefined;
const notice = createNotice(appNoticeEl, {
  getDocsBase: () => docsBase,
  getBugUrl: (help) => makeBugUrl(help.report, help.summary),
});
// Which kind of problem the notice shows right now, so we can clear it once that's fixed.
let noticeKind: 'save' | 'connection' | 'compile' | null = null;
let lastSavedAt: Date | null = null;
let transportState: TransportState = 'Not sharing';
let peerCount = 0;
let inRoom = isClient;

/**
 * Show a short message in the header, then clear it after a few seconds unless it's sticky.
 * Pass help to add "Learn more" (and maybe "Report this") links.
 */
function showNotice(message: string, isError = false, sticky = false, help: NoticeHelp | null = null) {
  noticeKind = null;
  // Errors like "storage is full" get their docs link even when the caller didn't pass one.
  notice.show(message, { isError, sticky, help: help ?? (isError ? helpForMessage(message) : null) });
}

const setStatus = (message: string) => {
  // First, note when a save lands, so the pill can say when as well as where.
  const saved = isSavedStatus(message);
  if (saved) lastSavedAt = new Date();
  autosaveStatusEl.textContent = saveStatusText(message, saved ? lastSavedAt : null);
  // Then, for problems like a failed save, show a notice that links to the fix.
  const help = helpForMessage(message);
  if (help) {
    showNotice(message, true, true, help);
    noticeKind = 'save';
  } else if (saved && noticeKind === 'save') {
    notice.clear();
    noticeKind = null;
  }
};

/** Update the connection pill, and tell guests where to look when they can't reach the host. */
function renderConnection() {
  const info = { isHost: !isClient, inRoom, state: transportState, peers: peerCount };
  connectionStatusEl.textContent = connectionText(info);
  if (connectionFailed(info)) {
    if (noticeKind === 'connection') return;
    showNotice("Can't reach the host. We'll keep trying.", true, true, {
      topic: 'p2pProblems',
      report: 'collaboration',
      summary: "A guest couldn't connect to the host.",
    });
    noticeKind = 'connection';
  } else if (peerCount > 0 && noticeKind === 'connection') {
    notice.clear();
    noticeKind = null;
  }
}

// Catch anything a command forgot to handle, so failures never just vanish into the console.
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled error', event.reason);
  showNotice(describeError(event.reason), true);
});

// First, restore the last session, so we know which doc, project and provider to pick up.
const restored = isClient ? null : readAppSessionState();
let driveRestoreMessage: string | null = null;
if (restored) {
  driveRestoreMessage = projectState.restore(restored);
  activeFileId = restored.activeFileId ?? null;
}

function restoredDocState() {
  if (!restored?.yjs) return undefined;
  const state = decodeYjsState(restored.yjs.state);
  return state ? { docId: restored.yjs.docId, state } : undefined;
}

applyEditorTheme(restored?.editorTheme ?? 'system');
applyPreviewTheme(restored?.previewTheme ?? 'system');
themeState.watchSystemTheme();

const session: SessionController = new SessionController({
  isHost: !isClient,
  blobs,
  onConnectionState: (state, peers) => {
    transportState = state;
    peerCount = peers;
    renderConnection();
  },
  onRemoteMetadata: ({ storage }) => {
    hostStorageText = storage;
    setStatus(storage);
  },
  getLocalMetadata: (): { title: string; storage: string } => ({ title: project.getName() || 'Untitled', storage: projectState.currentStorageLabel() }),
  initialState: restoredDocState(),
  onDocReplaced: () => bindProject(),
  onFileProgress: (hash, fraction) => {
    if (fraction === null) fileProgress.delete(hash);
    else fileProgress.set(hash, fraction);
    renderFiles();
  },
});

let project: ProjectDoc = new ProjectDoc(session.getDoc());
// Undo goes through Yjs so it only reverts our own edits, not a peer's. It follows the open file.
let undo = createCollabUndo(new Y.Doc().getText());
let unbindDoc: (() => void) | null = null;

const projectName = () => project.getName() || 'Untitled';

const persistAppSession = () => {
  if (isClient) return;
  const active = activeFileId ? project.get(activeFileId) : undefined;
  const persisted = session.getPersistedState();
  writeAppSessionState({
    documentName: projectName(),
    ...projectState.sessionFields(),
    content: active?.kind === 'text' ? project.getText(active.id).toString() : '',
    editorTheme: themeState.editorTheme,
    previewTheme: themeState.previewTheme,
    yjs: persisted ? ({ docId: persisted.docId, state: encodeYjsState(persisted.state) } satisfies PersistedYjsState) : undefined,
    activeFileId: activeFileId ?? undefined,
  });
};

// Now set up the host's project: resume the saved doc, upgrade an old single-file doc, or start fresh.
if (!isClient) {
  if (project.isEmpty()) {
    const legacyText = project.getText(LEGACY_TEXT_ID);
    if (legacyText.length === 0 && restored?.content) legacyText.insert(0, restored.content);
    if (legacyText.length > 0) {
      const name = restored && restored.documentName !== 'Untitled' ? restored.documentName : '';
      project.migrateLegacy(toTexName(name || 'main'), name);
    } else {
      project.replaceAll(starterProject(''));
    }
  }
}

const autosave = new AutosaveController({
  save: async () => {
    const provider = projectState.activeProvider;
    const forced = new Set(overwrite);
    const result = await saveProject({
      provider,
      project,
      blobs,
      manifest: projectState.manifest,
      projectId: projectState.projectId,
      held: new Set(conflicts.keys()),
      overwrite: forced,
      onStep: (step) => {
        // Keep progress from a save that fails halfway, unless the project changed under us.
        projectState.recordSave(provider, step);
      },
    });
    if (projectState.recordSave(provider, result.manifest)) {
      persistAppSession();
      for (const id of forced) overwrite.delete(id);
      for (const conflict of result.conflicts) holdConflict(conflict);
    }
    if (result.pending) setTimeout(() => setStatus(`Waiting for ${result.pending} file(s) from peers`), 0);
    if (conflicts.size) setTimeout(() => setStatus(`Saving paused for ${conflicts.size} file(s) changed in ${provider.label}`), 0);
    return provider.label;
  },
  onStatus: setStatus,
});
// Keep saving paused if it was paused in the last session.
autosave.setPaused(projectState.savingPaused);
const savingStatus = () => (projectState.savingPaused ? 'Saving paused' : 'Autosave On');

// When Drive can't get a new token, switch to local saves so no edits are lost.
driveProvider.onSessionLost(() => {
  showDriveAccount();
  if (!projectState.isDrive()) return;
  useProvider(localAppProvider, null);
  showNotice('Google Drive sign-in expired, so edits are saving in this browser. Use File > Connect Google Drive to switch back.', true, true, {
    topic: 'driveSignIn',
  });
  if (!projectState.savingPaused) void autosave.saveNow();
});

/** Point saves at a provider and project. Pass a manifest when the project was just loaded from it. */
function useProvider(provider: StorageProvider, id: string | null, loaded: SavedManifest | null = null) {
  projectState.use(provider, id, loaded);
  persistAppSession();
  session.broadcastMetadata({ title: projectName(), storage: projectState.currentStorageLabel() });
}

const conflictDialog = createConflictDialog(document.getElementById('conflict-dialog') as HTMLDialogElement);

/** Hold a file that changed in storage under us, and ask the person which copy to keep. */
function holdConflict(conflict: FileConflict) {
  if (conflicts.has(conflict.id)) return;
  conflicts.set(conflict.id, conflict);
  void conflictDialog.ask(conflict.path, projectState.activeProvider.label).then((choice) => resolveConflict(conflict, choice));
}

/** Act on the person's pick for a held file, then let saves pick it up again. */
async function resolveConflict(conflict: FileConflict, choice: ConflictChoice) {
  // Skip answers for a project we've since switched away from.
  const provider = projectState.activeProvider;
  const id = projectState.projectId;
  if (conflicts.get(conflict.id) !== conflict || !id) return;
  if (choice === 'mine') {
    overwrite.add(conflict.id);
    conflicts.delete(conflict.id);
    await autosave.saveNow();
    return;
  }
  try {
    // Run in the save queue, so a save can't write this file while we swap its content.
    await autosave.enqueue(async () => {
      const resolve = choice === 'copy' ? keepMineAsCopy : takeTheirs;
      const saved = await resolve({ provider, projectId: id, project, blobs, conflict });
      const { manifest } = projectState;
      if (provider !== projectState.activeProvider || !manifest) return;
      if (saved) manifest.files[conflict.id] = saved;
      conflicts.delete(conflict.id);
      persistAppSession();
    });
    setStatus(choice === 'copy' ? `Saved your copy of ${conflict.path} as a new file` : `Loaded ${conflict.path} from ${provider.label}`);
  } catch (error) {
    // Keep holding the file and ask again, since nothing changed.
    showNotice(describeError(error), true);
    conflicts.delete(conflict.id);
    holdConflict(conflict);
  }
}

const compile = createPreviewCompile({
  getProject: () => project,
  getActiveFileId: () => activeFileId,
  blobs,
  preview,
  editor,
  compileStatusEl,
  diagnosticsEl,
  // Show a "Learn more" link next to the diagnostics while there's something to explain.
  onDiagnostics: (text, topic) => {
    diagnosticsHelpEl.hidden = !text;
    diagnosticsHelpEl.href = docsUrl(docsBase, topic);
  },
  // With no main file there's nothing to compile, so say how to pick one instead of showing a blank page.
  onEmpty: (empty) => {
    previewEmptyEl.hidden = !empty || (isClient && project.isEmpty());
  },
  onCompiled: () => {
    if (noticeKind !== 'compile') return;
    notice.clear();
    noticeKind = null;
  },
  // Only say so once per broken streak, not on every keystroke.
  onCompileError: () => {
    if (noticeKind === 'compile') return;
    showNotice("The preview couldn't be built.", true, true, {
      topic: 'previewErrors',
      report: 'preview',
      summary: 'The preview failed to compile.',
    });
    noticeKind = 'compile';
  },
});
const { scheduleCompile } = compile;

const fileTree = createFileTree(document.getElementById('file-pane')!, {
  onOpen: (entry) => openFile(entry.id),
  onRename: (path) => runFileOp(() => {
    const next = window.prompt('Rename or move (use / for folders):', path);
    if (next && next.trim() && next.trim() !== path) project.movePath(path, next.trim());
  }),
  onDelete: (path) => runFileOp(() => {
    if (window.confirm(`Delete ${path}? Collaborators lose it too.`)) project.removePath(path);
  }),
  onSetMain: (entry) => project.setMainFile(entry.id),
  onMove: (path, folder) => runFileOp(() => project.movePath(path, joinPath(folder, basename(path)))),
  onUpload: (files, folder) => void uploadFiles(files, folder),
  onCommand: (commandId) => executeCommand(commandId),
});

const fileViewer = createFileViewer(document.getElementById('file-viewer')!, {
  onDownload: (path) => void downloadFile(path),
});

/** Run a file tree change and show its error, like a name that's taken. */
function runFileOp(op: () => void) {
  try {
    op();
  } catch (error) {
    showNotice(describeError(error), true);
  }
}

function renderFiles() {
  fileTree.render({
    entries: project.entries(),
    folders: project.folderPaths(),
    activeId: activeFileId,
    mainId: project.getMainFileId(),
    progress: fileProgress,
    waiting: isClient && project.isEmpty(),
  });
  showActiveFile();
}

/** Update the file bar, and the viewer when a binary file is open. */
function showActiveFile() {
  const entry = activeFileId ? project.get(activeFileId) : undefined;
  activeFileNameEl.textContent = entry?.path ?? '';
  activeFileMainEl.hidden = !entry || entry.id !== project.getMainFileId();
  titleEl.textContent = projectName();
  // With nothing open, swap the blank editor for a hint about what to do.
  const nothingOpen = !entry && !(isClient && project.isEmpty());
  editorEmptyEl.hidden = !nothingOpen;
  editorPane.classList.toggle('is-empty', nothingOpen);
  if (entry?.kind === 'binary') {
    const bytes = entry.hash ? (blobs.peek(entry.hash) ?? null) : null;
    fileViewer.show({ path: entry.path, size: entry.size, bytes, progress: entry.hash ? fileProgress.get(entry.hash) : undefined });
  }
}

/** Open a file: text goes in the editor, everything else in the viewer. */
function openFile(id: string | null) {
  const entry = id ? project.get(id) : undefined;
  const previous = activeFileId;
  activeFileId = entry && entry.kind !== 'folder' ? entry.id : null;
  if (entry) fileTree.reveal(entry.path);
  if (entry?.kind === 'binary') {
    editorPane.classList.add('is-viewing');
  } else {
    editorPane.classList.remove('is-viewing');
    fileViewer.hide();
    if (previous !== activeFileId || !entry) bindEditor(entry ? project.getText(entry.id) : null);
  }
  renderFiles();
  compile.invalidate();
  scheduleCompile();
  persistAppSession();
  refreshCommands();
}

/** Bind the editor to one file's text, with an undo stack of its own. */
function bindEditor(text: Y.Text | null) {
  editor.setCollabExtensions([]);
  undo.manager.destroy();
  undo = createCollabUndo(text ?? new Y.Doc().getText());
  undo.subscribe(() => menuBar.refresh());
  editor.setText(text ? text.toString() : '', false);
  editor.setEditable(Boolean(text));
  if (text) editor.setCollabExtensions(undo.extensions());
}

/** Pick a file to show when the open one is gone: the main file, then any text file. */
function ensureActiveFile() {
  const current = activeFileId ? project.get(activeFileId) : undefined;
  if (current) return;
  const fallback = project.getMainFileId() ?? project.entries().find((entry) => entry.kind === 'text')?.id ?? null;
  openFile(fallback);
}

/** Make sure we have the bytes of every binary file: from the cache, storage, or a peer. */
async function fetchMissingFiles() {
  for (const entry of project.entries()) {
    if (entry.kind !== 'binary' || !entry.hash || blobs.has(entry.hash) || session.transfer.isTransferring(entry.hash)) continue;
    const hash = entry.hash;
    if (await blobs.get(hash)) continue;
    const { manifest, projectId, activeProvider } = projectState;
    const saved = manifest && Object.values(manifest.files).find((file) => file.rev === hash);
    if (!isClient && projectId && saved) {
      try {
        await blobs.put(await activeProvider.readFile(projectId, saved.path), hash);
        continue;
      } catch (error) {
        console.warn(`Could not load ${saved.path} from storage`, error);
      }
    }
    session.transfer.request(hash);
  }
}

/** Hook the UI up to the current project doc. Guests run this again when the host sends a new doc. */
function bindProject() {
  unbindDoc?.();
  project = new ProjectDoc(session.getDoc());
  const onUpdate = () => {
    scheduleCompile();
    if (!isClient && project.getName()) autosave.markDirty();
    persistAppSession();
  };
  session.getDoc().on('update', onUpdate);
  const stopTree = project.onTreeChange(() => {
    ensureActiveFile();
    renderFiles();
    void fetchMissingFiles();
    refreshCommands();
  });
  unbindDoc = () => {
    session.getDoc().off('update', onUpdate);
    stopTree();
  };
  activeFileId = activeFileId && project.get(activeFileId) ? activeFileId : null;
  // Rebind even when the id matches, since a replaced doc has new Y.Text objects.
  const keep = activeFileId;
  activeFileId = null;
  openFile(keep ?? project.getMainFileId() ?? project.entries().find((entry) => entry.kind === 'text')?.id ?? null);
  void fetchMissingFiles();
}

blobs.onAdded(() => {
  renderFiles();
  compile.invalidate();
  scheduleCompile();
  // A file a peer just sent may still need saving.
  if (!isClient && project.getName()) autosave.markDirty();
});

/** Swap in a whole new project, after saving what's pending on the old one. */
async function switchProject(content: ProjectContent, provider: StorageProvider, id: string | null) {
  if (autosave.hasUnsavedChanges()) await autosave.saveNow();
  await autosave.enqueue(async () => {
    activeFileId = null;
    project.replaceAll(content);
    useProvider(provider, id, id ? manifestFromProject(id, project, (path) => provider.fileVersion?.(id, path)) : null);
  });
  ensureActiveFile();
  renderFiles();
  setStatus(id ? `Opened ${projectName()}` : savingStatus());
}

/** Ask for a project name before the first save, since storage needs one. */
const promptForProjectName = (): boolean => {
  if (project.getName()) return true;
  const next = window.prompt('Name this project before saving:', '');
  if (!next || !next.trim()) {
    showNotice('Save canceled: the project needs a name first.');
    return false;
  }
  project.setName(next.trim());
  return true;
};

async function renameProject() {
  const next = window.prompt('Rename project:', project.getName());
  if (!next || !next.trim() || next.trim() === project.getName()) return;
  // The name lives in the shared doc, and the next save renames the stored project too.
  project.setName(next.trim());
  session.broadcastMetadata({ title: projectName(), storage: projectState.currentStorageLabel() });
}

/** Add uploaded files to the project. Text files become editable text, others go by hash. */
async function uploadFile(file: File, folder: string): Promise<{ name: string; ok: boolean; message: string }> {
  const name = file.name;
  if (file.size > MAX_FILE_BYTES) return { name, ok: false, message: `too big (the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB)` };
  const path = normalizePath(joinPath(folder, name));
  if (!path) return { name, ok: false, message: 'that name is not allowed' };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (name.toLowerCase().endsWith('.zip')) return { name, ok: false, message: 'use File > Upload .zip as New Project for zips' };
    if (isTextPath(path)) {
      const text = new TextDecoder().decode(bytes);
      const existing = project.findByPath(path);
      if (existing?.kind === 'text') {
        const yText = project.getText(existing.id);
        session.getDoc().transact(() => {
          yText.delete(0, yText.length);
          yText.insert(0, text);
        });
        return { name, ok: true, message: 'replaced' };
      }
      project.createTextFile(path, text);
      return { name, ok: true, message: 'added' };
    }
    const hash = await blobs.put(bytes);
    const replaced = project.findByPath(path)?.kind === 'binary';
    project.putBinaryFile(path, hash, bytes.length);
    return { name, ok: true, message: replaced ? 'replaced' : 'added' };
  } catch (error) {
    return { name, ok: false, message: describeError(error) };
  }
}

async function uploadFiles(files: File[], folder: string) {
  const results = [];
  for (const file of files) results.push(await uploadFile(file, folder));
  const failed = results.filter((result) => !result.ok);
  if (failed.length) showNotice(failed.map((result) => `${result.name}: ${result.message}`).join('; '), true);
  else showNotice(`Uploaded ${results.length} file(s)`);
}

const uploadDialog = createUploadDialog(document.getElementById('upload-dialog') as HTMLDialogElement, {
  getFolders: () => project.folderPaths(),
  upload: uploadFile,
});

const projectsDialog = createProjectsDialog(document.getElementById('projects-dialog') as HTMLDialogElement, {
  onPick: (summary) => {
    if (!isClient) void openStoredProject(localAppProvider, summary.id);
  },
  onImportZip: () => executeCommand('file.importZip'),
});

async function openStoredProject(provider: StorageProvider, id: string) {
  showLoading(`Opening ${provider === driveProvider ? 'from Google Drive' : 'project'}...`);
  try {
    const content = await loadProject(provider, id, blobs);
    autosave.enable();
    await switchProject(content, provider, provider.currentProjectId?.(id) ?? id);
  } catch (error) {
    console.error('Open project failed', error);
    setStatus(describeError(error));
  } finally {
    hideLoading();
  }
}

zipInput.addEventListener('change', () => {
  const file = zipInput.files?.[0];
  zipInput.value = '';
  // Importing replaces the shared project, so guests can't do it.
  if (!file || isClient) return;
  void (async () => {
    showLoading('Reading .zip...');
    try {
      const content = await projectFromZip(file.name, new Uint8Array(await file.arrayBuffer()), blobs);
      // The project gets made in storage on the first save.
      await switchProject(content, projectState.isDrive() && driveProvider.isSignedIn() ? driveProvider : localAppProvider, null);
      autosave.markDirty();
      showNotice(`Created ${projectName()} from ${file.name}`);
    } catch (error) {
      showNotice(describeError(error), true);
    } finally {
      hideLoading();
    }
  })();
});

async function downloadFile(path: string) {
  const entry = project.findByPath(path);
  if (!entry) return;
  if (entry.kind === 'text') {
    localDownload.download(basename(path), project.getText(entry.id).toString());
    return;
  }
  const bytes = entry.hash ? await blobs.get(entry.hash) : undefined;
  if (!bytes) {
    showNotice(`${path} hasn't arrived from a peer yet.`, true);
    return;
  }
  localDownload.download(basename(path), bytes, mimeType(path));
}

const showLoading = (label: string) => {
  (document.getElementById('app-loading-label') as HTMLElement).textContent = label;
  appLoadingEl.classList.add('is-active');
};

const hideLoading = () => {
  appLoadingEl.classList.remove('is-active');
};

const ensureDriveConnected = async () => {
  setStatus('Drive: Connecting...');
  const connected = await driveProvider.connect();
  if (!connected) {
    setStatus(driveProvider.status());
    return false;
  }
  // Clear any leftover "sign-in expired" notice now that we're back.
  notice.clear();
  noticeKind = null;
  setStatus('Drive: Connected');
  void driveProvider.loadAccount().then(showDriveAccount);
  return true;
};

/** Show who's signed in to Drive on the save status badge and in Settings. */
function showDriveAccount() {
  const account = driveProvider.accountLabel();
  autosaveStatusEl.title = account ? `Google Drive: ${account}` : '';
  if (settingsDialog.isOpen()) settingsDialog.refresh();
  refreshCommands();
}

const ensureDrivePickerConfig = () => {
  if (driveApiKey) return true;
  setStatus('Drive: API key missing');
  showNotice('Google Drive picker is not set up on this site (VITE_GOOGLE_API_KEY is missing).', true);
  return false;
};

/** Open the Drive picker and turn script or popup failures into a status message. */
const pickFromDrive = async (kind: 'project' | 'folder') => {
  try {
    return await openGooglePicker({
      accessToken: driveProvider.getAccessToken(),
      apiKey: driveApiKey!,
      appId: driveAppId,
      kind,
    });
  } catch (error) {
    console.error('Google Picker failed', error);
    setStatus(`Drive: ${describeError(error)}`);
    return undefined;
  }
};

/** Start saving to Drive. A project that isn't in Drive yet gets a new folder on the next save. */
const switchToDrive = () => {
  if (!projectState.isDrive()) useProvider(driveProvider, null);
};

const commandRegistry: Record<CommandId, () => Promise<void> | void> = {
  'app.commandPalette': () => {
    commandPalette.toggle();
  },
  'file.new': async () => {
    if (isClient) return;
    if (!window.confirm(NEW_PROJECT_CONFIRM)) return;
    await switchProject(starterProject(''), projectState.activeProvider, null);
  },
  'file.openLocal': async () => {
    if (isClient) return;
    projectsDialog.open(await localAppProvider.listProjects());
  },
  'file.openDrive': async () => {
    if (isClient) return;
    if (!ensureDrivePickerConfig()) return;
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
  'file.importZip': () => {
    if (isClient) return;
    zipInput.click();
  },
  'file.newFile': () => runFileOp(() => {
    const folder = fileTree.currentFolder();
    const name = window.prompt(`New file${folder ? ` in ${folder}/` : ''}:`, 'chapter.tex');
    if (!name || !name.trim()) return;
    // New files are text, so give them a text extension if they don't have one.
    const path = joinPath(folder, isTextPath(name.trim()) ? name.trim() : `${name.trim()}.tex`);
    const id = project.createTextFile(path);
    openFile(id);
  }),
  'file.newFolder': () => runFileOp(() => {
    const folder = fileTree.currentFolder();
    const name = window.prompt(`New folder${folder ? ` in ${folder}/` : ''}:`, 'figures');
    if (name && name.trim()) project.createFolder(joinPath(folder, name.trim()));
  }),
  'file.upload': () => uploadDialog.open(fileTree.currentFolder()),
  'file.download': async () => {
    const { zip, skipped } = await projectToZip(project, blobs);
    localDownload.download(`${projectName()}.zip`, zip, 'application/zip');
    showNotice(skipped.length ? `Downloaded, but still waiting on: ${skipped.join(', ')}` : `Downloaded ${projectName()}.zip`, skipped.length > 0);
  },
  'file.downloadFile': async () => {
    const entry = activeFileId ? project.get(activeFileId) : undefined;
    if (entry) await downloadFile(entry.path);
  },
  'file.connectDrive': async () => {
    if (isClient) return;
    if (!(await ensureDriveConnected())) return;
    switchToDrive();
    autosave.enable();
    setStatus(project.getName() ? 'Drive: Connected' : 'Drive: Connected (name the project to save)');
    if (project.getName()) autosave.markDirty();
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
  'edit.undo': () => undo.undo(),
  'edit.redo': () => undo.redo(),
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
  'app.openSettings': () => settingsDialog.open(),
  'file.rename': () => renameProject(),
  'share.copyLink': () => shareButtonEl.click(),
  'view.compileNow': () => compile.compileNow(),
  'view.layoutSplit': () => {
    layout.setMode('split');
    menuBar.refresh();
  },
  'view.layoutEditorOnly': () => {
    layout.setMode('editor-only');
    menuBar.refresh();
  },
  'view.layoutPreviewOnly': () => {
    layout.setMode('preview-only');
    menuBar.refresh();
  },
  'help.documentation': () => {
    openExternal(docsUrl(docsBase, 'gettingStarted'));
  },
  'help.shortcuts': () => {
    openExternal(docsUrl(docsBase, 'shortcuts'));
  },
  'help.tour': () => tour.start(),
  // NOTE: these only open the GitHub form. The person reads it and submits it themselves.
  'help.reportBug': () => {
    openExternal(makeBugUrl());
  },
  'help.requestFeature': () => {
    openExternal(featureRequestUrl());
  },
  'help.about': () => aboutDialog.open(),
  // These two only show in the palette in dev builds (see devPaletteCommands).
  'dev.openTestProject': async () => {
    if (import.meta.env.DEV && !isClient) {
      if (!window.confirm('Open the regression test project? The current one stays saved where it is.')) return;
      // Load it lazily, so the test project never ends up in a production bundle.
      const { regressionProject } = await import('./dev/regressionProject');
      await switchProject(await regressionProject(blobs), activeProvider, null);
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
  menuBar.refresh();
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
  menuBar.refresh();
  toolbar.refresh();
  commandPalette.setCommands(buildPaletteCommands());
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
      return { enabled: !isClient && projectState.isDrive() };
    case 'file.disconnectDrive':
      return { enabled: !isClient && driveProvider.isSignedIn() };
    case 'file.newFile':
    case 'file.newFolder':
    case 'file.upload':
      // Guests can add files too, once they have the host's project.
      return { enabled: !(isClient && project.isEmpty()) };
    case 'file.downloadFile':
      return { enabled: Boolean(activeFileId) };
    case 'file.saveNow':
      return { enabled: !isClient && !projectState.savingPaused };
    case 'edit.undo':
      return { enabled: undo.canUndo() };
    case 'edit.redo':
      return { enabled: undo.canRedo() };
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

const menuBar = createMenuBar(document.getElementById('menu-bar')!, {
  getCommandState,
  onCommand: (commandId) => executeCommand(commandId),
});

const commandPalette = createCommandPalette(document.getElementById('command-palette')!, {
  onSelect: (commandId) => executeCommand(commandId),
});

const settingsDialog = createSettingsDialog(document.getElementById('settings-dialog') as HTMLDialogElement, {
  getState: () => ({
    editorTheme: themeState.editorTheme,
    previewTheme: themeState.previewTheme,
    savingPaused: projectState.savingPaused,
    canChangeSaving: !isClient,
    driveAccount: driveProvider.isSignedIn() ? (driveProvider.accountLabel() ?? '') : null,
  }),
  onEditorTheme: (theme) => {
    applyEditorTheme(theme);
    persistAppSession();
    refreshCommands();
  },
  onPreviewTheme: (theme) => {
    applyPreviewTheme(theme);
    persistAppSession();
    refreshCommands();
  },
  onSavingPaused: (paused) => {
    setSavingPaused(paused);
    refreshCommands();
  },
  onClearLocalDocs: () => executeCommand('file.clearLocalDocs'),
});

const toolbar = createToolbar(document.getElementById('toolbar')!, {
  getCommandState,
  onCommand: (commandId) => executeCommand(commandId),
});

const aboutDialog = createAboutDialog(document.getElementById('about-dialog') as HTMLDialogElement, APP_VERSION);

const tour = createTour(document.getElementById('tour')!, document.getElementById('tour-steps')!, {
  store: (() => {
    // Some browsers throw just for touching localStorage when site data is blocked.
    try {
      return window.localStorage;
    } catch {
      return undefined;
    }
  })(),
});

// The empty states have their own buttons for the next step, like New file.
document.querySelectorAll<HTMLButtonElement>('#editor-empty [data-command], #preview-empty [data-command]').forEach((button) => {
  button.addEventListener('click', () => executeCommand(button.dataset.command as CommandId));
});

/** Build the palette from the menu HTML, plus the palette-only commands in paletteCommands.ts. */
function buildPaletteCommands(): PaletteCommand[] {
  const fromMenus = menuBar
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
commandPalette.setCommands(buildPaletteCommands());

const runCommand = (commandId: CommandId, event: KeyboardEvent) => {
  const state = getCommandState(commandId);
  if (!state.enabled) return;
  event.preventDefault();
  executeCommand(commandId);
};

window.addEventListener('keydown', (event) => {
  // The editor already handled this key (like its own undo), so don't run it a second time.
  if (event.defaultPrevented) return;
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
  if (key === ',') return runCommand('app.openSettings', event);
});

editor.onTextChanged((_text, sync = true) => {
  // Loading a different file shouldn't be undoable, so drop the stack.
  if (!sync) undo.clear();
  menuBar.refresh();
});

// Now everything is in place, so hook up the project and show it.
bindProject();
if (!isClient) {
  // Old local saves move into IndexedDB here, then an old session finds its project again.
  void localAppProvider
    .connect()
    .then(async () => {
      if (!projectState.projectId && projectState.activeProvider === localAppProvider && restored && !restored.projectId && project.getName()) {
        const mainId = project.getMainFileId();
        const mainPath = mainId ? project.get(mainId)?.path : undefined;
        if (mainPath) projectState.projectId = await localAppProvider.findLegacyProject(mainPath);
      }
      autosave.enable();
      setStatus(driveRestoreMessage ?? savingStatus());
      if (driveProvider.hasUsableToken()) void driveProvider.loadAccount().then(showDriveAccount);
    })
    .catch((error) => {
      console.error('Local storage failed', error);
      setStatus(describeError(error));
    });
} else {
  setStatus(hostStorageText);
}

// Guests join the room in the URL, and a reloaded host rejoins the room this tab already shared.
const hostRoomId = isClient ? null : readHostRoomId();
if (roomId) session.join(roomId);
else if (hostRoomId) session.join(hostRoomId);
inRoom = Boolean(roomId || hostRoomId);
renderConnection();
layout.installSplitter();
layout.applyLayoutMode();
hideLoading();
scheduleCompile();

setupShareButton({
  button: shareButtonEl,
  linkEl: shareLinkEl,
  getRoomId: () => {
    const id = session.ensureRoom();
    if (!isClient) writeHostRoomId(id);
    inRoom = true;
    renderConnection();
    return id;
  },
  getCurrentUrl: () => location.href,
  onStatus: (message) => showNotice(message),
  initialRoomId: hostRoomId,
  newLinkButton: isClient ? undefined : (document.getElementById('new-link-btn') as HTMLButtonElement),
  getNewRoomId: () => {
    const id = session.newRoom();
    writeHostRoomId(id);
    // Everyone on the old link is gone now.
    peerCount = 0;
    renderConnection();
    return id;
  },
  confirmNewLink: () => window.confirm('Start a new link? Anyone using the old link will be disconnected.'),
});

// Guests can't rename the host's project, so the title is just a label for them.
if (isClient) {
  (titleEl as HTMLButtonElement).disabled = true;
  titleEl.removeAttribute('data-tooltip');
} else {
  titleEl.addEventListener('click', () => void renameProject());
}

// The skip link jumps to the editor itself, not just its pane.
document.querySelector('.skip-link')?.addEventListener('click', (event) => {
  event.preventDefault();
  editor.focus();
});

// Finally, show the tour to first-time visitors once the page has settled.
setTimeout(() => tour.startIfNew(), 600);

window.addEventListener('beforeunload', (event) => {
  persistAppSession();
  // Warn before closing if the last save hasn't gone through yet, or a file is held by a conflict.
  if (autosave.hasUnsavedChanges() || conflicts.size > 0) {
    event.preventDefault();
    event.returnValue = '';
  }
});
