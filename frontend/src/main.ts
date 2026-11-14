import './style.css';
import * as Y from 'yjs';
import { createEditorPane } from './ui/editor';
import { createPreviewPane } from './ui/preview';
import { createMenuBar, type CommandId } from './ui/menuBar';
import { setupShareButton } from './ui/shareButton';
import { renderStaticIcons } from './ui/icons';
import { createFileTree } from './ui/fileTree';
import type { ExportDialog } from './ui/exportDialog';
import { createFileViewer } from './ui/fileViewer';
import { createToolbar } from './ui/toolbar';
import { renderFooterVersion } from './ui/footerVersion';
import { createChangelogDialog } from './ui/changelogDialog';
import { BUILD_INFO, formatVersion } from './app/buildInfo';
import { flushBeforeReload } from './app/updateCheck';
import { setupUpdateFlow } from './app/updateFlow';
import { browserOnline, classifyLoadFailure, createOnlineRetry, isLoadFailure, lazyModule, loadFailureMessage, preloadOnIntent, whenIdle } from './app/lazy';
import { lazyAboutDialog, lazyCommandPalette, lazyProjectsDialog, lazySettings, lazyTemplates, lazyTour, lazyUploadDialog } from './app/lazyUi';
import { shouldConfirmLeave } from './app/leaveGuard';
import { createNotice, helpForMessage, type NoticeHelp } from './ui/notices';
import { documentationBaseUrl, docsUrl, wireHelpLinks } from './ui/helpLinks';
import { bugReportUrl, featureRequestUrl, SECURITY_REPORT_URL, type IssueArea } from './ui/issueLinks';
import { connectionFailed, connectionText, isSavedStatus, saveStatusText } from './ui/statusText';
import type { TransportState } from './net/p2pTransport';
import { SessionController } from './collab/session';
import { LocalDownloadStorage } from './storage/localDownload';
import { GoogleDriveProvider } from './storage/providers/googleDrive';
import { AutosaveController } from './storage/autosave';
import { LocalAppStorageProvider } from './storage/providers/localAppStorage';
import type { StorageProvider } from './storage/providers/types';
import { DRIVE_MISSING_HINT, DRIVE_PICK_CONFLICT, addFromDriveNote } from './app/driveNotes';
import { createThemeController } from './app/theme';
import { createLayout } from './app/layout';
import { ProjectState, toTexName } from './app/projectState';
import { createPreviewCompile } from './app/previewCompile';
import { createCommands, shortcuts } from './app/commands';
import { createKeymap } from './app/keymap';
import { describeKeyContext, reservedKeys, watchKeyContext } from './app/reservedKeys';
import { cleanDisplayName, createSettingsStore, MAX_DISPLAY_NAME_LENGTH } from './state/settings';
import { bindSettings, importSettingsFile, resetSettings, settingsFileName } from './app/settingsBinding';
import { editorKeybinds } from './ui/editor';
import { detectPlatform } from './ui/modifierShortcutLabels';
import { createPreviewChanges, previewChangesElements } from './ui/previewChanges';
import { manifestFromProject, saveProject, type SavedManifest } from './storage/projectSaver';
import type { ConflictChoice, FileConflict } from './storage/conflicts';
import type { createConflictDialog } from './ui/conflictDialog';
import { confirmDialog, noticeDialog, promptDialog } from './ui/dialogs';
import { explainNoWebRtc, hasWebRtc, noWebRtcAdvice, noWebRtcTitle, webAppUrl, webRoomLink, type P2pAction } from './app/p2pSupport';
import { isDesktopShell, openInSystemBrowser } from './app/desktopShell';
import { pathProblem, projectNameProblem, suggestFreeName } from './ui/nameChecks';
import { createCollabUndo } from './collab/undo';
import { createPresenceFlow } from './app/presenceFlow';
import type { PresencePeer } from './collab/presence';
import { EditorView } from '@codemirror/view';
import {
  readAppSessionState,
  writeAppSessionState,
  type SessionWriteResult,
  encodeYjsState,
  decodeYjsState,
  type PersistedYjsState,
} from './state/appSession';
import { readHostRoomId, writeHostRoomId } from './state/hostRoom';
import { describeError } from './storage/errors';
import { BlobStore } from './project/blobStore';
import { createFileHistory } from './project/fileHistory';
import { LEGACY_TEXT_ID, ProjectDoc, type ProjectContent } from './project/projectDoc';
import { loadProject, projectFromZip, starterProject } from './project/projectIo';
import { MAX_FILE_BYTES, basename, dirname, isTextPath, joinPath, mimeType, normalizePath } from './project/paths';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');

// The page shell is Basecoat markup in index.html. First, swap the <i data-lucide> placeholders for icons.
renderStaticIcons();

const editorPane = document.getElementById('editor-pane') as HTMLElement;
const editor = createEditorPane(editorPane);
const preview = createPreviewPane(document.getElementById('preview-pane')!);
const previewChanges = createPreviewChanges(previewChangesElements());
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
// The person's own settings (themes, layout, keybinds). Kept apart from the session, never sent to peers.
const settings = createSettingsStore();
const layout = createLayout({ splitRoot, splitter, editorPane, previewPane, onChange: ({ mode, splitRatio }) => settings.update({ layoutMode: mode, splitRatio }) });
const roomId = new URLSearchParams(location.search).get('room');
const isClient = Boolean(roomId);

