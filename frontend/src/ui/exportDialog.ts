import { exportIcons, icon } from './icons';
import { returnFocusOnClose } from './focusReturn';
import { exporters as defaultExporters, findExporter, runExport, type ExportDestination } from '../export/registry';
import { defaultOptions, isAbortError, type ExportOption, type ExportOptionValues, type ExportOutput, type ExportServices, type ExportSource, type Exporter } from '../export/types';
import { describeError } from '../storage/errors';

type ExportDialogOptions = {
  /** The project as it is right now. Read again every time the dialog opens or runs. */
  getSource: () => ExportSource;
  services: ExportServices;
  destination: ExportDestination;
  /** Show the result in the app's notice line. */
  notify: (message: string, isError?: boolean) => void;
  /** The formats to offer. Defaults to the registry. */
  exporters?: readonly Exporter[];
};

/** The notice for a finished export: what was saved and anything it had to leave out. */
export function resultMessage(output: ExportOutput): { message: string; isError: boolean } {
  const saved = output.message ?? (output.files.length ? `Downloaded ${output.files.map((file) => file.name).join(', ')}` : 'Export finished');
  if (!output.warnings.length) return { message: saved, isError: false };
  return { message: `${saved}. ${output.warnings.join(' ')}`, isError: true };
}

/**
 * Wire up the Export dialog in index.html. The format list and each format's options are
 * built from the exporter registry, so a new exporter shows up here without changes.
 */
