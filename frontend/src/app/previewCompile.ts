import { CompileScheduler, collectImageUrls } from '../compile/compileScheduler';
import { encodeYjsState } from '../state/appSession';
import { textRev } from '../storage/projectSaver';
import type { BlobStore } from '../project/blobStore';
import type { ProjectDoc } from '../project/projectDoc';
import { mimeType } from '../project/paths';
import type { createEditorPane } from '../ui/editor';
import type { createPreviewPane } from '../ui/preview';

export const COMPILE_DEBOUNCE_MS = 500;
export const COMPILE_MIN_INTERVAL_MS = 900;

type PreviewCompileOptions = {
  getProject: () => ProjectDoc;
  getActiveFileId: () => string | null;
  blobs: Pick<BlobStore, 'has' | 'peek'>;
  preview: Pick<ReturnType<typeof createPreviewPane>, 'setLoading' | 'renderHtml'>;
  editor: Pick<ReturnType<typeof createEditorPane>, 'setDiagnostics'>;
  compileStatusEl: HTMLElement;
  diagnosticsEl: HTMLElement;
  // Tests hand in a fake compiler. The app uses the worker one.
  compiler?: Pick<CompileScheduler, 'compile'>;
  /** Called with every diagnostics line, and which docs topic explains it, so the page can show a help link. */
  onDiagnostics?: (text: string, topic: DiagnosticsTopic) => void;
  /** Called with true when there's no main file to show, so the page can say how to pick one. */
  onEmpty?: (empty: boolean) => void;
  onCompiled?: () => void;
  onCompileError?: () => void;
};

export type DiagnosticsTopic = 'diagnostics' | 'previewErrors';

/** Compile the project into the preview, debounced while typing and throttled so it can't run back to back. */
export function createPreviewCompile({
  getProject,
  getActiveFileId,
  blobs,
  preview,
  editor,
  compileStatusEl,
  diagnosticsEl,
  compiler = new CompileScheduler(),
  onDiagnostics,
  onEmpty,
  onCompiled,
  onCompileError,
}: PreviewCompileOptions) {
  let compileTimer: ReturnType<typeof setTimeout> | null = null;
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCompiledKey: string | null = null;
  let lastCompileStartedAt = 0;
  let compileSequence = 0;
  const imageUrls = new Map<string, string>();

  /** A data: URL for an image file, if we have its bytes. Cached by content hash. */
  const imageUrl = (path: string): string | null => {
    const entry = getProject().findByPath(path);
    if (!entry?.hash) return null;
    const cached = imageUrls.get(entry.hash);
    if (cached) return cached;
    const bytes = blobs.peek(entry.hash);
    if (!bytes) return null;
    const url = `data:${mimeType(path)};base64,${encodeYjsState(bytes)}`;
    imageUrls.set(entry.hash, url);
    return url;
  };

  const setDiagnostics = (message: string, topic: DiagnosticsTopic = 'diagnostics') => {
    diagnosticsEl.textContent = message;
    onDiagnostics?.(message, topic);
  };

  const runCompile = async () => {
    const project = getProject();
    const mainId = project.getMainFileId();
    const main = mainId ? project.get(mainId) : undefined;
    onEmpty?.(!main);
    if (!main) {
      compileStatusEl.textContent = project.isEmpty() ? 'Idle' : 'No main file';
      setDiagnostics('');
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
      const activeFileId = getActiveFileId();
      const activePath = activeFileId ? project.get(activeFileId)?.path : undefined;
      editor.setDiagnostics(errors.filter((error) => error.path === activePath));
      lastCompiledKey = key;
      compileStatusEl.textContent = 'Compiled';
      onCompiled?.();
      if (errors.length) {
        const first = errors[0];
        setDiagnostics(`${errors.length} diagnostic(s). ${first.message} (${first.path} line ${first.line})`);
      } else {
        setDiagnostics(missing.length ? `Not found in the project: ${missing.join(', ')}` : '');
      }
    } catch (error) {
      if (seq !== compileSequence) return;
      editor.setDiagnostics([{ line: 1, severity: 'error', message: String(error) }]);
      compileStatusEl.textContent = 'Compile Error';
      setDiagnostics(String(error), 'previewErrors');
      onCompileError?.();
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

  /** Skip the debounce and compile now, even if nothing changed. */
  const compileNow = () => {
    if (compileTimer) {
      clearTimeout(compileTimer);
      compileTimer = null;
    }
    lastCompiledKey = null;
    requestCompile();
  };

  return {
    runCompile,
    scheduleCompile,
    compileNow,
    /** Forget the last compile, so the next one runs even if the sources look the same. */
    invalidate() {
      lastCompiledKey = null;
    },
  };
}

export type PreviewCompile = ReturnType<typeof createPreviewCompile>;