const docsBase = documentationBaseUrl(import.meta.env, location.href);
// Without WebRTC no room can work, so the P2P code never starts in this window (issue #205).
const p2pAvailable = hasWebRtc();

// Now point every [data-help] link in the page at its docs section.
wireHelpLinks(document, docsBase);

/** The prefilled bug form. It only carries the browser, app version, and a fixed summary. */
const makeBugUrl = (area?: IssueArea, summary?: string) =>
  bugReportUrl({ appVersion: formatVersion(BUILD_INFO), userAgent: navigator.userAgent, hostname: location.hostname, area, summary });

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
// The rendered document sets its own colors, so keep it on the same preview theme as the frame around it.
window.addEventListener('previewthemechange', () => preview.setTheme(themeState.previewDisplayTheme));
let hostStorageText = 'Saved on host local storage';
const fileProgress = new Map<string, number>();
const driveApiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
const driveAppId = import.meta.env.VITE_GOOGLE_APP_ID as string | undefined;
const notice = createNotice(appNoticeEl, {
  getDocsBase: () => docsBase,
  getBugUrl: (help) => makeBugUrl(help.report, help.summary),
});
// Which kind of problem the notice shows right now, so we can clear it once that's fixed.
let noticeKind: 'save' | 'connection' | 'compile' | 'offline' | null = null;
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
  const info = { isHost: !isClient, inRoom, state: transportState, peers: peerCount, noWebRtc: !p2pAvailable };
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

// What was opened while offline runs when the browser is back online, and the deferred preloads start then.
const onlineRetry = createOnlineRetry(() => {
  if (noticeKind === 'offline') {
    notice.clear();
    noticeKind = null;
  }
  preloadDialogs();
});

/**
 * A part of the app that loads on first use didn't load. Offline, say so and run `retry` once back
 * online. Online, only call it an update when version.json names a newer build (app/updateFlow.ts);
 * otherwise it's the network.
 */
function lazyLoadFailed(feature: string, error: unknown, retry?: () => void) {
  void classifyLoadFailure(error, { isOnline: browserOnline, newerBuildLive: async () => Boolean(await updateFlow?.newerBuildLive()) }).then((kind) => {
    if (kind === 'offline') {
      if (retry) onlineRetry.add(feature, retry);
      showNotice(loadFailureMessage(kind, feature, Boolean(retry)), false, true);
      noticeKind = 'offline';
      return;
    }
    console.error(`${feature} failed to load`, error);
    if (kind !== 'update') showNotice(loadFailureMessage(kind, feature), true);
  });
}

