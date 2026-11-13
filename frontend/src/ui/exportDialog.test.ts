import { mountAppShell } from '../test/appShell';
import { createExportDialog, resultMessage, type DestinationChoice } from './exportDialog';
import type { ExportDestination } from '../export/registry';
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

/** A stand-in for Google Drive: off for print-only formats, and it saves with a link. */
function fakeDrive(overrides: Partial<DestinationChoice> = {}) {
  const save = vi.fn(async (file: { name: string }) => ({ name: file.name, url: `https://drive.example/${file.name}` }));
  const destination: ExportDestination = { id: 'drive', label: 'Google Drive', save, doneMessage: (saved) => `Saved ${saved[0].name} to Drive` };
  const choose = vi.fn(async () => {});
  let folder = 'exports';
  const choice: DestinationChoice = {
    id: 'drive',
    label: 'Google Drive',
    status: (exporter) => (exporter?.printsOnly ? { ok: false, tag: 'not for PDF', reason: 'PDF opens the print dialog.' } : { ok: true, tag: 'sign-in needed', note: 'You sign in when you press Export.' }),
    folder: {
      name: () => folder,
      choose: async () => {
        await choose();
        folder = 'Theses';
      },
    },
    prepare: vi.fn(async () => destination),
    ...overrides,
  };
  return { choice, save, choose };
}

function mount(exporters: Exporter[], options: { drive?: DestinationChoice; remembered?: string } = {}) {
  mountAppShell();
  const dialog = document.getElementById('export-dialog') as HTMLDialogElement;
  const save = vi.fn();
  const notify = vi.fn();
  const services = { compile: vi.fn(), fetch: vi.fn(), print: vi.fn() };
  let remembered = options.remembered ?? 'download';
  const remember = { get: () => remembered, set: vi.fn((id: string) => (remembered = id)) };
  const download: DestinationChoice = { id: 'download', label: 'Download', status: () => ({ ok: true }), prepare: () => ({ id: 'download', label: 'Download', save }) };
  const destinations = options.drive ? [download, options.drive] : [download];
  const ui = createExportDialog(dialog, { getSource: () => source, services, destinations, rememberDestination: remember, notify, exporters });
  const $ = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  return { dialog, ui, save, notify, remember, $ };
}

const pick = (select: HTMLSelectElement, value: string) => {
  select.value = value;
  select.dispatchEvent(new Event('change'));
};

