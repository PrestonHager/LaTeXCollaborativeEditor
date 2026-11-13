import { returnFocusOnClose } from './focusReturn';

/** Wire up the About dialog in index.html and fill in the app version. */
export function createAboutDialog(dialog: HTMLDialogElement, version: string) {
  dialog.querySelector('#about-version')!.textContent = version;
  const focusReturn = returnFocusOnClose(dialog);
  const close = () => dialog.close();
  dialog.querySelector('#about-done')!.addEventListener('click', close);
  dialog.querySelector('#about-close')!.addEventListener('click', close);
  // Clicking the dark area outside the box closes it, like the other dialogs.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  return {
    open() {
      focusReturn.remember();
      dialog.showModal();
    },
    close,
  };
}
