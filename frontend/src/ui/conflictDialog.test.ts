import { createConflictDialog } from './conflictDialog';

function mount() {
  document.body.innerHTML = `
    <dialog id="conflict-dialog">
      <h2 id="conflict-dialog-title">File changed somewhere else</h2>
      <strong id="conflict-dialog-path"></strong><span id="conflict-dialog-changed"><span id="conflict-dialog-storage"></span></span><span id="conflict-dialog-reason" hidden></span>
      <button id="conflict-copy"></button><button id="conflict-theirs">Take theirs</button><button id="conflict-mine"></button>
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

  it('can say why in other words, then goes back to the usual wording', async () => {
    const { click, ui } = mount();
    const reason = document.getElementById('conflict-dialog-reason')!;
    const changed = document.getElementById('conflict-dialog-changed')!;
    const theirs = document.getElementById('conflict-theirs')!;
    const picked = ui.ask('notes.tex', 'Google Drive', { title: 'Same file name in Drive', reason: 'is also in Drive.', theirs: "Use Drive's copy" });
    await Promise.resolve();
    expect(reason.hidden).toBe(false);
    expect(reason.textContent).toBe('is also in Drive.');
    expect(changed.hidden).toBe(true);
    expect(theirs.textContent).toBe("Use Drive's copy");
    expect(document.getElementById('conflict-dialog-title')!.textContent).toBe('Same file name in Drive');
    click('conflict-theirs');
    expect(await picked).toBe('theirs');

    const usual = ui.ask('main.tex', 'Google Drive');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reason.hidden).toBe(true);
    expect(changed.hidden).toBe(false);
    expect(theirs.textContent).toBe('Take theirs');
    expect(document.getElementById('conflict-dialog-title')!.textContent).toBe('File changed somewhere else');
    click('conflict-mine');
    expect(await usual).toBe('mine');
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
