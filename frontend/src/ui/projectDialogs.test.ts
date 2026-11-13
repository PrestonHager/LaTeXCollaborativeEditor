import { mountAppShell } from '../test/appShell';
import { createUploadDialog } from './uploadDialog';
import { createProjectsDialog } from './projectsDialog';
import { createFileViewer } from './fileViewer';

// jsdom has no showModal, so stand in for it.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

describe('upload dialog', () => {
  it('offers folders and uploads picked or dropped files right away', async () => {
    mountAppShell();
    const upload = vi.fn(async (file: File, folder: string) =>
      file.name === 'bad.png' ? { name: file.name, ok: false, message: 'too big' } : { name: file.name, ok: true, message: `added to ${folder || 'root'}` },
    );
    const dialogEl = document.getElementById('upload-dialog') as HTMLDialogElement;
    const dialog = createUploadDialog(dialogEl, { getFolders: () => ['figures'], upload });
    dialog.open('figures');
    expect(dialogEl.open).toBe(true);
    const select = document.getElementById('upload-folder') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual(['Project root', 'figures/']);
    expect(select.value).toBe('figures');

    const input = document.getElementById('upload-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'a.png'), new File(['y'], 'bad.png')] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(document.querySelectorAll('#upload-results li.is-error')).toHaveLength(1));
    expect(document.getElementById('upload-results')!.textContent).toContain('a.png: added to figures');

    const drop = document.getElementById('upload-drop')!;
    drop.dispatchEvent(new Event('dragover', { cancelable: true }));
    expect(drop.classList.contains('is-dragging')).toBe(true);
    drop.dispatchEvent(new Event('dragleave'));
    expect(drop.classList.contains('is-dragging')).toBe(false);
    const dropEvent = new Event('drop', { cancelable: true }) as Event & { dataTransfer: unknown };
    dropEvent.dataTransfer = { files: [new File(['z'], 'c.bib')] };
    drop.dispatchEvent(dropEvent);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(3));

    (document.getElementById('upload-done') as HTMLButtonElement).click();
    expect(dialogEl.open).toBe(false);
    dialog.open('gone');
    expect(select.value).toBe('');
    dialogEl.dispatchEvent(new Event('click'));
    expect(dialogEl.open).toBe(false);
  });
});

describe('upload dialog Drive button', () => {
  it('hides the row without a Drive hook', () => {
    mountAppShell();
    const dialogEl = document.getElementById('upload-dialog') as HTMLDialogElement;
    createUploadDialog(dialogEl, { getFolders: () => [], upload: vi.fn() }).open();
    expect(document.getElementById('upload-from-drive')!.parentElement!.hidden).toBe(true);
  });

  it('explains why it is off, and closes the dialog before running', () => {
    mountAppShell();
    const state = { enabled: false, note: 'Save the project to Google Drive first.' };
    const run = vi.fn();
    const dialogEl = document.getElementById('upload-dialog') as HTMLDialogElement;
    const dialog = createUploadDialog(dialogEl, { getFolders: () => [], upload: vi.fn(), fromDrive: { state: () => state, run } });
    dialog.open();
    const button = document.getElementById('upload-from-drive') as HTMLButtonElement;
    expect(button.parentElement!.hidden).toBe(false);
    expect(button.disabled).toBe(true);
    expect(document.getElementById('upload-from-drive-note')!.textContent).toBe(state.note);
    button.click();
    expect(run).not.toHaveBeenCalled();

    state.enabled = true;
    dialog.open();
    expect(button.disabled).toBe(false);
    button.click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(dialogEl.open).toBe(false);
  });
});

describe('projects dialog', () => {
  it('lists projects newest first and opens the one picked', () => {
    mountAppShell();
    const onPick = vi.fn();
    const onImportZip = vi.fn();
    const dialogEl = document.getElementById('projects-dialog') as HTMLDialogElement;
    const dialog = createProjectsDialog(dialogEl, { onPick, onImportZip });
    dialog.open([{ id: 'a', name: 'Thesis', updatedAt: Date.UTC(2026, 0, 2) }, { id: 'b', name: '' }]);
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('#projects-list .project-item'));
    expect(items.map((item) => item.querySelector('h3')!.textContent)).toEqual(['Thesis', 'Untitled']);
    expect(items[0].querySelector('p')!.textContent).toContain('Edited');
    expect((document.getElementById('projects-empty') as HTMLElement).hidden).toBe(true);
    items[0].click();
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    expect(dialogEl.open).toBe(false);

    dialog.open([]);
    expect((document.getElementById('projects-empty') as HTMLElement).hidden).toBe(false);
    (document.getElementById('projects-import-zip') as HTMLButtonElement).click();
    expect(onImportZip).toHaveBeenCalled();
    dialog.open([]);
    (document.getElementById('projects-close') as HTMLButtonElement).click();
    expect(dialogEl.open).toBe(false);
  });
});

describe('file viewer', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
  });

  it('shows images and PDFs, and notes for other files or ones still arriving', () => {
    mountAppShell();
    const onDownload = vi.fn();
    const root = document.getElementById('file-viewer')!;
    const viewer = createFileViewer(root, { onDownload });
    const body = document.getElementById('file-viewer-body')!;
    const message = document.getElementById('file-viewer-message')!;

    const bytes = new Uint8Array([1]);
    viewer.show({ path: 'figures/plot.png', bytes });
    expect(root.hidden).toBe(false);
    expect(body.querySelector('img')?.getAttribute('src')).toBe('blob:test');
    // Showing the same bytes again doesn't rebuild the image.
    viewer.show({ path: 'figures/plot.png', bytes });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    viewer.show({ path: 'paper.pdf', bytes: new Uint8Array([2]) });
    expect(body.querySelector('iframe')).toBeTruthy();
    expect(URL.revokeObjectURL).toHaveBeenCalled();

    viewer.show({ path: 'big.bin', size: 2048, bytes: new Uint8Array([3]) });
    expect(message.textContent).toContain('2.0 kB');
    viewer.show({ path: 'huge.dat2', size: 3 * 1024 * 1024, bytes: new Uint8Array([3]) });
    expect(message.textContent).toContain('3.0 MB');
    viewer.show({ path: 'tiny.bin', bytes: new Uint8Array([3]) });
    expect(message.textContent).toContain('1 B');

    viewer.show({ path: 'late.png', bytes: null, progress: 0.25 });
    expect(message.textContent).toContain('25%');
    expect((document.getElementById('file-viewer-progress') as HTMLElement).hidden).toBe(false);
    (document.getElementById('file-viewer-download') as HTMLButtonElement).click();
    expect(onDownload).toHaveBeenCalledWith('late.png');

    viewer.hide();
    expect(root.hidden).toBe(true);
    (document.getElementById('file-viewer-download') as HTMLButtonElement).click();
    expect(onDownload).toHaveBeenCalledTimes(1);
  });
});
