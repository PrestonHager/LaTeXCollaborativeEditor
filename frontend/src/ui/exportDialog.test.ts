import { mountAppShell } from '../test/appShell';
import { createExportDialog, resultMessage } from './exportDialog';
import type { ExportRun, ExportSource, Exporter } from '../export/types';

const source = { name: 'Paper' } as ExportSource;

function fakeExporter(overrides: Partial<Exporter> = {}): Exporter {
  return {
    id: 'one',
    label: 'One',
    description: 'The first format.',
    icon: 'file-archive',
    fileExtension: '.one',
    available: () => ({ ok: true }),
    options: () => [],
    run: vi.fn(async () => ({ files: [{ name: 'Paper.one', data: new Blob(['1']) }], warnings: [] })),
    ...overrides,
  };
}

function mount(exporters: Exporter[]) {
  mountAppShell();
  const dialog = document.getElementById('export-dialog') as HTMLDialogElement;
  const save = vi.fn();
  const notify = vi.fn();
  const services = { compile: vi.fn(), fetch: vi.fn(), print: vi.fn() };
  const ui = createExportDialog(dialog, { getSource: () => source, services, destination: { id: 'download', label: 'Download', save }, notify, exporters });
  const $ = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  return { dialog, ui, save, notify, $ };
}

describe('export dialog', () => {
  it('lists formats from the registry with their state, and picks one that can run', () => {
    const { dialog, ui, $ } = mount([
      fakeExporter({ id: 'off', label: 'Off', available: () => ({ ok: false, reason: 'Needs a main file.' }) }),
      fakeExporter({ id: 'warn', label: 'Warn', quality: 'preview', available: () => ({ ok: true, warning: '1 file is still syncing.' }) }),
    ]);
    ui.open();
    expect(ui.isOpen()).toBe(true);
    const rows = Array.from(dialog.querySelectorAll<HTMLElement>('.export-format'));
    expect(rows.map((row) => row.dataset.exporter)).toEqual(['off', 'warn']);
    expect(rows[0].querySelector('input')!.disabled).toBe(true);
    expect(rows[0].textContent).toContain('Needs a main file.');
    expect(rows[1].querySelector<HTMLInputElement>('input')!.checked).toBe(true);
    expect(rows[1].textContent).toContain('Preview quality');
    expect(rows[1].textContent).toContain('1 file is still syncing.');
    expect(rows[1].querySelector('svg')).not.toBeNull();
    expect($<HTMLButtonElement>('#export-run').disabled).toBe(false);
    expect($('#export-options').hidden).toBe(true);
  });

  it('builds option controls and passes their values to the exporter', async () => {
    const exporter = fakeExporter({
      options: () => [
        { id: 'offline', kind: 'checkbox', label: 'Work offline', description: 'Bigger file.', default: true },
        { id: 'paper', kind: 'select', label: 'Paper', choices: [{ value: 'A4', label: 'A4' }, { value: 'letter', label: 'Letter' }], default: 'A4' },
      ],
    });
    const { ui, save, notify, $, dialog } = mount([fakeExporter({ id: 'zip' }), exporter]);
    ui.open('one');
    expect($('#export-options').textContent).toContain('Bigger file.');
    $<HTMLInputElement>('#export-option-offline').checked = false;
    $<HTMLSelectElement>('#export-option-paper').value = 'letter';
    $<HTMLButtonElement>('#export-run').click();
    expect(dialog.classList.contains('is-running')).toBe(true);
    expect($<HTMLButtonElement>('#export-run').disabled).toBe(true);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('Downloaded Paper.one', false));
    expect(exporter.run).toHaveBeenCalledWith(source, { offline: false, paper: 'letter' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Paper.one' }));
    await vi.waitFor(() => expect(ui.isOpen()).toBe(false));
  });

  it('switches formats with the radio buttons', () => {
    const second = fakeExporter({ id: 'two', label: 'Two', options: () => [{ id: 'x', kind: 'checkbox', label: 'X option', default: false }] });
    const { ui, dialog, $ } = mount([fakeExporter(), second]);
    ui.open();
    const radio = dialog.querySelector<HTMLInputElement>('input[value="two"]')!;
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    expect($('#export-options').textContent).toContain('X option');
  });

  it('shows progress, and Cancel stops the export and keeps the dialog open', async () => {
    let seen: ExportRun | null = null;
    const exporter = fakeExporter({
      run: (_source, _options, run) =>
        new Promise((_resolve, reject) => {
          seen = run;
          run.onProgress(0.5, 'Halfway');
          run.signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
        }),
    });
    const { ui, $, save } = mount([exporter]);
    ui.open();
    $<HTMLButtonElement>('#export-run').click();
    await vi.waitFor(() => expect(seen).not.toBeNull());
    expect($('#export-progress').hidden).toBe(false);
    expect($<HTMLProgressElement>('#export-progress-bar').value).toBe(0.5);
    expect($('#export-progress-label').textContent).toBe('Halfway');
    expect($('#export-cancel').textContent).toBe('Cancel export');
    expect(ui.isRunning()).toBe(true);

    $<HTMLButtonElement>('#export-cancel').click();
    await vi.waitFor(() => expect($('#export-note').textContent).toBe('Export canceled.'));
    expect(ui.isRunning()).toBe(false);
    expect(ui.isOpen()).toBe(true);
    expect(save).not.toHaveBeenCalled();
    // With nothing running, Cancel closes it.
    $<HTMLButtonElement>('#export-cancel').click();
    expect(ui.isOpen()).toBe(false);
  });

  it('shows an export error in the dialog', async () => {
    const { ui, $, notify } = mount([fakeExporter({ run: async () => Promise.reject(new Error('The document has errors.')) })]);
    ui.open();
    $<HTMLButtonElement>('#export-run').click();
    await vi.waitFor(() => expect($('#export-note').textContent).toContain('The document has errors.'));
    expect($('#export-note').classList.contains('is-error')).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    expect(ui.isOpen()).toBe(true);
  });

  it('runs an exporter with no dialog and reports to the notice line', async () => {
    const failing = fakeExporter({ id: 'bad', run: async () => Promise.reject(new Error('Nope')) });
    const warned = fakeExporter({ id: 'warned', run: async () => ({ files: [{ name: 'a.zip', data: new Blob() }], warnings: ['1 file left out.'] }) });
    const { ui, notify } = mount([fakeExporter(), failing, warned]);
    expect(await ui.runNow('one')).toBe(true);
    expect(notify).toHaveBeenLastCalledWith('Downloaded Paper.one', false);
    expect(await ui.runNow('bad')).toBe(false);
    expect(notify).toHaveBeenLastCalledWith('Nope', true);
    expect(await ui.runNow('warned')).toBe(true);
    expect(notify).toHaveBeenLastCalledWith('Downloaded a.zip. 1 file left out.', true);
    expect(await ui.runNow('missing')).toBe(false);
    expect(ui.isOpen()).toBe(false);
  });

  it('closes with the close button and by clicking outside', () => {
    const { ui, dialog, $ } = mount([fakeExporter()]);
    ui.open();
    $<HTMLButtonElement>('#export-close').click();
    expect(ui.isOpen()).toBe(false);
    ui.open();
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(ui.isOpen()).toBe(false);
  });

  it('words the result notice', () => {
    expect(resultMessage({ files: [], warnings: [], message: 'Opened the print dialog.' })).toEqual({ message: 'Opened the print dialog.', isError: false });
    expect(resultMessage({ files: [], warnings: [] }).message).toBe('Export finished');
  });
});
