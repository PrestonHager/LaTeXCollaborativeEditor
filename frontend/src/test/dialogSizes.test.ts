/**
 * Every dialog picks a size from the shared scale in style.css (#141, docs/ui-sizing.md),
 * so new dialogs don't guess a width of their own.
 */
import { mountAppShell } from './appShell';

const SIZES = ['dialog-sm', 'dialog-md', 'dialog-lg', 'dialog-palette'];

describe('dialog sizes', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('gives every dialog in index.html exactly one size class', () => {
    mountAppShell();
    const dialogs = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog.dialog'));
    expect(dialogs.length).toBeGreaterThan(3);
    for (const dialog of dialogs) {
      const sizes = SIZES.filter((size) => dialog.classList.contains(size));
      expect(sizes, dialog.id).toHaveLength(1);
    }
  });
});
