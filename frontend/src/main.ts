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
import { SessionController } from './collab/session';
import { connectionLabel } from './net/p2pTransport';
import { LocalDownloadStorage } from './storage/localDownload';
import { GoogleDriveProvider, LEGACY_PREFIX } from './storage/providers/googleDrive';
import { AutosaveController } from './storage/autosave';
import { LocalAppStorageProvider } from './storage/providers/localAppStorage';
import type { StorageProvider } from './storage/providers/types';
import { openGooglePicker } from './storage/providers/googlePicker';
import { manifestFromProject, saveProject, textRev, type SavedManifest } from './storage/projectSaver';
import { createCollabUndo } from './collab/undo';
import { CompileScheduler, collectImageUrls } from './compile/compileScheduler';
import {
  createDocumentId,
  readAppSessionState,
  writeAppSessionState,
  encodeYjsState,
  decodeYjsState,
  type PersistedYjsState,
  type ProviderMode,
  type ThemeMode,
} from './state/appSession';
import { readHostRoomId, writeHostRoomId } from './state/hostRoom';
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
const titleEl = document.getElementById('doc-title')!;
const splitRoot = document.getElementById('split-root') as HTMLElement;
const splitter = document.getElementById('splitter') as HTMLElement;
const previewPane = document.getElementById('preview-pane') as HTMLElement;
const appLoadingEl = document.getElementById('app-loading') as HTMLElement;
const appNoticeEl = document.getElementById('app-notice') as HTMLElement;
const activeFileNameEl = document.getElementById('active-file-name') as HTMLElement;
const activeFileMainEl = document.getElementById('active-file-main') as HTMLElement;
const zipInput = document.getElementById('zip-input') as HTMLInputElement;
const roomId = new URLSearchParams(location.search).get('room');
const isClient = Boolean(roomId);
const COMPILE_DEBOUNCE_MS = 500;
const COMPILE_MIN_INTERVAL_MS = 900;

/** MkDocs `serve` default in dev; production uses same-origin `/docs/` unless overridden. */
function documentationBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_DOCS_BASE_URL as string | undefined;
  if (fromEnv?.trim()) {
    const u = fromEnv.trim();
    return u.endsWith('/') ? u : `${u}/`;
  }
  if (import.meta.env.DEV) return 'http://127.0.0.1:8000/';
  return new URL('docs/', globalThis.location.href).href;
}

const localDownload = new LocalDownloadStorage();
const localAppProvider = new LocalAppStorageProvider();
const driveProvider = new GoogleDriveProvider();
const blobs = new BlobStore();
let activeProvider: StorageProvider = localAppProvider;
// The stored project we save to, or null until the first save makes one.
let projectId: string | null = null;
// What the last save wrote, so the next one only sends changes.
let manifest: SavedManifest | null = null;
let activeFileId: string | null = null;
// Only used to match an old single-file Drive link from before projects.
let documentId = createDocumentId();
let saveNowEnabled = true;
let editorTheme: ThemeMode = 'system';
let previewTheme: ThemeMode = 'system';
let layoutMode: 'split' | 'editor-only' | 'preview-only' = 'split';
let splitRatio = 0.5;
let hostStorageText = 'Saved on host local storage';
const fileProgress = new Map<string, number>();
const driveApiKey = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
const driveAppId = import.meta.env.VITE_GOOGLE_APP_ID as string | undefined;
const NOTICE_TIMEOUT_MS = 8000;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

const toTexName = (name: string) => (name.endsWith('.tex') ? name : `${name}.tex`);
const getProviderMode = (): ProviderMode => (activeProvider === driveProvider ? 'drive' : 'local');
// Tell guests where the host is actually saving, instead of always saying local storage.
const currentStorageLabel = () => (activeProvider === driveProvider ? 'Saved on host Google Drive' : 'Saved on host local storage');

