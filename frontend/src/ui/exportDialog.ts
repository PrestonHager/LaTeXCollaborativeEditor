import { exportIcons, icon } from './icons';
import { returnFocusOnClose } from './focusReturn';
import { exporters as defaultExporters, findExporter, runExport, type ExportDestination, type ExportResult } from '../export/registry';
import { defaultOptions, isAbortError, type ExportOption, type ExportOptionValues, type ExportOutput, type ExportServices, type ExportSource, type Exporter } from '../export/types';
import { describeError } from '../storage/errors';

/**
 * Whether a destination can take the picked format right now. `tag` goes after its name in the
 * menu, like "Google Drive (sign-in needed)". A destination that can't run says why in `reason`.
 */
export type DestinationStatus = { ok: true; tag?: string; note?: string } | { ok: false; tag: string; reason: string };

/** One entry in the Export dialog's "Save to" menu. See export/destinations.ts. */
export type DestinationChoice = {
  id: string;
  label: string;
  status(exporter: Exporter | undefined): DestinationStatus;
  /** The folder it saves into, with a way to pick another. */
  folder?: { name(): string; choose(): Promise<void> };
  /**
   * Get the destination ready. The dialog calls it first thing in the Export click, so a
   * sign-in popup it opens still counts as the click. Throw to stop with a message.
   */
  prepare(): Promise<ExportDestination> | ExportDestination;
};

type ExportDialogOptions = {
  /** The project as it is right now. Read again every time the dialog opens or runs. */
  getSource: () => ExportSource;
  services: ExportServices;
  /** The "Save to" menu, in order. The first one is the fallback and what runNow uses. */
  destinations: DestinationChoice[];
  /** Keep the last destination picked, in settings. */
  rememberDestination?: { get(): string; set(id: string): void };
  /** Show the result in the app's notice line. */
  notify: (message: string, isError?: boolean) => void;
  /** The formats to offer. Defaults to the registry. */
  exporters?: readonly Exporter[];
};

/** The notice for a finished export: what was saved and anything it had to leave out. */
export function resultMessage(output: ExportOutput | ExportResult, destination?: Pick<ExportDestination, 'doneMessage'>): { message: string; isError: boolean } {
  const saved = 'saved' in output ? output.saved : output.files.map((file) => ({ name: file.name }));
  const done =
    output.message ??
    (saved.length ? (destination?.doneMessage?.(saved) ?? `Downloaded ${saved.map((file) => file.name).join(', ')}`) : 'Export finished');
  if (!output.warnings.length) return { message: done, isError: false };
  return { message: `${done}. ${output.warnings.join(' ')}`, isError: true };
}

/**
 * Wire up the Export dialog in index.html. The format menu and each format's options are
 * built from the exporter registry, so a new exporter shows up here without changes.
 */