describe('export dialog', () => {
  it('lists formats from the registry in a menu, with the picked one explained, and starts on one that can run', () => {
    const { ui, $ } = mount([
      fakeExporter({ id: 'off', label: 'Off', available: () => ({ ok: false, reason: 'Needs a main file.' }) }),
      fakeExporter({ id: 'warn', label: 'Warn', quality: 'preview', available: () => ({ ok: true, warning: '1 file is still syncing.' }) }),
    ]);
    ui.open();
    expect(ui.isOpen()).toBe(true);
    const format = $<HTMLSelectElement>('#export-format');
    expect(Array.from(format.options).map((item) => [item.value, item.textContent])).toEqual([
      ['off', 'Off (unavailable)'],
      ['warn', 'Warn (preview quality)'],
    ]);
    expect(format.value).toBe('warn');
    const info = $('#export-format-info');
    expect(info.textContent).toContain('Preview quality');
    expect(info.textContent).toContain('1 file is still syncing.');
    expect(info.querySelector('svg')).not.toBeNull();
    expect($<HTMLButtonElement>('#export-run').disabled).toBe(false);
    expect($('#export-options').hidden).toBe(true);
    // A format that can't run can still be picked, so the dialog can say why, but Export is off.
    pick(format, 'off');
    expect(info.textContent).toContain('Needs a main file.');
    expect($<HTMLButtonElement>('#export-run').disabled).toBe(true);
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
    expect($<HTMLSelectElement>('#export-format').disabled).toBe(true);
    expect($<HTMLSelectElement>('#export-destination').disabled).toBe(true);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('Downloaded Paper.one', false));
    expect(exporter.run).toHaveBeenCalledWith(source, { offline: false, paper: 'letter' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Paper.one' }), expect.anything());
    await vi.waitFor(() => expect(ui.isOpen()).toBe(false));
  });

  it('switches formats with the menu', () => {
    const second = fakeExporter({ id: 'two', label: 'Two', options: () => [{ id: 'x', kind: 'checkbox', label: 'X option', default: false }] });
    const { ui, $ } = mount([fakeExporter(), second]);
    ui.open();
    pick($<HTMLSelectElement>('#export-format'), 'two');
    expect($('#export-options').textContent).toContain('X option');
    expect($('#export-format-info').dataset.exporter).toBe('two');
  });

  it('offers Drive next to Download, remembers the pick, and keeps the dialog open with a link after an upload', async () => {
    const { choice, save: driveSave } = fakeDrive();
    const { ui, $, remember, notify, save } = mount([fakeExporter()], { drive: choice });
    ui.open();
    const destination = $<HTMLSelectElement>('#export-destination');
    expect(Array.from(destination.options).map((item) => [item.value, item.textContent, item.disabled])).toEqual([
      ['download', 'Download', false],
      ['drive', 'Google Drive (sign-in needed)', false],
    ]);
    expect(destination.value).toBe('download');
    expect($('#export-destination-info').hidden).toBe(true);

    pick(destination, 'drive');
    expect(remember.set).toHaveBeenCalledWith('drive');
    expect($('#export-destination-note').textContent).toBe('You sign in when you press Export.');
    expect($('#export-folder').hidden).toBe(false);
    expect($('#export-folder-name').textContent).toBe('exports');

    $<HTMLButtonElement>('#export-run').click();
    // Sign-in has to happen inside the click, so prepare runs before anything is awaited.
    expect(choice.prepare).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('Saved Paper.one to Drive', false));
    expect(driveSave).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(ui.isRunning()).toBe(false));
    expect(ui.isOpen()).toBe(true);
    const link = $<HTMLAnchorElement>('#export-note a');
    expect(link.href).toBe('https://drive.example/Paper.one');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noreferrer');
    expect($('#export-cancel').textContent).toBe('Close');

    // Opening again starts on the remembered destination.
    ui.open();
    expect($<HTMLSelectElement>('#export-destination').value).toBe('drive');
  });

  it('turns Drive off for a print-only format and says why, without forgetting the choice', () => {
    const { choice } = fakeDrive();
    const pdf = fakeExporter({ id: 'pdf', label: 'PDF', printsOnly: true });
    const { ui, $, remember } = mount([fakeExporter(), pdf], { drive: choice, remembered: 'drive' });
    ui.open('pdf');
    const destination = $<HTMLSelectElement>('#export-destination');
    expect(destination.value).toBe('download');
    expect(destination.options[1].disabled).toBe(true);
    expect(destination.options[1].textContent).toBe('Google Drive (not for PDF)');
    expect($('#export-destination-note').textContent).toBe('Google Drive: PDF opens the print dialog.');
    expect($<HTMLButtonElement>('#export-run').disabled).toBe(false);
    // Back on a format with a file, Drive is picked again.
    pick($<HTMLSelectElement>('#export-format'), 'one');
    expect(destination.value).toBe('drive');
    expect(remember.set).not.toHaveBeenCalled();
  });

  it('picks a Drive folder and shows it', async () => {
    const { choice, choose } = fakeDrive();
    const { ui, $ } = mount([fakeExporter()], { drive: choice, remembered: 'drive' });
    ui.open();
    $<HTMLButtonElement>('#export-folder-change').click();
    expect($<HTMLButtonElement>('#export-folder-change').disabled).toBe(true);
    await vi.waitFor(() => expect($('#export-folder-name').textContent).toBe('Theses'));
    expect(choose).toHaveBeenCalledTimes(1);
    expect($<HTMLButtonElement>('#export-folder-change').disabled).toBe(false);
  });

  it('shows a folder or sign-in failure in the dialog', async () => {
    const { choice } = fakeDrive({
      folder: { name: () => 'My Drive', choose: async () => Promise.reject(new Error('Sign-in was closed.')) },
      prepare: () => Promise.reject(new Error("Google Drive sign-in didn't finish.")),
    });
    const exporter = fakeExporter();
    const { ui, $, notify } = mount([exporter], { drive: choice, remembered: 'drive' });
    ui.open();
    $<HTMLButtonElement>('#export-folder-change').click();
    await vi.waitFor(() => expect($('#export-note').textContent).toBe('Sign-in was closed.'));
    $<HTMLButtonElement>('#export-run').click();
    await vi.waitFor(() => expect($('#export-note').textContent).toBe("Google Drive sign-in didn't finish."));
    expect($('#export-note').classList.contains('is-error')).toBe(true);
    expect(exporter.run).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(ui.isOpen()).toBe(true);
    expect(ui.isRunning()).toBe(false);
  });

  it('shows a guest why Drive is off', () => {
    const { choice } = fakeDrive({ status: () => ({ ok: false, tag: 'host only', reason: "Guests can't save to the host's Google Drive." }) });
    const { ui, $ } = mount([fakeExporter()], { drive: choice, remembered: 'drive' });
    ui.open();
    const destination = $<HTMLSelectElement>('#export-destination');
    expect(destination.value).toBe('download');
    expect(destination.options[1].textContent).toBe('Google Drive (host only)');
    expect(destination.options[1].disabled).toBe(true);
    expect($('#export-destination-note').textContent).toContain("Guests can't save to the host's Google Drive.");
    expect($('#export-folder').hidden).toBe(true);
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

  it('stops before exporting when Cancel lands while the destination gets ready', async () => {
    let ready: (destination: ExportDestination) => void = () => {};
    const { choice } = fakeDrive({ prepare: () => new Promise((resolve) => (ready = resolve)) });
    const exporter = fakeExporter();
    const { ui, $ } = mount([exporter], { drive: choice, remembered: 'drive' });
    ui.open();
    $<HTMLButtonElement>('#export-run').click();
    $<HTMLButtonElement>('#export-cancel').click();
    ready({ id: 'drive', label: 'Drive', save: vi.fn() });
    await vi.waitFor(() => expect($('#export-note').textContent).toBe('Export canceled.'));
    expect(exporter.run).not.toHaveBeenCalled();
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

  it('runs an exporter with no dialog to Download, whatever the dialog last used, and reports to the notice line', async () => {
    const failing = fakeExporter({ id: 'bad', run: async () => Promise.reject(new Error('Nope')) });
    const warned = fakeExporter({ id: 'warned', run: async () => ({ files: [{ name: 'a.zip', data: new Blob() }], warnings: ['1 file left out.'] }) });
    const { choice } = fakeDrive();
    const { ui, notify, save } = mount([fakeExporter(), failing, warned], { drive: choice, remembered: 'drive' });
    expect(await ui.runNow('one')).toBe(true);
    expect(save).toHaveBeenCalled();
    expect(choice.prepare).not.toHaveBeenCalled();
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
    expect(resultMessage({ files: [{ name: 'a.zip', data: new Blob() }], warnings: [] }).message).toBe('Downloaded a.zip');
    const saved = { files: [], warnings: ['Left out b.png.'], saved: [{ name: 'a.html', url: 'https://x' }] };
    expect(resultMessage(saved, { doneMessage: (files) => `Saved ${files[0].name} to Drive` })).toEqual({ message: 'Saved a.html to Drive. Left out b.png.', isError: true });
  });
});