/** Show a short message in the header, then clear it after a few seconds unless it's sticky. */
function showNotice(message: string, isError = false, sticky = false) {
  appNoticeEl.textContent = message;
  appNoticeEl.classList.toggle('is-error', isError);
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = null;
  if (sticky) return;
  noticeTimer = setTimeout(() => {
    appNoticeEl.textContent = '';
    noticeTimer = null;
  }, NOTICE_TIMEOUT_MS);
}

const setStatus = (message: string) => {
  autosaveStatusEl.textContent = message;
};

// Catch anything a command forgot to handle, so failures never just vanish into the console.
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled error', event.reason);
  showNotice(describeError(event.reason), true);
});

function resolveDisplayTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyEditorTheme(theme: ThemeMode) {
  editorTheme = theme;
  const display = resolveDisplayTheme(theme);
  // Basecoat switches its own colors on the `dark` class.
  document.documentElement.classList.toggle('dark', display === 'dark');
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-editor-theme');
  } else {
    document.documentElement.setAttribute('data-editor-theme', theme);
  }
  document.documentElement.style.colorScheme = display === 'dark' ? 'dark' : 'light';
  window.dispatchEvent(new CustomEvent('editorthemechange'));
}

function applyPreviewTheme(theme: ThemeMode) {
  previewTheme = theme;
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-preview-theme');
  } else {
    document.documentElement.setAttribute('data-preview-theme', theme);
  }
  window.dispatchEvent(new CustomEvent('previewthemechange'));
}

const applyLayoutMode = () => {
  splitRoot.classList.toggle('is-editor-only', layoutMode === 'editor-only');
  splitRoot.classList.toggle('is-preview-only', layoutMode === 'preview-only');
  splitter.style.display = layoutMode === 'split' ? '' : 'none';
  editorPane.style.display = layoutMode === 'preview-only' ? 'none' : '';
  previewPane.style.display = layoutMode === 'editor-only' ? 'none' : '';
  if (layoutMode === 'split') {
    const left = Math.max(20, Math.min(80, Math.round(splitRatio * 100)));
    splitRoot.style.gridTemplateColumns = `${left}% 8px ${100 - left}%`;
  } else {
    splitRoot.style.gridTemplateColumns = '1fr';
  }
};

const installSplitter = () => {
  let dragging = false;
  const onMove = (event: PointerEvent) => {
    if (!dragging || layoutMode !== 'split') return;
    const bounds = splitRoot.getBoundingClientRect();
    const ratio = (event.clientX - bounds.left) / bounds.width;
    splitRatio = Math.max(0.2, Math.min(0.8, ratio));
    applyLayoutMode();
  };
  const onUp = () => {
    dragging = false;
    document.body.classList.remove('is-resizing');
  };
  splitter.addEventListener('pointerdown', (event) => {
    if (layoutMode !== 'split') return;
    dragging = true;
    document.body.classList.add('is-resizing');
    splitter.setPointerCapture(event.pointerId);
  });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
};

// First, restore the last session, so we know which doc, project and provider to pick up.
const restored = isClient ? null : readAppSessionState();
let driveRestoreMessage: string | null = null;
if (restored) {
  if (restored.documentId) documentId = restored.documentId;
  saveNowEnabled = restored.saveNowEnabled;
  editorTheme = restored.editorTheme;
  previewTheme = restored.previewTheme;
  projectId = restored.projectId ?? null;
  manifest = restored.manifest ?? null;
  activeFileId = restored.activeFileId ?? null;
  if (restored.providerMode === 'drive') {
    // Only reuse Drive when the cached token is still good. Calling connect() here would open
    // a sign-in popup on page load, which browsers block, and saves would silently fail.
    if (driveProvider.hasUsableToken()) {
      activeProvider = driveProvider;
      driveRestoreMessage = 'Drive: Session restored';
      // Sessions from before projects saved to one Drive file, so keep saving there.
      if (!projectId) projectId = driveProvider.legacyProjectId(restored.documentId, toTexName(restored.documentName));
    } else {
      driveRestoreMessage = 'Drive session expired; saving locally. Reconnect Drive from the File menu.';
      projectId = null;
      manifest = null;
    }
  }
}

