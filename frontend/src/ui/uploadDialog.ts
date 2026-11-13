import { returnFocusOnClose } from './focusReturn';

type UploadResult ={ name: string; ok: boolean; message: string };

type UploadDialogOptions = {
  /** Folders to offer, with '' meaning the project root. */
  getFolders: () => string[];
  /** Add one file to the project and say how it went. */
  upload: (file: File, folder: string) => Promise<UploadResult>;
  /**
   * The "Add Files from Drive" button. state() says if it can run and what to tell the person,
   * and run() starts it after the dialog closes.
   */
  fromDrive?: { state(): { enabled: boolean; note: string }; run(): void };
};

/** Wire up the upload dialog in index.html. Files are added as soon as they're picked or dropped. */
export function createUploadDialog(dialog: HTMLDialogElement, options: UploadDialogOptions) {
  const folderSelect = dialog.querySelector<HTMLSelectElement>('#upload-folder')!;
  const input = dialog.querySelector<HTMLInputElement>('#upload-input')!;
  const drop = dialog.querySelector<HTMLElement>('#upload-drop')!;
  const results = dialog.querySelector<HTMLUListElement>('#upload-results')!;

  const addFiles = async (files: File[]) => {
    const folder = folderSelect.value;
    for (const file of files) {
      const li = document.createElement('li');
      li.textContent = `${file.name}: uploading...`;
      results.append(li);
      const result = await options.upload(file, folder);
      li.textContent = `${result.name}: ${result.message}`;
      li.classList.toggle('is-error', !result.ok);
    }
  };

  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    // Clear it so picking the same file again still fires change.
    input.value = '';
    void addFiles(files);
  });
  drop.addEventListener('dragover', (event) => {
    event.preventDefault();
    drop.classList.add('is-dragging');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('is-dragging');
    void addFiles(Array.from(event.dataTransfer?.files ?? []));
  });
  const close = () => dialog.close();
  const driveButton = dialog.querySelector<HTMLButtonElement>('#upload-from-drive');
  const driveNote = dialog.querySelector<HTMLElement>('#upload-from-drive-note');
  const driveRow = driveButton?.parentElement;
  const refreshDrive = () => {
    if (!driveButton || !driveRow) return;
    driveRow.hidden = !options.fromDrive;
    if (!options.fromDrive) return;
    const { enabled, note } = options.fromDrive.state();
    driveButton.disabled = !enabled;
    if (driveNote) driveNote.textContent = note;
  };
  driveButton?.addEventListener('click', () => {
    if (!options.fromDrive?.state().enabled) return;
    // The Picker opens over the page, so get the dialog out of its way first.
    close();
    options.fromDrive.run();
  });
  const focusReturn = returnFocusOnClose(dialog);
  dialog.querySelector('#upload-done')!.addEventListener('click', close);
  dialog.querySelector('#upload-close')!.addEventListener('click', close);
  // Clicking the dark area outside the box closes it, like the settings dialog.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  return {
    open(folder = '') {
      const folders = ['', ...options.getFolders()];
      folderSelect.replaceChildren(
        ...folders.map((path) => {
          const option = document.createElement('option');
          option.value = path;
          option.textContent = path ? `${path}/` : 'Project root';
          return option;
        }),
      );
      folderSelect.value = folders.includes(folder) ? folder : '';
      results.replaceChildren();
      refreshDrive();
      focusReturn.remember();
      dialog.showModal();
    },
    addFiles,
  };
}
