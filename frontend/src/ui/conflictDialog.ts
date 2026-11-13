import type { ConflictChoice } from '../storage/conflicts';

/**
 * Wire up the Basecoat save conflict dialog in the page (see index.html).
 * ask() shows it for one file and resolves with the button the person picked.
 * Calls made while it's open wait their turn, so each file gets its own answer.
 */
export function createConflictDialog(dialog: HTMLDialogElement) {
  const find = <T extends HTMLElement>(selector: string) => {
    const el = dialog.querySelector<T>(selector);
    if (!el) throw new Error(`Conflict dialog markup is missing ${selector}`);
    return el;
  };
  const pathEl = find('#conflict-dialog-path');
  const storageEl = find('#conflict-dialog-storage');
  const changedEl = find('#conflict-dialog-changed');
  const reasonEl = find('#conflict-dialog-reason');
  const theirsButton = find<HTMLButtonElement>('#conflict-theirs');
  const theirsLabel = theirsButton.textContent ?? '';
  // The title is optional so small test markup still works.
  const titleEl = dialog.querySelector<HTMLElement>('#conflict-dialog-title');
  const defaultTitle = titleEl?.textContent ?? '';
  const buttons: [HTMLButtonElement, ConflictChoice][] = [
    [find<HTMLButtonElement>('#conflict-mine'), 'mine'],
    [theirsButton, 'theirs'],
    [find<HTMLButtonElement>('#conflict-copy'), 'copy'],
  ];
  let answer: ((choice: ConflictChoice) => void) | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  // NOTE: jsdom has no dialog methods, so fall back to the open attribute there.
  const open = () => {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  };
  const close = () => {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  };

  for (const [button, choice] of buttons) {
    button.addEventListener('click', () => {
      const resolve = answer;
      answer = null;
      close();
      resolve?.(choice);
    });
  }
  // Escape would close it with no answer and leave the file stuck, so make them pick.
  dialog.addEventListener('cancel', (event) => event.preventDefault());

  /**
   * Pass a reason to say why in place of "changed in storage", and a label for the theirs button,
   * like when a file picked from Drive meets a project file of the same name.
   */
  const ask = (path: string, storage: string, wording: { title?: string; reason?: string; theirs?: string } = {}): Promise<ConflictChoice> => {
    const run = queue.then(
      () =>
        new Promise<ConflictChoice>((resolve) => {
          pathEl.textContent = path;
          storageEl.textContent = storage;
          changedEl.hidden = Boolean(wording.reason);
          reasonEl.hidden = !wording.reason;
          reasonEl.textContent = wording.reason ?? '';
          theirsButton.textContent = wording.theirs ?? theirsLabel;
          if (titleEl) titleEl.textContent = wording.title ?? defaultTitle;
          answer = resolve;
          open();
        }),
    );
    queue = run;
    return run;
  };

  return { ask, isOpen: () => answer !== null };
}