function restoredDocState() {
  if (!restored?.yjs) return undefined;
  const state = decodeYjsState(restored.yjs.state);
  return state ? { docId: restored.yjs.docId, state } : undefined;
}

applyEditorTheme(editorTheme);
applyPreviewTheme(previewTheme);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (editorTheme === 'system') applyEditorTheme('system');
  if (previewTheme === 'system') applyPreviewTheme('system');
});

const session: SessionController = new SessionController({
  isHost: !isClient,
  blobs,
  onConnectionState: (status, peers) => {
    document.getElementById('connection-status')!.textContent = connectionLabel(status, peers);
  },
  onRemoteMetadata: ({ storage }) => {
    hostStorageText = storage;
    setStatus(storage);
  },
  getLocalMetadata: (): { title: string; storage: string } => ({ title: project.getName() || 'Untitled', storage: currentStorageLabel() }),
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
    documentId,
    content: active?.kind === 'text' ? project.getText(active.id).toString() : '',
    providerMode: getProviderMode(),
    saveNowEnabled,
    editorTheme,
    previewTheme,
    yjs: persisted ? ({ docId: persisted.docId, state: encodeYjsState(persisted.state) } satisfies PersistedYjsState) : undefined,
    projectId: projectId ?? undefined,
    activeFileId: activeFileId ?? undefined,
    manifest: manifest ?? undefined,
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
    const provider = activeProvider;
    const result = await saveProject({
      provider,
      project,
      blobs,
      manifest,
      projectId,
      onStep: (step) => {
        // Keep progress from a save that fails halfway, unless the project changed under us.
        if (provider !== activeProvider) return;
        manifest = step;
        projectId = step.projectId;
      },
    });
    if (provider === activeProvider) {
      manifest = result.manifest;
      projectId = result.manifest.projectId;
      persistAppSession();
    }
    if (result.pending) setTimeout(() => setStatus(`Waiting for ${result.pending} file(s) from peers`), 0);
    return provider.label;
  },
  onStatus: setStatus,
});

// When Drive can't get a new token, switch to local saves so no edits are lost.
driveProvider.onSessionLost(() => {
  if (activeProvider !== driveProvider) return;
  useProvider(localAppProvider, null);
  showNotice('Google Drive sign-in expired, so edits are saving in this browser. Use File > Connect Google Drive to switch back.', true, true);
  void autosave.saveNow();
});

/** Point saves at a provider and project. Pass a manifest when the project was just loaded from it. */
function useProvider(provider: StorageProvider, id: string | null, loaded: SavedManifest | null = null) {
  activeProvider = provider;
  projectId = id;
  manifest = loaded;
  persistAppSession();
  session.broadcastMetadata({ title: projectName(), storage: currentStorageLabel() });
}

let compileTimer: ReturnType<typeof setTimeout> | null = null;
let throttleTimer: ReturnType<typeof setTimeout> | null = null;
let lastCompiledKey: string | null = null;
let lastCompileStartedAt = 0;
let compileSequence = 0;
const compiler = new CompileScheduler();
const imageUrls = new Map<string, string>();

/** A data: URL for an image file, if we have its bytes. Cached by content hash. */
const imageUrl = (path: string): string | null => {
  const entry = project.findByPath(path);
  if (!entry?.hash) return null;
  const cached = imageUrls.get(entry.hash);
  if (cached) return cached;
  const bytes = blobs.peek(entry.hash);
  if (!bytes) return null;
  const url = `data:${mimeType(path)};base64,${encodeYjsState(bytes)}`;
  imageUrls.set(entry.hash, url);
  return url;
};