// Commands show their own errors (app/commands.ts). Anything else unhandled is background noise from
// a library, like Trystero or Google sign-in, that the person can't act on, so it only goes to the
// console. A part of the app that failed to load is the exception.
window.addEventListener('unhandledrejection', (event) => {
  if (isLoadFailure(event.reason)) lazyLoadFailed('Part of the app', event.reason);
  else console.error('Unhandled error', event.reason);
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

applyEditorTheme(settings.get('editorTheme'));
applyPreviewTheme(settings.get('previewTheme'));
themeState.watchSystemTheme();

// Set up at the end of this file. Peers only say hello once the page is running, so it's ready by then.
let updateFlow: ReturnType<typeof setupUpdateFlow> | null = null;

const session: SessionController = new SessionController({
  isHost: !isClient,
  blobs,
  build: BUILD_INFO,
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
  onPeerVersion: (peer) => updateFlow?.onPeerVersion(peer),
  onTransportLoadError: (error) => lazyLoadFailed('Sharing', error),
  onFileProgress: (hash, fraction) => {
    if (fraction === null) fileProgress.delete(hash);
    else fileProgress.set(hash, fraction);
    renderFiles();
  },
  onPresence: (payload, peerId) => presence.receive(payload, peerId),
  onPeerJoin: (peerId) => presence.peerJoined(peerId),
  onPeerLeave: (peerId) => presence.peerLeft(peerId),
});

let project: ProjectDoc = new ProjectDoc(session.getDoc());
// Undo goes through Yjs so it only reverts our own edits, not a peer's. It follows the open file.
let undo = createCollabUndo(new Y.Doc().getText());
let unbindDoc: (() => void) | null = null;

// Undo for the file tree, apart from the text undo above (issue #55). bindProject makes one per doc.
const makeFileHistory = (doc: ProjectDoc) =>
  createFileHistory(doc, { blobs, inUse: (hash) => project.entries().some((entry) => entry.hash === hash) });
let fileHistory = makeFileHistory(project);
// Edit > Undo and its keys act on the file tree while it has focus or was used last, else on the open file.
let undoContext: 'files' | 'text' = 'text';
function setUndoContext(next: 'files' | 'text') {
  if (undoContext === next) return;
  undoContext = next;
  refreshCommands();
}
const fileUndo = {
  undo: () => runHistoryStep('undo'),
  redo: () => runHistoryStep('redo'),
  canUndo: () => fileHistory.canUndo(),
  canRedo: () => fileHistory.canRedo(),
  undoLabel: () => fileHistory.undoLabel(),
  redoLabel: () => fileHistory.redoLabel(),
};
// The Y.Text the editor shows, so presence can add remote cursors to it once it starts.
let boundText: Y.Text | null = null;

// Who's in the room and where their cursors are (issue #22). Only the name and cursor are shared.
const presence = createPresenceFlow({
  settings,
  root: document.getElementById('presence-bar') as HTMLElement,
  send: (message, peerId) => session.sendPresence(message, peerId),
  selfId: () => session.selfId(),
  hasType: (name) => session.getDoc().share.has(name),
  filePath: (id) => (id ? (project.get(id)?.path ?? null) : null),
  onFollow: (peer) => followPeer(peer.peerId),
  onEditName: () => void editDisplayName(),
  onPeersChange: () => renderFiles(),
  onLoadError: (error) => lazyLoadFailed('Presence', error, startPresence),
});

/** Start sharing presence, then add peers' cursors to the open file. */
function startPresence() {
  void presence.start().then(() => {
    if (boundText) editor.setCollabExtensions(undo.extensions(presence.awareness()));
  });
}

/** Open the file a peer has open and scroll to their cursor. */
function followPeer(peerId: string) {
  const peer: PresencePeer | null = presence.peer(peerId);
  if (!peer?.file || !project.get(peer.file)) {
    showNotice(peer ? `${peer.name} has no file open.` : 'That person left the room.');
    return;
  }
  openFile(peer.file);
  const head = peer.cursor && Y.createAbsolutePositionFromRelativePosition(peer.cursor.head, session.getDoc());
  if (!head || head.type !== project.getText(peer.file)) return;
  const view = editor.getView();
  view.dispatch({ effects: EditorView.scrollIntoView(Math.min(head.index, view.state.doc.length), { y: 'center' }) });
}

/** Change the name peers see. It's kept in this browser's settings. */
async function editDisplayName() {
  const next = await promptDialog({
    title: 'Your name in shared rooms',
    message: 'People in the room see this next to your cursor. Nothing else about you is shared.',
    label: 'Display name',
    initialValue: presence.name(),
    confirmLabel: 'Save',
    validate: (value) => (cleanDisplayName(value) ? (value.length > MAX_DISPLAY_NAME_LENGTH ? `Use ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.` : null) : 'Type a name.'),
  });
  const name = next === null ? undefined : cleanDisplayName(next);
  if (name) settings.set('displayName', name);
}

const projectName = () => project.getName() || 'Untitled';

/** Write the session to localStorage. pendingSave tells the next load to save edits the autosave hadn't. */
const persistAppSession = (pendingSave = false): SessionWriteResult => {
  if (isClient) return 'failed';
  const active = activeFileId ? project.get(activeFileId) : undefined;
  const persisted = session.getPersistedState();
  return writeAppSessionState({
    documentName: projectName(),
    ...projectState.sessionFields(),
    content: active?.kind === 'text' ? project.getText(active.id).toString() : '',
    yjs: persisted ? ({ docId: persisted.docId, state: encodeYjsState(persisted.state) } satisfies PersistedYjsState) : undefined,
    activeFileId: activeFileId ?? undefined,
    pendingSave: pendingSave || undefined,
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

// Loads on first use, or with the other dialogs once the page is idle (see preloadDialogs).
const conflictDialog = lazyModule(() =>
  import('./ui/conflictDialog').then(({ createConflictDialog }) => createConflictDialog(document.getElementById('conflict-dialog') as HTMLDialogElement)),
);

/** Hold a file that changed in storage under us, and ask the person which copy to keep. */
function holdConflict(conflict: FileConflict, wording?: Parameters<ReturnType<typeof createConflictDialog>['ask']>[2]) {
  if (conflicts.has(conflict.id)) return;
  conflicts.set(conflict.id, conflict);
  // The file stays held until there's an answer, so if the dialog can't load yet, ask again once it can.
  const ask = (): void =>
    void conflictDialog.get().then(
      (dialog) => dialog.ask(conflict.path, projectState.activeProvider.label, wording).then((choice) => resolveConflict(conflict, choice)),
      // One retry per file: the feature name is also the retry's key.
      (error: unknown) => lazyLoadFailed(`The conflict dialog for ${conflict.path}`, error, ask),
    );
  ask();
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
      const { keepMineAsCopy, takeTheirs } = await import('./storage/conflictResolution');
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
  // The info button in the preview bar lists what the preview changed for LaTeX.js.
  onChanges: (changes) => previewChanges.setChanges(changes),
  // With drive.file we can't see files added to the folder from Drive, so point at the fix.
  missingHint: () => (!isClient && projectState.isDrive() ? DRIVE_MISSING_HINT : ''),
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
  onRename: async (path) => {
    const isFolder = project.folderPaths().includes(path);
    const next = await promptDialog({
      title: `Rename ${basename(path)}`,
      message: `Type a new name, or a path with / to move it${isFolder ? ' and everything in it' : ''} into a folder.`,
      label: isFolder ? 'Folder name or path' : 'File name or path',
      initialValue: path,
      confirmLabel: 'Rename',
      validate: (value) => pathProblem(value, (taken) => project.hasPath(taken), path),
      suggest: (value) => suggestFreeName(value, (typed) => typed, (taken) => project.hasPath(taken), path),
    });
    const to = next === null ? null : normalizePath(next);
    if (next !== null && to !== path) {
      const moved = to !== null && dirname(to) !== dirname(path);
      const where = to ? dirname(to) || 'the top of the project' : '';
      runFileOp(
        () => project.movePath(path, next),
        `${moved ? 'Move' : 'Rename'} ${basename(path)}`,
        moved ? `Moved ${basename(path)} to ${where}` : `Renamed ${basename(path)} to ${basename(to ?? next)}`,
      );
    }
    refocusFileTree(normalizePath(next ?? path) ?? path);
  },
  onDelete: async (path) => {
    const isFolder = project.folderPaths().includes(path);
    const ok = await confirmDialog({
      title: `Delete ${basename(path)}?`,
      message: `This removes ${path}${isFolder ? ' and everything in it' : ''} from the project for you and everyone in the room.`,
      confirmLabel: isFolder ? 'Delete folder' : 'Delete file',
      destructive: true,
    });
    if (ok) runFileOp(() => project.removePath(path), `Delete ${basename(path)}`, `Deleted ${basename(path)}`);
    refocusFileTree();
  },
  onSetMain: (entry) => project.setMainFile(entry.id),
  onMove: (path, folder) =>
    runFileOp(() => project.movePath(path, joinPath(folder, basename(path))), `Move ${basename(path)}`, `Moved ${basename(path)} to ${folder || 'the top of the project'}`),
  onUpload: (files, folder) => void uploadFiles(files, folder),
  onCommand: (commandId) => executeCommand(commandId),
});

const fileViewer = createFileViewer(document.getElementById('file-viewer')!, {
  onDownload: (path) => void downloadFile(path),
});

/**
 * A rename or delete redraws the file tree, which drops the button the dialog gave focus back to.
 * Put focus on the renamed row, or the first row, so keyboard users don't land at the top of the page.
 */
function refocusFileTree(path?: string) {
  // The tree redraws in a microtask after the change, so look once that's done.
  setTimeout(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const pane = document.getElementById('file-pane');
    const row = path ? pane?.querySelector<HTMLElement>(`li[data-path="${CSS.escape(path)}"] .file-row-main`) : null;
    (row ?? pane?.querySelector<HTMLElement>('.file-row-main'))?.focus();
  }, 0);
}

/**
 * Run a file tree change and show its error, like a name that's taken. With a label it's one step in
 * the file history, like "Delete chapter.tex". With a notice too, the notice gets an Undo button.
 */
function runFileOp(op: () => void, label?: string, done?: string) {
  try {
    if (!label) {
      op();
      return;
    }
    const before = fileHistory.latest();
    fileHistory.record(label, op);
    setUndoContext('files');
    const step = fileHistory.latest();
    if (done && step && step !== before) showUndoNotice(done, step);
  } catch (error) {
    showNotice(describeError(error), true);
  }
}

/** Say what a file op did, with an Undo button for as long as it's still the latest step. */
function showUndoNotice(message: string, step: object) {
  noticeKind = null;
  notice.show(message, {
    action: {
      label: 'Undo',
      run: () => {
        if (fileHistory.latest() === step) runHistoryStep('undo');
        else showNotice('That change is no longer the last one. Use Edit > Undo from the file tree.');
      },
    },
  });
}

/** Undo or redo a file op, and say what happened, including anything that came back renamed. */
function runHistoryStep(kind: 'undo' | 'redo') {
  const label = kind === 'undo' ? fileHistory.undoLabel() : fileHistory.redoLabel();
  if (!label) return;
  const step = kind === 'undo' ? fileHistory.undo() : fileHistory.redo();
  setUndoContext('files');
  refocusFileTree();
  if (!step) {
    showNotice(`Couldn't ${kind} ${label}: someone else changed those files since.`);
    return;
  }
  const renamed = step.renamed.map(({ from, to }) => `${from} came back as ${basename(to)}, since someone made a new ${basename(from)}.`);
  const kept = step.kept.map((path) => `Kept ${basename(path)} because someone else edited it.`);
  const head = step.changed ? `${kind === 'undo' ? 'Undid' : 'Redid'} ${label}.` : `Couldn't ${kind} ${label}.`;
  showNotice([head, ...kept, ...renamed].join(' '), false, renamed.length + kept.length > 0);
}

function renderFiles() {
  fileTree.render({
    entries: project.entries(),
    folders: project.folderPaths(),
    activeId: activeFileId,
    mainId: project.getMainFileId(),
    progress: fileProgress,
    waiting: isClient && project.isEmpty(),
    viewers: presence.viewers(),
  });
  presence.refresh();
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
  presence.setFile(activeFileId);
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
  boundText = text;
  if (text) editor.setCollabExtensions(undo.extensions(presence.awareness()));
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
  // A new doc is a new project, so the old one's file history and the bytes it kept go.
  fileHistory.destroy();
  fileHistory = makeFileHistory(project);
  fileHistory.subscribe(() => refreshCommands());
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
async function promptForProjectName(): Promise<boolean> {
  if (project.getName()) return true;
  const next = await promptDialog({
    title: 'Name this project',
    message: 'Storage needs a name before the first save.',
    label: 'Project name',
    confirmLabel: 'Save project',
    selectBaseName: false,
    validate: projectNameProblem,
  });
  if (next === null) {
    showNotice('Save canceled: the project needs a name first.');
    return false;
  }
  project.setName(next);
  return true;
}

async function renameProject() {
  const next = await promptDialog({
    title: 'Rename project',
    message: 'Everyone in the room sees the new name, and the next save renames the stored project.',
    label: 'Project name',
    initialValue: project.getName(),
    confirmLabel: 'Rename project',
    selectBaseName: false,
    validate: projectNameProblem,
  });
  if (next === null || next === project.getName()) return;
  // The name lives in the shared doc, and the next save renames the stored project too.
  project.setName(next);
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
        fileHistory.record(`Upload ${name}`, () => project.replaceText(existing.id, text));
        return { name, ok: true, message: 'replaced' };
      }
      fileHistory.record(`Upload ${name}`, () => project.createTextFile(path, text));
      return { name, ok: true, message: 'added' };
    }
    const hash = await blobs.put(bytes);
    const replaced = project.findByPath(path)?.kind === 'binary';
    fileHistory.record(`Upload ${name}`, () => project.putBinaryFile(path, hash, bytes.length));
    return { name, ok: true, message: replaced ? 'replaced' : 'added' };
  } catch (error) {
    return { name, ok: false, message: describeError(error) };
  }
}

let uploadsInFlight = 0;
async function uploadFiles(files: File[], folder: string) {
  const results: Awaited<ReturnType<typeof uploadFile>>[] = [];
  uploadsInFlight += 1;
  try {
    // One undo step for the whole drop.
    await fileHistory.batch(`Upload ${files.length === 1 ? files[0].name : `${files.length} files`}`, async () => {
      for (const file of files) results.push(await uploadFile(file, folder));
    });
    setUndoContext('files');
  } finally {
    uploadsInFlight -= 1;
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length) showNotice(failed.map((result) => `${result.name}: ${result.message}`).join('; '), true);
  else showNotice(`Uploaded ${results.length} file(s)`);
}

const uploadDialog = lazyUploadDialog(document.getElementById('upload-dialog') as HTMLDialogElement, {
  getFolders: () => project.folderPaths(),
  upload: uploadFile,
  fromDrive: {
    state: () => ({ enabled: getCommandState('file.addFromDrive').enabled, note: addFromDriveNote({ isClient, isDrive: projectState.isDrive() }) }),
    run: () => executeCommand('file.addFromDrive'),
  },
}, lazyLoadFailed);

// File > Export. The formats come from the exporter registry in src/export/registry.ts. The dialog,
// the exporters and the Drive upload load on first use, to keep them out of the initial bundle.
const exportDialogModule = lazyModule<ExportDialog>(() =>
  Promise.all([import('./ui/exportDialog'), import('./export/browserServices'), import('./export/destinations')]).then(
    ([{ createExportDialog }, { createBrowserExportServices }, { downloadChoice, driveChoice }]) =>
      createExportDialog(document.getElementById('export-dialog') as HTMLDialogElement, {
        getSource: () => ({ project, blobs, name: projectName(), activePath: (activeFileId && project.get(activeFileId)?.path) || null }),
        services: createBrowserExportServices(),
        destinations: [
          downloadChoice((name, data, type) => localDownload.download(name, data, type)),
          driveChoice({
            api: driveProvider,
            isGuest: () => isClient,
            configured: () => Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID),
            signedIn: () => driveProvider.hasUsableToken(),
            // Not ensureDriveConnected: signing in to export doesn't change where autosave goes or what the pill says.
            signIn: async () => {
              if (driveProvider.hasUsableToken()) return true;
              const ok = await driveProvider.connect();
              if (ok) void driveProvider.loadAccount().then(showDriveAccount);
              return ok;
            },
            projectFolderId: async () => (projectState.isDrive() && projectState.projectId ? driveProvider.projectFolderId(projectState.projectId) : null),
            inDriveProject: () => projectState.isDrive() && Boolean(projectState.projectId),
            projectKey: () => `${projectState.getProviderMode()}:${projectState.projectId ?? ''}`,
            exportsFolderName: () => (project.findByPath('exports') ? 'exports (from Export)' : 'exports'),
            pickFolder: async () => (ensureDrivePickerConfig() ? pickFromDrive('folder') : null),
          }),
        ],
        rememberDestination: { get: () => settings.get('exportDestination'), set: (id) => settings.set('exportDestination', id === 'drive' ? 'drive' : 'download') },
        notify: (message, isError) => showNotice(message, isError),
      }),
  ),
);
const exportDialog = {
  open: (exporterId?: string): void =>
    void exportDialogModule.get().then(
      (dialog) => dialog.open(exporterId),
      (error: unknown) => lazyLoadFailed('Export', error, () => exportDialog.open(exporterId)),
    ),
  // A quick download that couldn't start isn't rerun later: a file arriving out of nowhere would be odd.
  runNow: (exporterId: string) =>
    exportDialogModule.get().then(
      (dialog) => dialog.runNow(exporterId),
      (error: unknown) => (lazyLoadFailed('Export', error), false),
    ),
};

