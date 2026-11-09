import { createConflictDialog } from './conflictDialog';

function mount() {
  document.body.innerHTML = `
    <dialog id="conflict-dialog">
      <strong id="conflict-dialog-path"></strong><span id="conflict-dialog-storage"></span>
      <button id="conflict-copy"></button><button id="conflict-theirs"></button><button id="conflict-mine"></button>
    </dialog>`;
  const dialog = document.getElementById('conflict-dialog') as HTMLDialogElement;
  const click = (id: string) => (document.getElementById(id) as HTMLButtonElement).click();
  return { dialog, click, ui: createConflictDialog(dialog) };
}

describe('conflict dialog', () => {
  it('asks about one file at a time and resolves with the pick', async () => {
    const { dialog, click, ui } = mount();
    const first = ui.ask('main.tex', 'Google Drive');
    const second = ui.ask('refs.bib', 'Google Drive');
    await Promise.resolve();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(document.getElementById('conflict-dialog-path')!.textContent).toBe('main.tex');
    expect(document.getElementById('conflict-dialog-storage')!.textContent).toBe('Google Drive');
    expect(ui.isOpen()).toBe(true);

    click('conflict-theirs');
    expect(await first).toBe('theirs');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.getElementById('conflict-dialog-path')!.textContent).toBe('refs.bib');
    click('conflict-copy');
    expect(await second).toBe('copy');
    expect(ui.isOpen()).toBe(false);
    expect(dialog.hasAttribute('open')).toBe(false);

    const third = ui.ask('a.tex', 'Google Drive');
    await new Promise((resolve) => setTimeout(resolve, 0));
    click('conflict-mine');
    expect(await third).toBe('mine');
  });

  it('ignores Escape so the file never gets stuck without an answer', () => {
    const { dialog } = mount();
    const event = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('complains about missing markup', () => {
    document.body.innerHTML = '<dialog id="d"></dialog>';
    expect(() => createConflictDialog(document.getElementById('d') as HTMLDialogElement)).toThrow(/missing/);
  });
});