export function createExportDialog(dialog: HTMLDialogElement, options: ExportDialogOptions) {
  const list = options.exporters ?? defaultExporters;
  const choices = options.destinations;
  const find = <T extends HTMLElement>(selector: string) => {
    const el = dialog.querySelector<T>(selector);
    if (!el) throw new Error(`Export dialog markup is missing ${selector}`);
    return el;
  };
  const formatSelect = find<HTMLSelectElement>('#export-format');
  const formatInfo = find('#export-format-info');
  const destinationSelect = find<HTMLSelectElement>('#export-destination');
  const destinationInfo = find('#export-destination-info');
  const destinationNote = find('#export-destination-note');
  const folderRow = find('#export-folder');
  const folderName = find('#export-folder-name');
  const folderButton = find<HTMLButtonElement>('#export-folder-change');
  const optionsEl = find('#export-options');
  const noteEl = find('#export-note');
  const progressEl = find('#export-progress');
  const progressBar = find<HTMLProgressElement>('#export-progress-bar');
  const progressLabel = find('#export-progress-label');
  const runButton = find<HTMLButtonElement>('#export-run');
  const cancelButton = find<HTMLButtonElement>('#export-cancel');
  const closeButton = dialog.querySelector<HTMLButtonElement>('#export-close');

  let selectedId = list[0]?.id ?? '';
  let destinationId = options.rememberDestination?.get() ?? choices[0]?.id ?? '';
  let running: AbortController | null = null;
  let choosingFolder = false;
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

  const setNote = (content: string | Node[], isError = false) => {
    if (typeof content === 'string') noteEl.textContent = content;
    else noteEl.replaceChildren(...content);
    noteEl.hidden = !noteEl.textContent;
    noteEl.classList.toggle('is-error', isError);
  };

  const setProgress = (fraction: number | null, label = '') => {
    progressEl.hidden = fraction === null;
    progressBar.value = Math.max(0, Math.min(1, fraction ?? 0));
    progressLabel.textContent = label;
  };

  const selectedExporter = () => findExporter(selectedId, list);
  const selectedChoice = () => choices.find((choice) => choice.id === destinationId);
  const statusOf = (choice: DestinationChoice) => choice.status(selectedExporter());

  /** The destination to use: the one picked or remembered if it can take this format, else the first that can. */
  const effectiveChoice = () => {
    const picked = selectedChoice();
    if (picked && statusOf(picked).ok) return picked;
    return choices.find((choice) => statusOf(choice).ok);
  };

  const canRun = () => {
    const exporter = selectedExporter();
    return Boolean(exporter && source && exporter.available(source).ok && effectiveChoice());
  };

  const setRunning = (controller: AbortController | null) => {
    running = controller;
    const busy = Boolean(controller);
    dialog.classList.toggle('is-running', busy);
    formatSelect.disabled = busy;
    destinationSelect.disabled = busy;
    folderButton.disabled = busy || choosingFolder;
    for (const input of Array.from(optionsEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))) input.disabled = busy;
    runButton.disabled = busy || !canRun();
    cancelButton.textContent = busy ? 'Cancel export' : 'Cancel';
  };

  function renderFormats() {
    if (!source) return;
    const current = source;
    formatSelect.replaceChildren(
      ...list.map((exporter) => {
        const item = document.createElement('option');
        item.value = exporter.id;
        // Formats that can't run stay pickable, so the info line below can say why.
        item.textContent = `${exporter.label}${exporter.quality === 'preview' ? ' (preview quality)' : ''}${exporter.available(current).ok ? '' : ' (unavailable)'}`;
        return item;
      }),
    );
    formatSelect.value = selectedId;
  }

  /** The picked format's description, quality badge, and whether it can run. */
  function renderFormatInfo() {
    const exporter = selectedExporter();
    if (!exporter || !source) {
      formatInfo.replaceChildren();
      return;
    }
    const availability = exporter.available(source);
    const body = document.createElement('span');
    body.className = 'export-format-body';
    const description = document.createElement('span');
    description.className = 'export-format-description';
    description.textContent = exporter.description;
    if (exporter.quality === 'preview') {
      const badge = document.createElement('span');
      badge.className = 'badge export-format-badge';
      badge.dataset.variant = 'outline';
      badge.textContent = 'Preview quality';
      description.prepend(badge, ' ');
    }
    body.append(description);
    if (!availability.ok || availability.warning) {
      const status = document.createElement('span');
      status.className = `export-format-status${availability.ok ? '' : ' is-error'}`;
      status.textContent = availability.ok ? availability.warning! : availability.reason;
      body.append(status);
    }
    const glyph = exportIcons[exporter.icon];
    formatInfo.dataset.exporter = exporter.id;
    formatInfo.replaceChildren(...(glyph ? [icon(glyph, 'size-4 export-format-icon')] : []), body);
  }

  /** The "Save to" menu, with each destination's state for the picked format. */
  function renderDestinations() {
    const effective = effectiveChoice();
    destinationSelect.replaceChildren(
      ...choices.map((choice) => {
        const status = statusOf(choice);
        const item = document.createElement('option');
        item.value = choice.id;
        item.textContent = status.tag ? `${choice.label} (${status.tag})` : choice.label;
        item.disabled = !status.ok;
        return item;
      }),
    );
    if (effective) destinationSelect.value = effective.id;

    // Under the menu: the picked one's note and folder, and why any other is off.
    const lines = choices.flatMap((choice) => {
      const status = statusOf(choice);
      if (!status.ok) return [`${choice.label}: ${status.reason}`];
      return choice === effective && status.note ? [status.note] : [];
    });
    destinationNote.textContent = lines.join(' ');
    destinationNote.hidden = !lines.length;
    const folder = effective?.folder;
    folderRow.hidden = !folder;
    if (folder) folderName.textContent = folder.name();
    destinationInfo.hidden = destinationNote.hidden && folderRow.hidden;
  }

  function renderOptions() {
    const exporter = selectedExporter();
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
    renderFormatInfo();
    renderDestinations();
    renderOptions();
    setRunning(null);
  }

  formatSelect.addEventListener('change', () => select(formatSelect.value));
  destinationSelect.addEventListener('change', () => {
    destinationId = destinationSelect.value;
    options.rememberDestination?.set(destinationId);
    setNote('');
    renderDestinations();
    setRunning(null);
  });
  folderButton.addEventListener('click', () => {
    const folder = effectiveChoice()?.folder;
    if (!folder || running || choosingFolder) return;
    choosingFolder = true;
    folderButton.disabled = true;
    void folder
      .choose()
      .catch((error) => setNote(describeError(error), true))
      .finally(() => {
        choosingFolder = false;
        renderDestinations();
        setRunning(running);
      });
  });

  /** "Saved to Drive" with a link to each uploaded file. */
  function savedNote(result: ExportResult, message: string): Node[] {
    const nodes: Node[] = [document.createTextNode(`${message}.`)];
    for (const file of result.saved) {
      if (!file.url) continue;
      const link = document.createElement('a');
      link.href = file.url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = `Open ${file.name}`;
      nodes.push(document.createTextNode(' '), link);
    }
    return nodes;
  }

  /**
   * Run an exporter into a destination and report how it went. Used by the dialog and by
   * File > Download Project .zip. Resolves with the result, or null when it failed or was canceled.
   */
  async function execute(
    exporter: Exporter,
    values: ExportOptionValues,
    controller: AbortController,
    destination: ExportDestination | Promise<ExportDestination>,
    inDialog: boolean,
  ): Promise<ExportResult | null> {
    const report = (error: unknown) => {
      if (isAbortError(error)) {
        if (inDialog) setNote('Export canceled.');
        return null;
      }
      console.error(`Export ${exporter.id} failed`, error);
      if (inDialog) setNote(describeError(error), true);
      else options.notify(describeError(error), true);
      return null;
    };
    let target: ExportDestination;
    try {
      target = await destination;
    } catch (error) {
      return report(error);
    }
    if (controller.signal.aborted) return report(new DOMException('Export canceled', 'AbortError'));
    try {
      const result = await runExport(
        exporter,
        options.getSource(),
        values,
        {
          signal: controller.signal,
          onProgress: (fraction, label) => {
            if (inDialog) setProgress(fraction, label);
          },
          services: options.services,
        },
        target,
      );
      const { message, isError } = resultMessage(result, target);
      options.notify(message, isError);
      if (inDialog && result.saved.some((file) => file.url)) setNote(savedNote(result, message), isError);
      return result;
    } catch (error) {
      return report(error);
    }
  }

  runButton.addEventListener('click', () => {
    const exporter = selectedExporter();
    const choice = effectiveChoice();
    if (!exporter || !choice || running || !source) return;
    // First thing in the click, so a sign-in popup isn't blocked.
    let destination: ExportDestination | Promise<ExportDestination>;
    try {
      destination = choice.prepare();
    } catch (error) {
      destination = Promise.reject(error);
    }
    const controller = new AbortController();
    const values = readOptions(exporter);
    setNote('');
    setProgress(0, 'Starting...');
    setRunning(controller);
    void execute(exporter, values, controller, destination, true).then((result) => {
      if (running !== controller) return;
      setRunning(null);
      setProgress(null);
      if (!result) return;
      // Keep the dialog open when there's a link to show, like the file in Drive.
      if (result.saved.some((file) => file.url)) cancelButton.textContent = 'Close';
      else hide();
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
      destinationId = options.rememberDestination?.get() ?? destinationId;
      renderFormats();
      renderFormatInfo();
      renderDestinations();
      renderOptions();
      setNote('');
      setProgress(null);
      setRunning(null);
      focusReturn.remember();
      show();
    },
    /**
     * Run one exporter with its default options and no dialog, like File > Download Project .zip.
     * It always goes to the first destination (Download), whatever the dialog last used.
     */
    async runNow(exporterId: string, values: ExportOptionValues = {}): Promise<boolean> {
      const exporter = findExporter(exporterId, list);
      const choice = choices[0];
      if (!exporter || !choice) return false;
      const defaults = defaultOptions(exporter.options(options.getSource()));
      return (await execute(exporter, { ...defaults, ...values }, new AbortController(), choice.prepare(), false)) !== null;
    },
    isOpen,
    isRunning: () => running !== null,
  };
}

export type ExportDialog = ReturnType<typeof createExportDialog>;
