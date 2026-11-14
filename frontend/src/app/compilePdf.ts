import { ENGINE_LABELS, resolveEngine } from '../project/texEngine';
import type { ProjectDoc } from '../project/projectDoc';
import type { BlobStore } from '../project/blobStore';
import { basename } from '../project/paths';
import type { ProjectDiagnostic } from '../compile/projectSource';
import { TexCompileError, type TexProgress } from '../compile/pdf/texEngineClient';
import type { CompileFile } from '../compile/pdf/texEngineProtocol';
import { MEMORY_MESSAGE, UNAVAILABLE_MESSAGE } from '../compile/pdf/texEngineHost';
import { parseTexLog, sortDiagnostics } from '../compile/pdf/texLog';
import { compiledSourceKey, setLastCompiledPdf } from '../compile/pdf/lastCompiledPdf';
import { formatBytes } from '../ui/formatBytes';
import { NOT_AVAILABLE_MESSAGE, NOT_AVAILABLE_TITLE } from '../compile/pdf/compilePdfFlag';
import { TexEngineClient as Client } from '../compile/pdf/texEngineClient';
import { openCompilePdfDialog, openPdfView as openView } from '../ui/compilePdfDialog';
import type { DrawPages, RunDialog, openPdfView } from '../ui/compilePdfDialog';

export { NOT_AVAILABLE_MESSAGE, NOT_AVAILABLE_TITLE };

/**
 * Compile PDF (issue #242): run a real TeX engine on the project in a worker and show the PDF.
 * This module and everything it imports is a lazy chunk; the command loads it on first use.
 *
 * Order of checks: the feature flag, the device's memory, a main file, then the engine. The first
 * time, a dialog shows the download size and asks before anything is downloaded.
 */

/** Below this much memory (navigator.deviceMemory, in GB) Compile PDF doesn't start. */
export const MIN_DEVICE_MEMORY_GB = 2;
/** Below this, the first-run dialog warns that it may run out of memory. */
export const LOW_DEVICE_MEMORY_GB = 4;


export type CompilePdfDeps = {
  enabled: boolean;
  getProject(): ProjectDoc;
  blobs: Pick<BlobStore, 'get'>;
  /** navigator.deviceMemory, in GB, where the browser tells it (Chromium only). */
  deviceMemory(): number | undefined;
  createClient(): Client;
  openDialog(): RunDialog;
  openPdfView: typeof openPdfView;
  drawPages(bytes: Uint8Array): DrawPages;
  notice(title: string, message: string): Promise<void> | void;
  /** Show the TeX log's diagnostics in the editor, next to the preview's. */
  setDiagnostics(diagnostics: ProjectDiagnostic[]): void;
  /** Open a file at a line, for a diagnostic someone clicked. */
  openAt(path: string, line: number): void;
  download(bytes: Uint8Array, fileName: string): void;
  setStatus(message: string): void;
};

const STAGE_TEXT = {
  download: 'Downloading the TeX engine',
  load: 'Starting the TeX engine',
  compile: 'Compiling',
} as const;

/** What the progress line says for one update from the worker. */
export function progressText(progress: TexProgress, engineLabel: string): { text: string; fraction?: number } {
  if (progress.stage === 'download' && progress.total) {
    return { text: `${STAGE_TEXT.download}: ${formatBytes(progress.loaded ?? 0)} of ${formatBytes(progress.total)}`, fraction: (progress.loaded ?? 0) / progress.total };
  }
  if (progress.stage === 'compile') return { text: `${STAGE_TEXT.compile} with ${engineLabel}${progress.pass && progress.pass > 1 ? `, pass ${progress.pass}` : ''}` };
  return { text: STAGE_TEXT[progress.stage] };
}

/** The PDF's file name: the main file's name, like `thesis.pdf`. */
export function pdfFileName(mainPath: string): string {
  return `${basename(mainPath).replace(/\.tex$/i, '') || 'document'}.pdf`;
}