const runCompile = async () => {
  const mainId = project.getMainFileId();
  const main = mainId ? project.get(mainId) : undefined;
  if (!main) {
    compileStatusEl.textContent = project.isEmpty() ? 'Idle' : 'No main file';
    return;
  }
  const texts = project.textFiles();
  const binaries = project.entries().filter((entry) => entry.kind === 'binary');
  // Skip the compile when nothing it reads has changed.
  const key = [
    main.path,
    ...[...texts].map(([path, text]) => `${path}:${textRev(text)}`),
    ...binaries.map((entry) => `${entry.path}:${entry.hash}:${entry.hash && blobs.has(entry.hash) ? 1 : 0}`),
  ].join('|');
  if (key === lastCompiledKey) {
    compileStatusEl.textContent = 'Compiled';
    return;
  }
  const seq = ++compileSequence;
  lastCompileStartedAt = Date.now();
  compileStatusEl.textContent = 'Compiling';
  preview.setLoading(true);
  try {
    const binaryPaths = binaries.map((entry) => entry.path);
    const result = await compiler.compile({ mainPath: main.path, texts, binaryPaths, imageUrls: collectImageUrls(binaryPaths, imageUrl) });
    if (!result || seq !== compileSequence) return;
    const { html, errors, missing } = result;
    if (html) await preview.renderHtml(html);
    const activePath = activeFileId ? project.get(activeFileId)?.path : undefined;
    editor.setDiagnostics(errors.filter((error) => error.path === activePath));
    lastCompiledKey = key;
    compileStatusEl.textContent = 'Compiled';
    if (errors.length) {
      const first = errors[0];
      diagnosticsEl.textContent = `${errors.length} diagnostic(s). ${first.message} (${first.path} line ${first.line})`;
    } else {
      diagnosticsEl.textContent = missing.length ? `Not found in the project: ${missing.join(', ')}` : '';
    }
  } catch (error) {
    if (seq !== compileSequence) return;
    editor.setDiagnostics([{ line: 1, severity: 'error', message: String(error) }]);
    compileStatusEl.textContent = 'Compile Error';
    diagnosticsEl.textContent = String(error);
  } finally {
    if (seq === compileSequence) preview.setLoading(false);
  }
};

const requestCompile = () => {
  const elapsed = Date.now() - lastCompileStartedAt;
  if (elapsed >= COMPILE_MIN_INTERVAL_MS) {
    void runCompile();
    return;
  }
  if (throttleTimer) clearTimeout(throttleTimer);
  throttleTimer = setTimeout(() => {
    throttleTimer = null;
    void runCompile();
  }, COMPILE_MIN_INTERVAL_MS - elapsed);
};