export function createExportDialog(dialog: HTMLDialogElement, options: ExportDialogOptions) {
  const list = options.exporters ?? defaultExporters;
  const find = <T extends HTMLElement>(selector: string) => {
    const el = dialog.querySelector<T>(selector);
    if (!el) throw new Error(`Export dialog markup is missing ${selector}`);
    return el;
  };
  const formatsEl = find('#export-formats');
  const optionsEl = find('#export-options');
  const noteEl = find('#export-note');
  const progressEl = find('#export-progress');
  const progressBar = find<HTMLProgressElement>('#export-progress-bar');
  const progressLabel = find('#export-progress-label');
  const runButton = find<HTMLButtonElement>('#export-run');
  const cancelButton = find<HTMLButtonElement>('#export-cancel');
  const closeButton = dialog.querySelector<HTMLButtonElement>('#export-close');

  let selectedId = list[0]?.id ?? '';
  let running: AbortController | null = null;
  let source: ExportSource | null = null;

  const isOpen = () => dialog.open || dialog.hasAttribute('open');
  // NOTE: jsdom has no dialog methods, so fall back to the open attribute there.
  const show = () => {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  };
  const hide = () => {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  };

  const setNote = (text: string, isError = false) => {
    noteEl.textContent = text;
    noteEl.hidden = !text;
    noteEl.classList.toggle('is-error', isError);
  };

  const setProgress = (fraction: number | null, label = '') => {
    progressEl.hidden = fraction === null;
    progressBar.value = Math.max(0, Math.min(1, fraction ?? 0));
    progressLabel.textContent = label;
  };

  const setRunning = (controller: AbortController | null) => {
    running = controller;
    dialog.classList.toggle('is-running', Boolean(controller));
    for (const input of Array.from(dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#export-formats input, #export-options input, #export-options select'))) {
      input.disabled = Boolean(controller) || input.dataset.unavailable === 'true';
    }
    runButton.disabled = Boolean(controller) || !selectedAvailable();
    cancelButton.textContent = controller ? 'Cancel export' : 'Cancel';
  };

  const selectedAvailable = () => {
    const exporter = findExporter(selectedId, list);
    return Boolean(exporter && source && exporter.available(source).ok);
  };

  function renderFormats() {
    if (!source) return;
    const current = source;
    formatsEl.replaceChildren(
      ...list.map((exporter) => {
        const availability = exporter.available(current);
        const label = document.createElement('label');
        label.className = 'export-format';
        label.dataset.exporter = exporter.id;
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'export-format';
        radio.value = exporter.id;
        radio.checked = exporter.id === selectedId;
        radio.disabled = !availability.ok;
        radio.dataset.unavailable = String(!availability.ok);
        radio.addEventListener('change', () => select(exporter.id));
        const body = document.createElement('span');
        body.className = 'export-format-body';
        const title = document.createElement('span');
        title.className = 'export-format-title';
        title.textContent = exporter.label;
        if (exporter.quality === 'preview') {
          const badge = document.createElement('span');
          badge.className = 'badge export-format-badge';
          badge.dataset.variant = 'outline';
          badge.textContent = 'Preview quality';
          title.append(' ', badge);
        }
        const description = document.createElement('span');
        description.className = 'export-format-description';
        description.textContent = exporter.description;
        body.append(title, description);
        if (!availability.ok || availability.warning) {
          const status = document.createElement('span');
          status.className = `export-format-status${availability.ok ? '' : ' is-error'}`;
          status.textContent = availability.ok ? availability.warning! : availability.reason;
          body.append(status);
        }
        const glyph = exportIcons[exporter.icon];
        label.append(radio, ...(glyph ? [icon(glyph, 'size-4 export-format-icon')] : []), body);
        return label;
      }),
    );
  }

  function renderOptions() {
    const exporter = findExporter(selectedId, list);
    if (!exporter || !source) {
      optionsEl.replaceChildren();
      return;
    }
    optionsEl.replaceChildren(...exporter.options(source).map(optionControl));
    optionsEl.hidden = !optionsEl.childElementCount;
  }

  function optionControl(option: ExportOption): HTMLElement {
    const id = `export-option-${option.id}`;
    const row = document.createElement('div');
    row.className = 'settings-row export-option';
    if (option.kind === 'checkbox') {
      const label = document.createElement('label');
      label.className = 'label';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'input';
      input.id = id;
      input.name = option.id;
      input.checked = option.default;
      label.append(input, ` ${option.label}`);
      row.append(label);
    } else {
      const label = document.createElement('label');
      label.className = 'label';
      label.htmlFor = id;
      label.textContent = option.label;
      const select = document.createElement('select');
      select.className = 'select';
      select.id = id;
      select.name = option.id;
      for (const choice of option.choices) {
        const item = document.createElement('option');
        item.value = choice.value;
        item.textContent = choice.label;
        select.append(item);
      }
      select.value = option.default;
      row.append(label, select);
    }
    if (option.description) {
      const hint = document.createElement('p');
      hint.className = 'muted export-option-hint';
      hint.textContent = option.description;
      row.append(hint);
    }
    return row;
  }

  /** The option values as set in the dialog. */
  function readOptions(exporter: Exporter): ExportOptionValues {
    const values = defaultOptions(source ? exporter.options(source) : []);
    for (const el of Array.from(optionsEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))) {
      values[el.name] = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value;
    }
    return values;
  }

  function select(id: string) {
    selectedId = id;
    setNote('');
    renderOptions();
    setRunning(null);
  }

  /** Run an exporter and report how it went. Used by the dialog and by File > Download Project .zip. */
  async function execute(exporter: Exporter, values: ExportOptionValues, controller: AbortController, inDialog: boolean): Promise<boolean> {
    const current = options.getSource();
    try {
      const output = await runExport(
        exporter,
        current,
        values,
        {
          signal: controller.signal,
          onProgress: (fraction, label) => {
            if (inDialog) setProgress(fraction, label);
          },
          services: options.services,
        },
        options.destination,
      );
      const { message, isError } = resultMessage(output);
      options.notify(message, isError);
      return true;
    } catch (error) {
      if (isAbortError(error)) {
        if (inDialog) setNote('Export canceled.');
        return false;
      }
      console.error(`Export ${exporter.id} failed`, error);
      if (inDialog) setNote(describeError(error), true);
      else options.notify(describeError(error), true);
      return false;
    }
  }

  runButton.addEventListener('click', () => {
    const exporter = findExporter(selectedId, list);
    if (!exporter || running || !source) return;
    const controller = new AbortController();
    const values = readOptions(exporter);
    setNote('');
    setProgress(0, 'Starting...');
    setRunning(controller);
    void execute(exporter, values, controller, true).then((ok) => {
      if (running !== controller) return;
      setRunning(null);
      setProgress(null);
      if (ok) hide();
    });
  });

  const cancelOrClose = () => {
    if (running) running.abort();
    else hide();
  };
  cancelButton.addEventListener('click', cancelOrClose);
  closeButton?.addEventListener('click', () => {
    running?.abort();
    hide();
  });
  // Escape and any other close stop an export that's still going.
  dialog.addEventListener('close', () => running?.abort());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && !running) hide();
  });
  const focusReturn = returnFocusOnClose(dialog);

  return {
    /** Open the dialog, with a format picked if given. */
    open(exporterId?: string) {
      source = options.getSource();
      if (exporterId && findExporter(exporterId, list)) selectedId = exporterId;
      // Start on a format that can run, if the last one can't any more.
      if (!findExporter(selectedId, list)?.available(source).ok) {
        selectedId = list.find((exporter) => exporter.available(source!).ok)?.id ?? selectedId;
      }
      renderFormats();
      renderOptions();
      setNote('');
      setProgress(null);
      setRunning(null);
      focusReturn.remember();
      show();
    },
    /** Run one exporter with its default options and no dialog, like File > Download Project .zip. */
    async runNow(exporterId: string, values: ExportOptionValues = {}): Promise<boolean> {
      const exporter = findExporter(exporterId, list);
      if (!exporter) return false;
      const defaults = defaultOptions(exporter.options(options.getSource()));
      return execute(exporter, { ...defaults, ...values }, new AbortController(), false);
    },
    isOpen,
    isRunning: () => running !== null,
  };
}

export type ExportDialog = ReturnType<typeof createExportDialog>;
