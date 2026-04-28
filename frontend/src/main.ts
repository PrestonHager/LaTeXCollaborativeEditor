import './style.css';
import { createEditorPane } from './ui/editor';
import { createPreviewPane } from './ui/preview';
import { createFileMenu } from './ui/fileMenu';
import { SessionController } from './collab/session';
import { LocalDownloadStorage } from './storage/localDownload';
import { GoogleDriveProvider } from './storage/providers/googleDrive';
import { AutosaveController } from './storage/autosave';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');

app.innerHTML = `
  <header class="topbar">
    <h1>Collaborative LaTeX Editor</h1>
    <div id="file-menu"></div>
    <button id="share-btn">Share</button>
    <span id="share-link" class="muted"></span>
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
const shareLinkEl = document.getElementById('share-link')!;
const compileStatusEl = document.getElementById('compile-status')!;
const diagnosticsEl = document.getElementById('diagnostics')!;
const autosaveStatusEl = document.getElementById('autosave-status')!;

const localDownload = new LocalDownloadStorage();
const driveProvider = new GoogleDriveProvider();
const autosave = new AutosaveController({
  provider: driveProvider,
  getContent: () => editor.getText(),
  getFileName: () => 'document.tex',
  onStatus: (status) => {
    autosaveStatusEl.textContent = status;
  },
});

const session = new SessionController({
  signalingUrl: import.meta.env.VITE_SIGNALING_URL ?? 'ws://localhost:8787',
  onConnectionState: (status) => {
    document.getElementById('connection-status')!.textContent = status;
  },
  onRemoteText: (text) => editor.setText(text, false),
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
  autosave.markDirty();
  if (sync) session.broadcastText(text);
});

const roomId = new URLSearchParams(location.search).get('room');
if (roomId) session.join(roomId);

document.getElementById('share-btn')!.addEventListener('click', () => {
  const id = session.ensureRoom();
  const shareUrl = new URL(location.href);
  shareUrl.searchParams.set('room', id);
  shareLinkEl.textContent = shareUrl.toString();
  navigator.clipboard?.writeText(shareUrl.toString()).catch(() => undefined);
});

createFileMenu(document.getElementById('file-menu')!, {
  onDownload: () => localDownload.download('document.tex', editor.getText()),
  onConnectDrive: async () => {
    const ok = await driveProvider.connect();
    if (ok) autosave.enable();
  },
  onSaveNow: async () => {
    await autosave.saveNow();
  },
});
