import { CompileScheduler } from '../compile/compileScheduler';
import { LATEX_JS_ASSET_BASE } from '../compile/latexJsAssets';
import type { ExportServices } from './types';

/**
 * Sandbox for the print frame. allow-same-origin lets the app call print() on it, and
 * allow-modals lets the print dialog open. There's no allow-scripts, so nothing in the
 * peer-written document can run, and the exporter strips <script> tags as well.
 */
export const PRINT_FRAME_SANDBOX = 'allow-same-origin allow-modals';

/** How long to wait for fonts before printing anyway. */
const FONT_WAIT_MS = 5000;
/** When the browser never says printing finished, drop the frame after this long. */
const PRINT_FRAME_LIFETIME_MS = 10 * 60 * 1000;

const abortError = () => new DOMException('Export canceled', 'AbortError');

/** Only the LaTeX.js assets the preview already loads may be fetched, so an export never calls anywhere else. */
export function isBundleableAsset(url: string): boolean {
  return url.startsWith(LATEX_JS_ASSET_BASE);
}

/**
 * Print an HTML document from a hidden frame, so the browser's "Save as PDF" can make a PDF.
 * The preview frame itself can't print, since its sandbox has no allow-modals.
 */
export function printHtml(
  html: string,
  signal: AbortSignal,
  root: HTMLElement = document.body,
  // Tests hand in a frame with a fake window, since jsdom can't print.
  createFrame: () => HTMLIFrameElement = () => document.createElement('iframe'),
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const frame = createFrame();
    frame.className = 'export-print-frame';
    frame.title = 'Print preview';
    frame.setAttribute('sandbox', PRINT_FRAME_SANDBOX);
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    const remove = () => frame.remove();
    const onAbort = () => {
      remove();
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    frame.addEventListener(
      'load',
      () => {
        void (async () => {
          const win = frame.contentWindow;
          const fonts = frame.contentDocument?.fonts;
          // Print once the web fonts are in, or the PDF gets fallback fonts.
          if (fonts) await Promise.race([fonts.ready, new Promise((done) => setTimeout(done, FONT_WAIT_MS))]);
          signal.removeEventListener('abort', onAbort);
          if (signal.aborted || !win) {
            remove();
            reject(signal.aborted ? abortError() : new Error("The print frame didn't load."));
            return;
          }
          win.addEventListener('afterprint', () => setTimeout(remove, 0), { once: true });
          setTimeout(remove, PRINT_FRAME_LIFETIME_MS);
          try {
            win.focus();
            win.print();
            resolve();
          } catch (error) {
            remove();
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        })();
      },
      { once: true },
    );
    frame.srcdoc = html;
    root.appendChild(frame);
  });
}

/** The real services: LaTeX.js in a Web Worker, fetch for the CDN assets, and a print frame. */
export function createBrowserExportServices(): ExportServices {
  // Its own scheduler, so an export never cancels the live preview's compile, or the other way round.
  let scheduler: CompileScheduler | null = null;
  return {
    async compile(input, signal) {
      if (signal.aborted) throw abortError();
      scheduler ??= new CompileScheduler();
      const active = scheduler;
      const onAbort = () => active.cancel();
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const result = await active.compile(input);
        if (!result || signal.aborted) throw abortError();
        return result;
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },
    fetch(url, signal) {
      if (!isBundleableAsset(url)) return Promise.reject(new Error(`Export only downloads the preview's own styles, not ${url}.`));
      return fetch(url, { signal, credentials: 'omit' });
    },
    print: (html, signal) => printHtml(html, signal),
  };
}
