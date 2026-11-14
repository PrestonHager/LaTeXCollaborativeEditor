import type { ProjectDiagnostic } from '../compile/projectSource';
import { returnFocusOnClose } from './focusReturn';
import { formatBytes } from './formatBytes';
import './compilePdfDialog.css';

/**
 * The Compile PDF dialogs (issue #242), in a lazy chunk with the rest of Compile PDF.
 * - The run dialog (dialog-md): asks before the first download, with its size, then shows
 *   progress while downloading and compiling, and the TeX errors when there's no PDF.
 * - The PDF view (dialog-lg): the compiled PDF's pages, drawn by pdf.js, with Download.
 */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}

function button(label: string, variant?: string): HTMLButtonElement {
  const b = el('button', { type: 'button', className: 'btn', textContent: label });
  if (variant) b.dataset.variant = variant;
  return b;
}

let nextId = 0;

/** A Basecoat <dialog> with a title, a body and a footer, removed from the page once it closes. */
function dialogShell(size: 'dialog-md' | 'dialog-lg', className: string, title: string) {
  const id = `compile-pdf-${(nextId += 1)}`;
  const dialog = el('dialog', { className: `dialog ${size} ${className}` });
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  const heading = el('h2', { id: `${id}-title`, textContent: title });
  const header = el('header');
  header.append(heading);
  const body = el('section');
  const footer = el('footer');
  const box = el('div');
  box.append(header, body, footer);
  dialog.append(box);
  const focusReturn = returnFocusOnClose(dialog);
  let onClose: (() => void) | null = null;
  const close = () => {
    if (!dialog.isConnected) return;
    // NOTE: jsdom has no dialog methods, so fall back to the open attribute there.
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else {
      dialog.removeAttribute('open');
      dialog.dispatchEvent(new Event('close'));
    }
  };
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  document.body.append(dialog);
  focusReturn.remember();
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  return {
    dialog,
    heading,
    body,
    footer,
    close,
    onClose(callback: () => void) {
      onClose = callback;
    },
  };
}

export type DiagnosticClick = (diagnostic: ProjectDiagnostic) => void;

/** A list of diagnostics, each a button that goes to its file and line. */
export function diagnosticList(diagnostics: ProjectDiagnostic[], onPick: DiagnosticClick, limit = 50): HTMLElement {
  const list = el('ul', { className: 'compile-pdf-diagnostics' });
  for (const diagnostic of diagnostics.slice(0, limit)) {
    const item = el('li');
    item.dataset.severity = diagnostic.severity;
    const pick = el('button', { type: 'button', className: 'compile-pdf-diagnostic' });
    pick.append(el('span', { className: 'compile-pdf-where', textContent: `${diagnostic.path}:${diagnostic.line}` }), el('span', { textContent: diagnostic.message }));
    pick.addEventListener('click', () => onPick(diagnostic));
    item.append(pick);
    list.append(item);
  }
  if (diagnostics.length > limit) list.append(el('li', { className: 'muted', textContent: `And ${diagnostics.length - limit} more.` }));
  return list;
}

export type RunDialog = ReturnType<typeof openCompilePdfDialog>;