const scheduleCompile = () => {
  if (compileTimer) clearTimeout(compileTimer);
  compileStatusEl.textContent = 'Waiting';
  compileTimer = setTimeout(() => {
    compileTimer = null;
    requestCompile();
  }, COMPILE_DEBOUNCE_MS);
};

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
  lastCompiledKey = null;
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
  lastCompiledKey = null;
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
    useProvider(provider, id, id ? manifestFromProject(id, project) : null);
  });
  ensureActiveFile();
  renderFiles();
  setStatus(id ? `Opened ${projectName()}` : 'Autosave On');
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
  session.broadcastMetadata({ title: projectName(), storage: currentStorageLabel() });
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
  onPick: (summary) => void openStoredProject(localAppProvider, summary.id),
  onImportZip: () => zipInput.click(),
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
  if (!file) return;
  void (async () => {
    showLoading('Reading .zip...');
    try {
      const content = await projectFromZip(file.name, new Uint8Array(await file.arrayBuffer()), blobs);
      // The project gets made in storage on the first save.
      await switchProject(content, activeProvider === driveProvider && driveProvider.isSignedIn() ? driveProvider : localAppProvider, null);
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
  appNoticeEl.textContent = '';
  setStatus('Drive: Connected');
  return true;
};

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
  if (activeProvider !== driveProvider) useProvider(driveProvider, null);
};

const commandRegistry: Record<CommandId, () => Promise<void> | void> = {
  'app.commandPalette': () => {
    commandPalette.toggle();
  },
  'file.new': async () => {
    if (isClient) return;
    if (!window.confirm('Start a new project? The current one stays saved where it is.')) return;
    await switchProject(starterProject(''), activeProvider, null);
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
      session.broadcastMetadata({ title: projectName(), storage: currentStorageLabel() });
    }
  },
  'file.moveDrive': async () => {
    if (isClient) return;
    if (!ensureDrivePickerConfig()) return;
    if (!(await ensureDriveConnected())) return;
    if (activeProvider !== driveProvider || !projectId) {
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
      await driveProvider.moveProject(projectId, folder.id);
      setStatus(`Drive: Moved to ${folder.name}`);
    } catch (error) {
      console.error('Drive move failed', error);
      setStatus(describeError(error));
    }
  },
  'file.renameDrive': () => renameProject(),
  'file.saveNow': async () => {
    if (isClient || !saveNowEnabled) return;
    if (!promptForProjectName()) return;
    if (activeProvider === driveProvider && !driveProvider.isSignedIn()) {
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
    if (activeProvider === localAppProvider) useProvider(localAppProvider, null);
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
    applyEditorTheme(nextTheme[editorTheme]);
    persistAppSession();
  },
  'view.togglePreviewTheme': () => {
    const nextTheme: Record<ThemeMode, ThemeMode> = { dark: 'light', light: 'system', system: 'dark' };
    applyPreviewTheme(nextTheme[previewTheme]);
    persistAppSession();
  },
  'view.darkMode': () => setAllThemes('dark'),
  'view.lightMode': () => setAllThemes('light'),
  'view.systemTheme': () => setAllThemes('system'),
  'view.toggleSaveNow': () => setSaveNowEnabled(!saveNowEnabled),
  'view.focusEditor': () => editor.focus(),
  'app.openSettings': () => settingsDialog.open(),
  'file.rename': () => renameProject(),
  'share.copyLink': () => shareButtonEl.click(),
  'view.compileNow': () => {
    if (compileTimer) {
      clearTimeout(compileTimer);
      compileTimer = null;
    }
    lastCompiledKey = null;
    requestCompile();
  },
  'view.layoutSplit': () => {
    layoutMode = 'split';
    applyLayoutMode();
    menuBar.refresh();
  },
  'view.layoutEditorOnly': () => {
    layoutMode = 'editor-only';
    applyLayoutMode();
    menuBar.refresh();
  },
  'view.layoutPreviewOnly': () => {
    layoutMode = 'preview-only';
    applyLayoutMode();
    menuBar.refresh();
  },
  'help.documentation': () => {
    window.open(documentationBaseUrl(), '_blank', 'noreferrer');
  },
  'help.about': () => {
    window.open('https://github.com/PrestonHager/LaTeXCollaborativeEditor', '_blank', 'noreferrer');
  },
};

// The palette's "Switch to ... mode" commands set the app, editor, and preview together.
function setAllThemes(theme: ThemeMode) {
  applyEditorTheme(theme);
  applyPreviewTheme(theme);
  persistAppSession();
}

function setSaveNowEnabled(enabled: boolean) {
  if (isClient) return;
  saveNowEnabled = enabled;
  setStatus(saveNowEnabled ? 'Autosave On' : 'Save Now Disabled');
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
      return { enabled: !isClient };
    case 'file.moveDrive':
      return { enabled: !isClient && activeProvider === driveProvider };
    case 'file.newFile':
    case 'file.newFolder':
    case 'file.upload':
      // Guests can add files too, once they have the host's project.
      return { enabled: !(isClient && project.isEmpty()) };
    case 'file.downloadFile':
      return { enabled: Boolean(activeFileId) };
    case 'file.saveNow':
      return { enabled: !isClient && saveNowEnabled };
    case 'edit.undo':
      return { enabled: undo.canUndo() };
    case 'edit.redo':
      return { enabled: undo.canRedo() };
    case 'view.toggleSaveNow':
      return { enabled: !isClient, checked: !saveNowEnabled };
    case 'view.layoutSplit':
      return { enabled: true, checked: layoutMode === 'split' };
    case 'view.layoutEditorOnly':
      return { enabled: true, checked: layoutMode === 'editor-only' };
    case 'view.layoutPreviewOnly':
      return { enabled: true, checked: layoutMode === 'preview-only' };
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
  getState: () => ({ editorTheme, previewTheme, saveNowEnabled, canChangeSaving: !isClient }),
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
  onSaveNowEnabled: (enabled) => {
    setSaveNowEnabled(enabled);
    refreshCommands();
  },
  onClearLocalDocs: () => executeCommand('file.clearLocalDocs'),
});

