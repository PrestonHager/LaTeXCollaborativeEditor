import './style.css';
import { createEditorPane } from './ui/editor';
import { createPreviewPane } from './ui/preview';
import { createFileMenu } from './ui/fileMenu';
import { createSettingsMenu } from './ui/settingsMenu';
import { setupShareButton } from './ui/shareButton';
import { SessionController } from './collab/session';
import { LocalDownloadStorage } from './storage/localDownload';
import { GoogleDriveProvider } from './storage/providers/googleDrive';
import { AutosaveController } from './storage/autosave';
import { LocalAppStorageProvider } from './storage/providers/localAppStorage';
import type { StorageProvider } from './storage/providers/types';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');

app.innerHTML = `
  <header class="topbar">
    <h1 id="doc-title" class="doc-title">Untitled</h1>
    <div id="file-menu"></div>
    <div id="settings-menu"></div>
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

const localDownload = new LocalDownloadStorage();
const localAppProvider = new LocalAppStorageProvider();
const driveProvider = new GoogleDriveProvider();
let activeProvider: StorageProvider = localAppProvider;
let documentName = 'Untitled';
let saveNowEnabled = true;

const toTexName = (name: string) => (name.endsWith('.tex') ? name : `${name}.tex`);

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
void localAppProvider.connect().then(() => autosave.enable());

const session = new SessionController({
  onConnectionState: (status) => {
    document.getElementById('connection-status')!.textContent = status;
  },
  onRemoteText: (text) => editor.setText(text, false),
  getLocalText: () => editor.getText(),
});

const worker = new Worker(new URL('./workers/compileWorker.ts', import.meta.url), { type: 'module' });
worker.onmessage = (event: MessageEvent<{ ok: boolean; pdfDataUrl?: string; error?: string }>) => {
  if (event.data.ok && event.data.pdfDataUrl) {
    preview.setPdf(event.data.pdfDataUrl);
    compileStatusEl.textContent = 'Compiled';
    diagnosticsEl.textContent = 'No diagnostics.';
  } else {
    compileStatusEl.textContent = 'Compile Error';
    diagnosticsEl.textContent = event.data.error ?? 'Unknown compile error';
  }
};

editor.onTextChanged((text, sync = true) => {
  compileStatusEl.textContent = 'Compiling';
  worker.postMessage({ source: text });
  session.updateLocalText(text);
  if (documentName !== 'Untitled') {
    autosave.markDirty();
  }
  if (sync) session.broadcastText(text);
});

const roomId = new URLSearchParams(location.search).get('room');
if (roomId) session.join(roomId);

setupShareButton({
  button: document.getElementById('share-btn') as HTMLButtonElement,
  linkEl: shareLinkEl,
  getRoomId: () => session.ensureRoom(),
  getCurrentUrl: () => location.href,
});

titleEl.addEventListener('click', async () => {
  const next = window.prompt('Rename document:', documentName);
  if (!next || !next.trim() || next.trim() === documentName) return;

  const oldFileName = toTexName(documentName);
  documentName = next.trim();
  titleEl.textContent = documentName;
  await autosave.renameDocument(oldFileName, toTexName(documentName));
});

const fileMenu = createFileMenu(document.getElementById('file-menu')!, {
  onOpenLocal: () => {
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
  },
  onDownload: () => {
    if (!promptForDocumentName()) return;
    localDownload.download(toTexName(documentName), editor.getText());
  },
  onConnectDrive: async () => {
    if (!promptForDocumentName()) return;
    const ok = await driveProvider.connect();
    if (ok) {
      activeProvider = driveProvider;
      autosave.enable();
    }
  },
  onSaveNow: async () => {
    if (!saveNowEnabled) return;
    if (!promptForDocumentName()) return;
    await autosave.saveNow();
  },
});

createSettingsMenu(document.getElementById('settings-menu')!, {
  onToggleSaveNow: (enabled) => {
    saveNowEnabled = enabled;
    fileMenu.setSaveNowEnabled(enabled);
  },
  onClearSavedDocuments: async () => {
    await localAppProvider.clear?.();
    autosaveStatusEl.textContent = 'Local saved docs cleared';
  },
});