export function createCompilePdf(deps: CompilePdfDeps) {
  let client: Client | null = null;
  let running = false;

  /** Every project file, as the engine's filesystem gets it. Binary files a peer hasn't sent yet are left out. */
  async function projectFiles(project: ProjectDoc): Promise<{ files: CompileFile[]; missing: string[] }> {
    const files: CompileFile[] = [];
    const missing: string[] = [];
    for (const entry of project.entries()) {
      if (entry.kind === 'text') files.push({ path: entry.path, data: project.getText(entry.id).toString() });
      else if (entry.kind === 'binary') {
        const bytes = entry.hash ? await deps.blobs.get(entry.hash) : undefined;
        if (bytes) files.push({ path: entry.path, data: bytes });
        else missing.push(entry.path);
      }
    }
    return { files, missing };
  }

  async function run(): Promise<void> {
    if (!deps.enabled) return void (await deps.notice(NOT_AVAILABLE_TITLE, NOT_AVAILABLE_MESSAGE));
    const memory = deps.deviceMemory();
    if (memory !== undefined && memory < MIN_DEVICE_MEMORY_GB) {
      return void (await deps.notice(
        'Not enough memory for Compile PDF',
        `This device has about ${memory} GB of memory, and the TeX engine needs more than that. Compile PDF on a computer, or use the live preview.`,
      ));
    }
    const project = deps.getProject();
    const mainId = project.getMainFileId();
    const main = mainId ? project.get(mainId) : undefined;
    if (!main) return void (await deps.notice('No main file', 'Compile PDF starts from the main file. Pick one in the file tree first.'));
    if (running) return;
    running = true;
    const dialog = deps.openDialog();
    try {
      await compile(project, main.path, dialog, memory);
    } finally {
      running = false;
    }
  }

  async function compile(project: ProjectDoc, mainPath: string, dialog: RunDialog, memory: number | undefined) {
    const { engine } = resolveEngine(project.getEngine(), project.getText(project.findByPath(mainPath)!.id).toString());
    const label = ENGINE_LABELS[engine];
    client ??= deps.createClient();
    let working = true;
    dialog.onCancel(() => {
      // Closing the dialog mid-way stops the work; the next Compile PDF starts a new worker (and uses the cache).
      if (working) client?.terminate();
    });
    try {
      dialog.progress('Checking the TeX engine');
      const size = await client.downloadSize(engine);
      if (dialog.closed) return;
      if (size === null) {
        working = false;
        return dialog.fail(NOT_AVAILABLE_TITLE, UNAVAILABLE_MESSAGE);
      }
      if (size > 0) {
        const memoryNote =
          memory !== undefined && memory < LOW_DEVICE_MEMORY_GB ? `This device has about ${memory} GB of memory, so the compile may run out of memory.` : undefined;
        if (!(await dialog.askDownload({ bytes: size, engineLabel: label, memoryNote }))) return;
      }
      const sourceKey = compiledSourceKey(project, mainPath);
      const { files, missing } = await projectFiles(project);
      const result = await client.compile({ engine, mainPath, files }, (progress) => {
        const { text, fraction } = progressText(progress, label);
        dialog.progress(text, fraction);
      });
      working = false;
      if (dialog.closed) return;
      const projectPaths = new Set(project.entries().map((entry) => entry.path));
      const diagnostics = sortDiagnostics(parseTexLog(result.log, { mainPath, projectPaths }));
      if (missing.length) {
        diagnostics.unshift({ path: mainPath, line: 1, severity: 'warning', message: `Not sent to the engine yet (still coming from a peer): ${missing.join(', ')}` });
      }
      deps.setDiagnostics(diagnostics);
      const pick = (d: ProjectDiagnostic) => deps.openAt(d.path, d.line);
      if (!result.pdf) {
        const errors = diagnostics.filter((d) => d.severity === 'error').length;
        dialog.fail(
          'TeX stopped without a PDF',
          errors ? `${label} found ${errors} error${errors === 1 ? '' : 's'}. Pick one to go to it.` : `${label} didn't make a PDF. The editor shows what the log said.`,
          diagnostics,
          pick,
        );
        return;
      }
      const pdf = result.pdf;
      setLastCompiledPdf({ bytes: pdf, sourceKey, mainPath, engine, madeAt: Date.now() });
      dialog.close();
      const name = pdfFileName(mainPath);
      deps.setStatus(`Compiled ${name} with ${label}`);
      deps.openPdfView({
        title: name,
        drawPages: deps.drawPages(pdf),
        onDownload: () => deps.download(pdf, name),
        diagnostics,
        onPickDiagnostic: pick,
      });
    } catch (error) {
      working = false;
      if (dialog.closed) return;
      if (error instanceof TexCompileError) {
        const heading = error.reason === 'memory' ? 'Out of memory' : error.reason === 'unavailable' ? NOT_AVAILABLE_TITLE : "Couldn't compile the PDF";
        dialog.fail(heading, error.reason === 'memory' ? MEMORY_MESSAGE : error.message);
      } else {
        dialog.fail("Couldn't compile the PDF", error instanceof Error ? error.message : String(error));
      }
    }
  }

  return { run };
}

/** The real dependencies, for main.ts. pdf.js loads only when a PDF is shown. */
export function browserCompilePdfDeps(
  app: Pick<CompilePdfDeps, 'getProject' | 'blobs' | 'notice' | 'setDiagnostics' | 'openAt' | 'download' | 'setStatus'>,
): CompilePdfDeps {
  return {
    ...app,
    enabled: true,
    deviceMemory: () => (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    createClient: () => new Client(),
    openDialog: () => openCompilePdfDialog(),
    openPdfView: openView,
    drawPages: (bytes) => async (onPage, isCurrent) => (await import('../compile/pdfRender')).renderPdfPages(bytes, onPage, isCurrent),
  };
}
