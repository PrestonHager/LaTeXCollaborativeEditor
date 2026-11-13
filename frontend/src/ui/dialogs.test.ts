import { baseNameRange, confirmDialog, noticeDialog, promptDialog } from './dialogs';

const openDialog = () => document.querySelector<HTMLDialogElement>('dialog.app-dialog')!;
const buttons = () => Array.from(openDialog().querySelectorAll<HTMLButtonElement>('footer button'));
const input = () => openDialog().querySelector<HTMLInputElement>('input')!;
const error = () => openDialog().querySelector<HTMLElement>('.app-dialog-error')!;
const type = (value: string) => {
  input().value = value;
  input().dispatchEvent(new Event('input'));
};
const submit = () => openDialog().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
const escape = () => openDialog().dispatchEvent(new Event('cancel', { cancelable: true }));

describe('dialogs', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('confirmDialog', () => {
    it('names the action, labels itself, and resolves true for the confirm button', async () => {
      const answer = confirmDialog({ title: 'Start a new link?', message: 'The old link stops working.', confirmLabel: 'Start new link', cancelLabel: 'Keep current link' });
      const dialog = openDialog();
      expect(dialog.hasAttribute('open')).toBe(true);
      // Confirm, prompt and notice dialogs use the small size from the shared scale (docs/ui-sizing.md).
      expect(dialog.classList.contains('dialog-sm')).toBe(true);
      expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Start a new link?');
      expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe('The old link stops working.');
      const [cancel, ok] = buttons();
      expect([cancel.textContent, ok.textContent]).toEqual(['Keep current link', 'Start new link']);
      expect(ok.dataset.variant).toBeUndefined();
      // Not risky, so Enter on the focused button confirms.
      expect(document.activeElement).toBe(ok);
      ok.click();
      expect(await answer).toBe(true);
      // It cleans up after itself.
      expect(document.querySelector('dialog')).toBeNull();
    });

    it('starts on Cancel with a red button for destructive actions', async () => {
      const answer = confirmDialog({ title: 'Delete main.tex?', message: 'Gone for everyone.', confirmLabel: 'Delete file', destructive: true });
      const [cancel, ok] = buttons();
      expect(cancel.textContent).toBe('Cancel');
      expect(ok.dataset.variant).toBe('destructive');
      expect(openDialog().getAttribute('role')).toBe('alertdialog');
      expect(document.activeElement).toBe(cancel);
      cancel.click();
      expect(await answer).toBe(false);
    });

    it('can start on Cancel without the red button, to catch a misclick', async () => {
      const answer = confirmDialog({ title: 'Replace the whole project?', message: 'a', confirmLabel: 'Start new project', focusCancel: true });
      const [cancel, ok] = buttons();
      expect(ok.dataset.variant).toBeUndefined();
      expect(openDialog().getAttribute('role')).toBeNull();
      expect(document.activeElement).toBe(cancel);
      cancel.click();
      expect(await answer).toBe(false);
    });

    it('cancels on Escape and on a click outside the box', async () => {
      const first = confirmDialog({ title: 'A', message: 'a', confirmLabel: 'Go' });
      escape();
      expect(await first).toBe(false);
      const second = confirmDialog({ title: 'B', message: 'b', confirmLabel: 'Go' });
      openDialog().querySelector('header')!.click();
      expect(document.querySelector('dialog')).not.toBeNull();
      openDialog().click();
      expect(await second).toBe(false);
    });

    it('gives focus back to what opened it', async () => {
      const opener = document.createElement('button');
      document.body.append(opener);
      opener.focus();
      const answer = confirmDialog({ title: 'A', message: 'a', confirmLabel: 'Go' });
      expect(document.activeElement).not.toBe(opener);
      buttons()[1].click();
      await answer;
      expect(document.activeElement).toBe(opener);
    });

    it("keeps its keys away from the app's shortcuts", async () => {
      const appKeys = vi.fn();
      document.addEventListener('keydown', appKeys);
      const answer = confirmDialog({ title: 'A', message: 'a', confirmLabel: 'Go' });
      buttons()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }));
      expect(appKeys).not.toHaveBeenCalled();
      buttons()[1].click();
      await answer;
      document.removeEventListener('keydown', appKeys);
    });
  });

  describe('promptDialog', () => {
    it('selects the base name and resolves with the trimmed value', async () => {
      const answer = promptDialog({ title: 'Rename intro.tex', label: 'File name or path', initialValue: 'chapters/intro.tex', confirmLabel: 'Rename' });
      const field = input();
      expect(document.activeElement).toBe(field);
      expect([field.selectionStart, field.selectionEnd]).toEqual([9, 14]);
      expect(openDialog().querySelector('label')?.htmlFor).toBe(field.id);
      expect(buttons().map((b) => b.textContent)).toEqual(['Cancel', 'Rename']);
      // No message, so nothing to describe the dialog with.
      expect(openDialog().hasAttribute('aria-describedby')).toBe(false);
      type('  chapters/opening.tex ');
      submit();
      expect(await answer).toBe('chapters/opening.tex');
    });

    it('selects everything for plain names', async () => {
      const answer = promptDialog({ title: 'Rename project', label: 'Project name', initialValue: 'Paper v1.2', confirmLabel: 'Rename', selectBaseName: false });
      expect([input().selectionStart, input().selectionEnd]).toEqual([0, 10]);
      escape();
      expect(await answer).toBeNull();
    });

    it('shows problems inline and only closes once the name is fine', async () => {
      const validate = vi.fn((value: string) => (value ? (value === 'taken' ? 'taken already exists.' : null) : 'Enter a name.'));
      const answer = promptDialog({ title: 'New folder', message: 'In the project.', label: 'Folder name', confirmLabel: 'Create folder', validate });
      // An empty box isn't an error until they try.
      expect(error().hidden).toBe(true);
      submit();
      expect(error().hidden).toBe(false);
      expect(error().textContent).toBe('Enter a name.');
      expect(input().getAttribute('aria-invalid')).toBe('true');
      expect(input().getAttribute('aria-describedby')).toBe(error().id);
      type('taken');
      expect(error().textContent).toBe('taken already exists.');
      type('fresh');
      expect(error().hidden).toBe(true);
      expect(input().hasAttribute('aria-invalid')).toBe(false);
      // The submit button is in the footer, tied to the form, so Enter in the box and a click both submit.
      expect(buttons()[1].getAttribute('form')).toBe(openDialog().querySelector('form')!.id);
      submit();
      expect(await answer).toBe('fresh');
    });

    describe('free name suggestions', () => {
      const names = ['chapter.tex', 'chapter (2).tex', 'figures'];
      const validate = (value: string) => (names.includes(value) ? `${value} already exists.` : value ? null : 'Enter a name.');
      const suggest = (value: string) => {
        if (!names.includes(value)) return null;
        const next = value === 'figures' ? 'figures (2)' : 'chapter (3).tex';
        return { value: next, message: `${value} already exists, so here's ${next} instead.` };
      };
      const useButton = () => error().querySelector<HTMLButtonElement>('.app-dialog-suggest');

      it('swaps a taken default for a free one, selects its base name, and says why until they type', async () => {
        const answer = promptDialog({ title: 'New file', label: 'File name', initialValue: 'chapter.tex', confirmLabel: 'Create file', validate, suggest });
        expect(input().value).toBe('chapter (3).tex');
        expect(document.activeElement).toBe(input());
        expect([input().selectionStart, input().selectionEnd]).toEqual([0, 11]);
        expect(error().hidden).toBe(false);
        expect(error().textContent).toBe("chapter.tex already exists, so here's chapter (3).tex instead.");
        // The box itself is fine now.
        expect(input().hasAttribute('aria-invalid')).toBe(false);
        type('intro.tex');
        expect(error().hidden).toBe(true);
        submit();
        expect(await answer).toBe('intro.tex');
      });

      it('takes the suggested name on Enter', async () => {
        const answer = promptDialog({ title: 'New folder', label: 'Folder name', initialValue: 'figures', confirmLabel: 'Create folder', validate, suggest });
        expect(input().value).toBe('figures (2)');
        submit();
        expect(await answer).toBe('figures (2)');
      });

      it('offers a free name for a taken one typed in, and Enter fills it in rather than failing', async () => {
        const answer = promptDialog({ title: 'New folder', label: 'Folder name', initialValue: 'plots', confirmLabel: 'Create folder', validate, suggest });
        expect(input().value).toBe('plots');
        type('figures');
        expect(input().getAttribute('aria-invalid')).toBe('true');
        expect(error().firstChild?.textContent).toBe('figures already exists.');
        expect(useButton()?.textContent).toBe('Use figures (2)');
        useButton()!.click();
        expect(input().value).toBe('figures (2)');
        expect(document.activeElement).toBe(input());
        expect(error().textContent).toBe("figures already exists, so here's figures (2) instead.");
        expect(useButton()).toBeNull();
        type('figures');
        submit();
        expect(input().value).toBe('figures (2)');
        expect(openDialog()).not.toBeNull();
        submit();
        expect(await answer).toBe('figures (2)');
      });

      it('leaves other problems as they are', async () => {
        const answer = promptDialog({ title: 'New file', label: 'File name', initialValue: '', confirmLabel: 'Create file', validate, suggest });
        expect(error().hidden).toBe(true);
        submit();
        expect(error().textContent).toBe('Enter a name.');
        expect(useButton()).toBeNull();
        escape();
        expect(await answer).toBeNull();
      });
    });

    it('resolves null on Cancel', async () => {
      const answer = promptDialog({ title: 'New file', label: 'File name', initialValue: 'chapter.tex', confirmLabel: 'Create file' });
      buttons()[0].click();
      expect(await answer).toBeNull();
    });
  });

  it('noticeDialog shows a message with one button', async () => {
    const done = noticeDialog({ title: 'Saved', message: 'All good.' });
    expect(buttons().map((b) => b.textContent)).toEqual(['OK']);
    expect(document.activeElement).toBe(buttons()[0]);
    buttons()[0].click();
    await expect(done).resolves.toBeUndefined();
  });

  it('finds the base name in a path', () => {
    expect(baseNameRange('chapter.tex')).toEqual([0, 7]);
    expect(baseNameRange('a/b/fig.final.png')).toEqual([4, 13]);
    expect(baseNameRange('figures')).toEqual([0, 7]);
    expect(baseNameRange('src/.latexmkrc')).toEqual([4, 14]);
  });
});