// Commands that only show in the palette. The theme switches stand in for the menu's toggles.
const themeSwitchCommands: { theme: ThemeMode; id: CommandId; label: string }[] = [
  { theme: 'dark', id: 'view.darkMode', label: 'Switch to dark mode' },
  { theme: 'light', id: 'view.lightMode', label: 'Switch to light mode' },
  { theme: 'system', id: 'view.systemTheme', label: 'Switch to system theme' },
];
const paletteOnlyCommands: { id: CommandId; section: string; label: string }[] = [
  { id: 'share.copyLink', section: 'Share', label: 'Copy share link' },
  { id: 'view.focusEditor', section: 'View', label: 'Focus editor' },
];

/** Build the palette from the menu HTML, plus the palette-only commands above. */
function buildPaletteCommands(): PaletteCommand[] {
  const fromMenus = menuBar
    .entries()
    .filter((entry) => entry.inPalette)
    .map((entry) => ({
      id: entry.commandId,
      section: entry.section,
      // The menu shows a checkmark for this one, but the palette has to say which way it goes.
      label: entry.commandId === 'view.toggleSaveNow' && !saveNowEnabled ? 'Enable Save Now' : entry.label,
      shortcut: entry.shortcut,
      enabled: getCommandState(entry.commandId).enabled,
    }));
  // Skip the theme switch for the theme that's already in use.
  const themes = themeSwitchCommands
    .filter(({ theme }) => !(editorTheme === theme && previewTheme === theme))
    .map(({ id, label }) => ({ id, section: 'View', label, enabled: true }));
  const extras = paletteOnlyCommands.map((command) => ({ ...command, enabled: getCommandState(command.id).enabled }));
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
      if (!projectId && activeProvider === localAppProvider && restored && !restored.projectId && project.getName()) {
        const mainId = project.getMainFileId();
        const mainPath = mainId ? project.get(mainId)?.path : undefined;
        if (mainPath) projectId = await localAppProvider.findLegacyProject(mainPath);
      }
      autosave.enable();
      setStatus(driveRestoreMessage ?? 'Autosave On');
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
installSplitter();
applyLayoutMode();
hideLoading();
scheduleCompile();

setupShareButton({
  button: shareButtonEl,
  linkEl: shareLinkEl,
  getRoomId: () => {
    const id = session.ensureRoom();
    if (!isClient) writeHostRoomId(id);
    return id;
  },
  getCurrentUrl: () => location.href,
  onStatus: (message) => showNotice(message),
  initialRoomId: hostRoomId,
  newLinkButton: isClient ? undefined : (document.getElementById('new-link-btn') as HTMLButtonElement),
  getNewRoomId: () => {
    const id = session.newRoom();
    writeHostRoomId(id);
    return id;
  },
  confirmNewLink: () => window.confirm('Start a new link? Anyone using the old link will be disconnected.'),
});

if (!isClient) titleEl.addEventListener('click', () => void renameProject());

window.addEventListener('beforeunload', (event) => {
  persistAppSession();
  // Warn before closing if the last save hasn't gone through yet.
  if (autosave.hasUnsavedChanges()) {
    event.preventDefault();
    event.returnValue = '';
  }
});
