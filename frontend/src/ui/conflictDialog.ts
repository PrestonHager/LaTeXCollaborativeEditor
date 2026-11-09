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
  const buttons: [HTMLButtonElement, ConflictChoice][] = [
    [find<HTMLButtonElement>('#conflict-mine'), 'mine'],
    [find<HTMLButtonElement>('#conflict-theirs'), 'theirs'],
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

  const ask = (path: string, storage: string): Promise<ConflictChoice> => {
    const run = queue.then(
      () =>
        new Promise<ConflictChoice>((resolve) => {
          pathEl.textContent = path;
          storageEl.textContent = storage;
          answer = resolve;
          open();
        }),
    );
    queue = run;
    return run;
  };

  return { ask, isOpen: () => answer !== null };
}
