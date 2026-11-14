import { diagnosticList, openCompilePdfDialog, openPdfView } from './compilePdfDialog';

const diag = (severity: 'error' | 'warning' | 'info', line: number) => ({ path: 'main.tex', line, severity, message: `m${line}` });
const buttons = (dialog: HTMLElement) => Array.from(dialog.querySelectorAll('footer button')).map((b) => b.textContent);

describe('Compile PDF dialogs (#242)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('uses dialog-md for the run dialog and dialog-lg for the PDF view', () => {
    const run = openCompilePdfDialog();
    expect(run.dialog.classList.contains('dialog-md')).toBe(true);
    const view = openPdfView({ title: 'main.pdf', drawPages: async () => 0, onDownload: vi.fn(), diagnostics: [], onPickDiagnostic: vi.fn() });
    expect(view.dialog.classList.contains('dialog-lg')).toBe(true);
  });

  it('shows progress, asks before downloading with the size, and goes back to progress', async () => {
    const run = openCompilePdfDialog();
    run.progress('Checking the TeX engine');
    expect(run.dialog.querySelector('progress')!.hasAttribute('value')).toBe(false);
    expect(run.dialog.querySelector('[role="status"]')!.textContent).toBe('Checking the TeX engine');
    const asked = run.askDownload({ bytes: 80_000_000, engineLabel: 'pdfLaTeX', memoryNote: 'Low memory.' });
    expect(run.dialog.querySelector('h2')!.textContent).toBe('Download the TeX engine?');
    expect(run.dialog.textContent).toContain('80.0 MB');
    expect(run.dialog.textContent).toContain('Your document never leaves the browser');
    expect(run.dialog.textContent).toContain('Low memory.');
    expect(buttons(run.dialog)).toEqual(['Cancel', 'Download 80.0 MB']);
    (run.dialog.querySelectorAll('footer button')[1] as HTMLButtonElement).click();
    expect(await asked).toBe(true);
    expect(buttons(run.dialog)).toEqual(['Cancel']);
    run.progress('Downloading', 0.25);
    expect(run.dialog.querySelector('progress')!.value).toBe(0.25);
    expect(run.closed).toBe(false);
    run.close();
    expect(run.closed).toBe(true);
    expect(run.dialog.isConnected).toBe(false);
  });

  it('resolves false when the download is declined or the dialog closed, and calls the cancel hook', async () => {
    const run = openCompilePdfDialog();
    const onCancel = vi.fn();
    run.onCancel(onCancel);
    const asked = run.askDownload({ bytes: 10, engineLabel: 'XeLaTeX' });
    (run.dialog.querySelector('footer button') as HTMLButtonElement).click();
    expect(await asked).toBe(false);
    expect(onCancel).toHaveBeenCalled();

    const other = openCompilePdfDialog();
    const second = other.askDownload({ bytes: 10, engineLabel: 'XeLaTeX' });
    other.dialog.dispatchEvent(new Event('cancel'));
    expect(await second).toBe(false);

    const plain = openCompilePdfDialog();
    (plain.dialog.querySelector('footer button') as HTMLButtonElement).click();
    expect(plain.closed).toBe(true);
  });

  it('fails with a message and a list of errors that go to their line', () => {
    const run = openCompilePdfDialog();
    const pick = vi.fn();
    run.fail('TeX stopped without a PDF', 'One error.', [diag('error', 3)], pick);
    expect(run.dialog.querySelector('h2')!.textContent).toBe('TeX stopped without a PDF');
    (run.dialog.querySelector('.compile-pdf-diagnostic') as HTMLButtonElement).click();
    expect(pick).toHaveBeenCalledWith(diag('error', 3));
    expect(run.closed).toBe(true);

    const plain = openCompilePdfDialog();
    plain.fail('Out of memory', 'Too big.');
    expect(plain.dialog.querySelector('.compile-pdf-diagnostics')).toBeNull();
    (plain.dialog.querySelector('footer button') as HTMLButtonElement).click();
    expect(plain.closed).toBe(true);
  });

  it('caps a long diagnostic list', () => {
    const list = diagnosticList([diag('error', 1), diag('warning', 2), diag('info', 3)], vi.fn(), 2);
    expect(list.querySelectorAll('button')).toHaveLength(2);
    expect(list.textContent).toContain('And 1 more.');
  });

  it('draws the pages as they come, with notes, Download and Close', async () => {
    const onDownload = vi.fn();
    const pick = vi.fn();
    const view = openPdfView({
      title: 'main.pdf',
      drawPages: async (onPage, isCurrent) => {
        onPage({ url: 'data:image/png;base64,AA', width: 612, height: 792 }, 0, 2);
        onPage({ url: 'data:image/png;base64,BB', width: 612, height: 792 }, 1, 2);
        expect(isCurrent()).toBe(true);
        return 2;
      },
      onDownload,
      diagnostics: [diag('error', 4), diag('warning', 5)],
      onPickDiagnostic: pick,
    });
    await view.done;
    const pages = view.dialog.querySelectorAll<HTMLImageElement>('.compiled-pdf-page');
    expect(Array.from(pages, (img) => img.alt)).toEqual(['Page 1 of 2', 'Page 2 of 2']);
    expect(view.dialog.querySelector('[role="status"]')!.textContent).toBe('2 pages');
    expect(view.dialog.querySelector('summary')!.textContent).toBe('1 error, 1 warning from TeX');
    (view.dialog.querySelector('footer button') as HTMLButtonElement).click();
    expect(onDownload).toHaveBeenCalled();
    (view.dialog.querySelector('.compile-pdf-diagnostic') as HTMLButtonElement).click();
    expect(pick).toHaveBeenCalledWith(diag('error', 4));
    expect(view.dialog.isConnected).toBe(false);
  });

  it('says when the pages could not be drawn, and stops drawing once closed', async () => {
    const broken = openPdfView({ title: 'x.pdf', drawPages: async () => Promise.reject(new Error('bad PDF')), onDownload: vi.fn(), diagnostics: [], onPickDiagnostic: vi.fn() });
    await broken.done;
    expect(broken.dialog.querySelector('[role="status"]')!.textContent).toContain("Couldn't draw the PDF: bad PDF");
    let current: () => boolean = () => true;
    const view = openPdfView({
      title: 'y.pdf',
      drawPages: async (onPage, isCurrent) => {
        current = isCurrent;
        onPage({ url: 'u', width: 1, height: 1 }, 0, 1);
        return 1;
      },
      onDownload: vi.fn(),
      diagnostics: [diag('warning', 1), diag('warning', 2)],
      onPickDiagnostic: vi.fn(),
    });
    await view.done;
    expect(view.dialog.querySelector('[role="status"]')!.textContent).toBe('1 page');
    expect(view.dialog.querySelector('summary')!.textContent).toBe('0 errors, 2 warnings from TeX');
    (view.dialog.querySelectorAll('footer button')[1] as HTMLButtonElement).click();
    expect(current()).toBe(false);
    view.close();
  });
});