const projectsDialog = lazyProjectsDialog(document.getElementById('projects-dialog') as HTMLDialogElement, {
  onPick: (summary) => {
    if (!isClient) void openStoredProject(localAppProvider, summary.id);
  },
  // The host already OK'd Open to get here, so this doesn't ask again.
  onImportZip: () => commands.importZipFromOpenDialog(),
}, lazyLoadFailed);

// File > New Project's template picker, Save as Template and the profile (#74). They load on first use.
const templates = lazyTemplates({
  settings,
  local: localAppProvider,
  drive: driveProvider,
  blobs,
  getProject: () => project,
  isDriveProject: () => projectState.isDrive(),
  guestCount: () => (isClient || !inRoom ? 0 : peerCount),
  createProject: async (content) => {
    await switchProject(content, projectState.activeProvider, null);
    // A named project gets saved right away, like an imported .zip. Unnamed ones wait for a name.
    if (content.name) autosave.markDirty();
  },
  editTemplate: (provider, id) => openStoredProject(provider, id),
  download: (name, data, type) => localDownload.download(name, data, type),
  notify: (message, isError) => showNotice(message, isError),
  confirmDialog,
  promptDialog,
  locale: navigator.language,
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
      if (isLoadFailure(error)) lazyLoadFailed('Import .zip', error);
      else showNotice(describeError(error), true);
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
    const { openGooglePicker } = await import('./storage/providers/googlePicker');
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

// Every shortcut label and key press reads from this one table.
// Where the browser keeps a key for itself (a normal tab), the built-in fallback is used and shown instead.
// Going fullscreen or opening in an app window gives those keys back, so follow that.
const keyContext = watchKeyContext(() => {
  keymap.refresh();
  menuBar.refreshShortcuts();
  toolbar.refreshShortcuts();
  refreshCommands();
  if (settingsDialog.isOpen()) keybindSettings.refresh();
});
const keymap = createKeymap(shortcuts, detectPlatform, undefined, () => reservedKeys(keyContext?.current()));
const shortcutLabel = (commandId: CommandId) => keymap.labelFor(commandId);

const commands = createCommands({
  isClient,
  keymap,
  projectState,
  themeState,
  layout,
  compile,
  localAppProvider,
  driveProvider,
  blobs,
  exportDialog,
  autosave,
  session,
  editor,
  fileTree,
  projectsDialog,
  uploadDialog,
  templates,
  zipInput,
  shareButtonEl,
  get project() {
    return project;
  },
  get undo() {
    return undoContext === 'files' ? fileUndo : undo;
  },
  get activeFileId() {
    return activeFileId;
  },
  get menuBar() {
    return menuBar;
  },
  get commandPalette() {
    return commandPalette;
  },
  get settingsDialog() {
    return settingsDialog;
  },
  get toolbar() {
    return toolbar;
  },
  // Only the host's own room counts. A guest never replaces the project.
  guestCount: () => (isClient || !inRoom ? 0 : peerCount),
  projectName,
  setStatus,
  showNotice,
  loadFailed: (feature, error) => lazyLoadFailed(feature, error),
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
  confirmDialog,
  promptDialog,
  ensureDrivePickerConfig,
  ensureDriveConnected,
  pickFromDrive,
  showDriveAccount,
  // The command and the Google Picker code load on first use.
  addFilesFromDrive: async () => {
    const { addFilesFromDrive } = await import('./app/driveAddFiles');
    return addFilesFromDrive({
      isClient,
      projectState,
      provider: driveProvider,
      getProject: () => project,
      blobs,
      autosave,
      record: async (op) => {
        const result = await fileHistory.batch('Add from Drive', op);
        setUndoContext('files');
        return result;
      },
      ensureDrivePickerConfig,
      ensureDriveConnected,
      holdConflict: (conflict) => holdConflict(conflict, DRIVE_PICK_CONFLICT),
      pickFiles: async (folderId) => {
        const { pickProjectFiles } = await import('./storage/providers/googlePicker');
        return pickProjectFiles({ accessToken: driveProvider.getAccessToken(), apiKey: driveApiKey!, appId: driveAppId, folderId });
      },
      setStatus,
      showNotice,
    });
  },
  openDocs: (topic) => openExternal(docsUrl(docsBase, topic)),
  openBugForm: () => openExternal(makeBugUrl()),
  openSecurityReport: () => openExternal(SECURITY_REPORT_URL),
  openFeatureForm: () => openExternal(featureRequestUrl()),
  startTour: () => tour.start(),
  openAbout: () => aboutDialog.open(),
});
const { executeCommand, refreshCommands, getCommandState, buildPaletteCommands, listCommands, handleKeydown, setSavingPaused } = commands;

// Saved themes, layout and keybinds go on screen now, and changes from other tabs, imports and resets follow.
bindSettings({
  settings,
  themeState,
  layout,
  keymap,
  isCommand: (id) => id in commands.commandRegistry,
  onApplied: (changed) => {
    if (changed.includes('keybinds')) {
      menuBar.refreshShortcuts();
      toolbar.refreshShortcuts();
    }
    refreshCommands();
    if (settingsDialog.isOpen()) {
      settingsDialog.refresh();
      keybindSettings.refresh();
    }
  },
});

const menuBar = createMenuBar(document.getElementById('menu-bar')!, {
  getCommandState,
  shortcutLabel,
  onCommand: (commandId) => executeCommand(commandId),
});

const commandPalette = lazyCommandPalette(document.getElementById('command-palette')!, {
  onSelect: (commandId) => executeCommand(commandId),
}, lazyLoadFailed);

// Settings and its keybind editor load together on first open (app/lazyUi.ts).
const { settingsDialog, keybindSettings, preload: preloadSettings } = lazySettings(document.getElementById('settings-dialog') as HTMLDialogElement, {
  getState: () => ({
    editorTheme: themeState.editorTheme,
    previewTheme: themeState.previewTheme,
    savingPaused: projectState.savingPaused,
    canChangeSaving: !isClient,
    driveAccount: driveProvider.isSignedIn() ? (driveProvider.accountLabel() ?? '') : null,
    settingsPersistent: settings.isPersistent(),
  }),
  onEditorTheme: (theme) => {
    applyEditorTheme(theme);
    refreshCommands();
  },
  onPreviewTheme: (theme) => {
    applyPreviewTheme(theme);
    refreshCommands();
  },
  onSavingPaused: (paused) => {
    setSavingPaused(paused);
    refreshCommands();
  },
  onClearLocalDocs: () => executeCommand('file.clearLocalDocs'),
  onEditProfile: () => executeCommand('app.editProfile'),
  onOpen: () => keybindSettings.refresh(),
  onExportSettings: () => localDownload.download(settingsFileName(), settings.exportJson(), 'application/json'),
  onImportSettings: (file) => importSettingsFile(settings, file),
  onResetSettings: (scope) => resetSettings(settings, scope),
}, document.getElementById('settings-keybinds')!, {
  keymap,
  contextLabel: () => describeKeyContext(keyContext.current()),
  commands: listCommands,
  editorKeybinds: editorKeybinds(detectPlatform()),
  onChange: (next) => {
    settings.set('keybinds', next);
    // A changed keybind shows up everywhere right away.
    menuBar.refreshShortcuts();
    toolbar.refreshShortcuts();
    refreshCommands();
  },
}, lazyLoadFailed);

const toolbar = createToolbar(document.getElementById('toolbar')!, {
  getCommandState,
  shortcutLabel,
  onCommand: (commandId) => executeCommand(commandId),
});

const changelogDialog = createChangelogDialog(document.getElementById('changelog-dialog') as HTMLDialogElement, {
  version: BUILD_INFO.version,
  // The build copies CHANGELOG.md next to index.html, so the update prompt can show the new deploy's.
  updateUrl: `${import.meta.env.BASE_URL}CHANGELOG.md`,
});
const openChangelog = () => void changelogDialog.open();
const aboutDialog = lazyAboutDialog(document.getElementById('about-dialog') as HTMLDialogElement, BUILD_INFO, { onViewChangelog: openChangelog }, lazyLoadFailed);
renderFooterVersion(document.getElementById('footer-version') as HTMLAnchorElement, BUILD_INFO);

const tour = lazyTour(document.getElementById('tour')!, document.getElementById('tour-steps')!, {
  shortcutLabel,
  // With storage blocked, count the tour as seen so it doesn't pop up on every visit.
  seen: { has: () => settings.get('tourSeen') || !settings.isPersistent(), mark: () => settings.set('tourSeen', true) },
}, lazyLoadFailed);

// The palette, Settings, About and the Open and Upload dialogs load on first use. Fetch them once the page
// is idle, or as soon as the pointer or focus reaches the menus or toolbar, so they open at once.
const preloadDialogs = () => {
  commandPalette.preload();
  preloadSettings();
  projectsDialog.preload();
  uploadDialog.preload();
  tour.preload();
  aboutDialog.preload();
  conflictDialog.preload();
  templates.preload();
};
preloadOnIntent(document.getElementById('menu-bar'), preloadDialogs);
preloadOnIntent(document.getElementById('toolbar'), preloadDialogs);
whenIdle(preloadDialogs);

// The empty states have their own buttons for the next step, like New file.
document.querySelectorAll<HTMLButtonElement>('#editor-empty [data-command], #preview-empty [data-command]').forEach((button) => {
  button.addEventListener('click', () => executeCommand(button.dataset.command as CommandId));
});

commandPalette.setCommands(buildPaletteCommands());

window.addEventListener('keydown', handleKeydown);
// Undo follows focus, like VS Code: the file tree has its own history, the editor has the text's.
document.getElementById('file-pane')!.addEventListener('focusin', () => setUndoContext('files'));
editorPane.addEventListener('focusin', () => setUndoContext('text'));

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
      // The tab closed before the last edits were saved, so save them now.
      if (restored?.pendingSave && project.getName()) autosave.markDirty();
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
const hostRoomId = isClient || !p2pAvailable ? null : readHostRoomId();
/** Say why this window can't share or join, and in the desktop app offer the browser instead. */
function explainP2pUnavailable(action: P2pAction) {
  const desktop = isDesktopShell();
  const appUrl = desktop ? webAppUrl(docsBase) : null;
  const link = appUrl && (action === 'join' && roomId ? webRoomLink(appUrl, roomId) : appUrl);
  void explainNoWebRtc({
    action,
    desktop,
    link,
    confirm: confirmDialog,
    notice: noticeDialog,
    openExternal: (url) => openInSystemBrowser(url),
    copyText: (value) => navigator.clipboard.writeText(value),
    notify: (message) => showNotice(message, true, true),
  });
}
if (!p2pAvailable) {
  inRoom = false;
  if (roomId) {
    // The Files panel would say "Waiting for the host" forever, so say why instead.
    const waiting = document.getElementById('file-tree-waiting');
    const heading = waiting?.querySelector('h3');
    const text = waiting?.querySelector('p');
    if (heading) heading.textContent = noWebRtcTitle('join');
    if (text) text.textContent = noWebRtcAdvice('join', isDesktopShell(), Boolean(webAppUrl(docsBase)));
    explainP2pUnavailable('join');
  }
} else {
  if (roomId) session.join(roomId);
  else if (hostRoomId) session.join(hostRoomId);
  inRoom = Boolean(roomId || hostRoomId);
}
if (inRoom) startPresence();
// Tell peers we're gone, so our cursor doesn't linger until they time us out.
window.addEventListener('pagehide', () => presence.stop());
// A page restored from the back-forward cache is still in the room, so share presence again.
window.addEventListener('pageshow', (event) => {
  if (event.persisted && inRoom) startPresence();
});
renderConnection();
layout.installSplitter();
layout.applyLayoutMode();
hideLoading();
scheduleCompile();

// The P2P code loads on the first join, so fetch it as the pointer or focus reaches Share.
if (p2pAvailable) preloadOnIntent(shareButtonEl, () => void session.preloadTransport());
setupShareButton({
  button: shareButtonEl,
  linkEl: shareLinkEl,
  getRoomId: () => {
    const id = session.ensureRoom();
    if (!isClient) writeHostRoomId(id);
    inRoom = true;
    startPresence();
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
  confirmNewLink: () =>
    confirmDialog({
      title: 'Start a new link?',
      message: 'Anyone using the old link will be disconnected, and the new link replaces it.',
      confirmLabel: 'Start new link',
      cancelLabel: 'Keep current link',
      destructive: true,
    }),
  unavailable: p2pAvailable ? undefined : () => explainP2pUnavailable('share'),
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

let reloadingForUpdate = false;
// Write the session right away, then only warn for work that write can't keep (see app/leaveGuard.ts).
window.addEventListener('beforeunload', (event) => {
  const unsavedEdits = autosave.hasUnsavedChanges();
  const sessionWrite = persistAppSession(unsavedEdits);
  const confirm = shouldConfirmLeave({
    reloadingForUpdate,
    unsavedEdits,
    savingPaused: autosave.isPaused(),
    provider: projectState.isDrive() ? 'drive' : 'local',
    sessionWrite,
    saveFailed: autosave.lastSaveError() !== null,
    heldConflicts: conflicts.size,
    filesInFlight: fileProgress.size + uploadsInFlight,
  });
  if (confirm) {
    event.preventDefault();
    event.returnValue = '';
  }
});

// Offer to reload when a new build is deployed, or a peer runs a newer protocol (app/updateFlow.ts).
updateFlow = setupUpdateFlow({
  root: document.getElementById('update-prompt') as HTMLElement,
  current: BUILD_INFO,
  poll: import.meta.env.PROD,
  baseUrl: document.baseURI,
  room: () => ({ isHost: !isClient, inRoom }),
  openChangelog: () => void changelogDialog.open('update'),
  flush: () =>
    flushBeforeReload({
      isClient,
      persist: () => persistAppSession(),
      autosave,
      blocker: () =>
        conflicts.size ? `${conflicts.size} file(s) are waiting for you to pick a version.` : fileProgress.size + uploadsInFlight ? 'Files are still uploading or arriving.' : null,
    }),
  beforeReload: () => {
    reloadingForUpdate = true;
  },
  reload: () => location.reload(),
  showNotice: (message) => showNotice(message),
});
// The update prompt's What's new needs the changelog renderer, and after a deploy its old chunk is
// gone from the server, so fetch it (about 4 kB) once the tab is idle. Dev has no deploys.
if (import.meta.env.PROD) whenIdle(() => void changelogDialog.preload());