/** The run dialog. It opens on "Checking the TeX engine" and moves through each step. */
export function openCompilePdfDialog(title = 'Compile PDF') {
  const shell = dialogShell('dialog-md', 'compile-pdf-dialog', title);
  const message = el('p', { className: 'compile-pdf-message' });
  const progress = el('progress', { className: 'compile-pdf-progress', max: 1 });
  const status = el('p', { className: 'muted compile-pdf-status' });
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  shell.body.append(message, progress, status);
  const cancel = button('Cancel', 'outline');
  shell.footer.append(cancel);
  let closed = false;
  let cancelHandler: (() => void) | null = null;
  shell.onClose(() => {
    closed = true;
    cancelHandler?.();
  });
  cancel.addEventListener('click', () => shell.close());
  cancel.focus();

  const setFooter = (...buttons: HTMLButtonElement[]) => {
    shell.footer.replaceChildren(...buttons);
    buttons.at(-1)?.focus();
  };

  return {
    dialog: shell.dialog,
    get closed() {
      return closed;
    },
    /** Called once if the person closes the dialog before it's done. */
    onCancel(callback: () => void) {
      cancelHandler = callback;
    },
    /** Show a step, with progress from 0 to 1, or a moving bar when it's unknown. */
    progress(text: string, fraction?: number) {
      message.textContent = '';
      message.hidden = true;
      progress.hidden = false;
      if (fraction === undefined) progress.removeAttribute('value');
      else progress.value = Math.min(1, Math.max(0, fraction));
      status.textContent = text;
    },
    /** Ask before the first download. Resolves true for Download, false when closed. */
    askDownload(options: { bytes: number; engineLabel: string; memoryNote?: string }): Promise<boolean> {
      shell.heading.textContent = 'Download the TeX engine?';
      message.hidden = false;
      progress.hidden = true;
      status.textContent = '';
      const lines = [
        `Compile PDF runs ${options.engineLabel} in this browser. The first time, it downloads the engine and its packages from this site: ${formatBytes(options.bytes)}.`,
        'They stay in this browser for next time, and you can remove them in Settings. Your document never leaves the browser.',
      ];
      if (options.memoryNote) lines.push(options.memoryNote);
      message.replaceChildren(...lines.map((text) => el('p', { textContent: text })));
      return new Promise((resolve) => {
        const no = button('Cancel', 'outline');
        const yes = button(`Download ${formatBytes(options.bytes)}`);
        no.addEventListener('click', () => {
          resolve(false);
          shell.close();
        });
        yes.addEventListener('click', () => {
          shell.heading.textContent = title;
          setFooter(cancel);
          resolve(true);
        });
        shell.onClose(() => {
          closed = true;
          resolve(false);
          cancelHandler?.();
        });
        setFooter(no, yes);
      });
    },
    /** Say why it couldn't compile, with the TeX errors when there are any. */
    fail(heading: string, text: string, diagnostics: ProjectDiagnostic[] = [], onPick?: DiagnosticClick) {
      shell.heading.textContent = heading;
      progress.hidden = true;
      status.textContent = '';
      status.hidden = true;
      message.hidden = false;
      message.replaceChildren(el('p', { textContent: text }));
      if (diagnostics.length && onPick) {
        message.append(
          diagnosticList(diagnostics, (diagnostic) => {
            shell.close();
            onPick(diagnostic);
          }),
        );
      }
      const close = button('Close');
      close.addEventListener('click', () => shell.close());
      setFooter(close);
    },
    close: () => shell.close(),
  };
}

export type PdfPage = { url: string; width: number; height: number };
export type DrawPages = (onPage: (page: PdfPage, index: number, count: number) => void, isCurrent: () => boolean) => Promise<number>;

/**
 * The PDF view: every page of the compiled PDF as an image, a summary of the TeX notes, and
 * Download. The pages are drawn by pdf.js (compile/pdfRender.ts), one at a time.
 */
export function openPdfView(options: {
  title: string;
  drawPages: DrawPages;
  onDownload: () => void;
  diagnostics: ProjectDiagnostic[];
  onPickDiagnostic: DiagnosticClick;
}) {
  const shell = dialogShell('dialog-lg', 'compiled-pdf-dialog', options.title);
  const notes = el('details', { className: 'compiled-pdf-notes' });
  const errors = options.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = options.diagnostics.filter((d) => d.severity === 'warning').length;
  if (options.diagnostics.length) {
    notes.append(
      el('summary', { textContent: `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'} from TeX` }),
      diagnosticList(options.diagnostics, (diagnostic) => {
        shell.close();
        options.onPickDiagnostic(diagnostic);
      }),
    );
    shell.body.append(notes);
  }
  const pages = el('div', { className: 'compiled-pdf-pages' });
  pages.setAttribute('aria-label', 'Pages');
  const status = el('p', { className: 'muted', textContent: 'Drawing the pages…' });
  status.setAttribute('role', 'status');
  shell.body.append(status, pages);
  const download = button('Download PDF', 'outline');
  const close = button('Close');
  download.addEventListener('click', options.onDownload);
  close.addEventListener('click', () => shell.close());
  shell.footer.append(download, close);
  close.focus();
  let open = true;
  shell.onClose(() => {
    open = false;
  });
  const done = options
    .drawPages(
      (page, index, count) => {
        const img = el('img', { className: 'compiled-pdf-page', src: page.url, alt: `Page ${index + 1} of ${count}` });
        img.style.aspectRatio = `${page.width} / ${page.height}`;
        pages.append(img);
        status.textContent = index + 1 < count ? `Drawing page ${index + 2} of ${count}…` : `${count} page${count === 1 ? '' : 's'}`;
      },
      () => open,
    )
    .catch((error: unknown) => {
      status.textContent = `Couldn't draw the PDF: ${error instanceof Error ? error.message : String(error)}. Download it to open it elsewhere.`;
      return 0;
    });
  return { dialog: shell.dialog, close: () => shell.close(), done };
}
