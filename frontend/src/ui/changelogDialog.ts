// The "What's new" changelog dialog (issue #140, markup in index.html #changelog-dialog).
// Help → About → View changelog opens it, and so does "What's new" on the update prompt.
// This file is small and in the initial load; the changelog text and its renderer (changelogView.ts)
// are imported only when the dialog first opens.
import { returnFocusOnClose } from './focusReturn';

type ChangelogView = { renderChangelog: (container: HTMLElement, currentVersion: string) => void };

type ChangelogDialogOptions = {
  /** The running version (buildInfo), so its section gets marked. */
  version: string;
  /** Load the renderer. Defaults to the lazy chunk; tests pass their own. */
  load?: () => Promise<ChangelogView>;
};

export function createChangelogDialog(dialog: HTMLDialogElement, options: ChangelogDialogOptions) {
  const find = <T extends HTMLElement>(selector: string) => {
    const el = dialog.querySelector<T>(selector);
    if (!el) throw new Error(`Changelog dialog markup is missing ${selector}`);
    return el;
  };
  const body = find<HTMLElement>('#changelog-body');
  const load = options.load ?? (() => import('./changelogView'));
  const focusReturn = returnFocusOnClose(dialog);
  let rendered: Promise<void> | null = null;

  const close = () => {
    // NOTE: jsdom has no dialog methods, so fall back to the open attribute there.
    if (typeof dialog.close === 'function') dialog.close();
    else {
      dialog.removeAttribute('open');
      dialog.dispatchEvent(new Event('close'));
    }
  };
  // Keys typed here are for the dialog, not the app's shortcuts (same as the dialogs in dialogs.ts).
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  find('#changelog-done').addEventListener('click', close);
  find('#changelog-close').addEventListener('click', close);
  // Close when a click starts and ends on the backdrop, like the settings dialog.
  let backdropPress = false;
  dialog.addEventListener('pointerdown', (event) => {
    backdropPress = event.target === dialog;
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && backdropPress) close();
    backdropPress = false;
  });

  const message = (text: string) => {
    const p = dialog.ownerDocument.createElement('p');
    p.className = 'changelog-empty';
    p.textContent = text;
    return p;
  };

  const render = () => {
    body.setAttribute('aria-busy', 'true');
    body.replaceChildren(message('Loading the changelog...'));
    return load().then(
      (view) => {
        view.renderChangelog(body, options.version);
        body.removeAttribute('aria-busy');
        body.scrollTop = 0;
      },
      () => {
        rendered = null;
        body.removeAttribute('aria-busy');
        body.replaceChildren(message("Couldn't load the changelog. Check your connection and try again."));
      },
    );
  };

  return {
    /** Open the dialog. Resolves once the changelog is drawn (or failed to load). */
    open(): Promise<void> {
      focusReturn.remember();
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      }
      rendered ??= render();
      return rendered;
    },
    close,
    isOpen: () => dialog.open,
  };
}
