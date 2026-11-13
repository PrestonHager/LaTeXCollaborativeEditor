import { installDomShim } from './domShim';
import { projectToPreviewHtml } from './latexJsPreview';
import { MAIN_THREAD_COMPILE_KEY, type CompileRequest, type CompileResponse } from './compileProtocol';

declare const WorkerGlobalScope: unknown;

/** Answer compile requests. Only runs inside a worker. */
export function serveCompiles(scope: { onmessage: unknown; postMessage(message: CompileResponse): void }): void {
  // Workers have no DOM, so we bring a small one before LaTeX.js needs it.
  installDomShim();
  scope.onmessage = (event: MessageEvent<CompileRequest>) => {
    const { id, input } = event.data;
    let response: CompileResponse;
    try {
      response = { id, result: projectToPreviewHtml(input) };
    } catch (error) {
      response = { id, error: String(error) };
    }
    scope.postMessage(response);
  };
}

// The main thread also loads this file when it can't use a worker. Vite drops a worker's
// exports, so we hand the compiler over on globalThis instead.
if (typeof WorkerGlobalScope !== 'undefined') serveCompiles(self as unknown as Parameters<typeof serveCompiles>[0]);
else (globalThis as Record<string, unknown>)[MAIN_THREAD_COMPILE_KEY] = projectToPreviewHtml;
