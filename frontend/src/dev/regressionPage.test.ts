import { PROGRESS_KEY, mountChecklist } from './regressionPage';

const MARKDOWN = ['# Test list', 'Intro.', '## Editor', 'Note.', '- [ ] Types', '- [ ] Undoes', '## Preview', '- [ ] Renders'].join('\n');

const boxes = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
const progress = (root: HTMLElement) => root.querySelector('[data-progress-text]')!.textContent;

describe('mountChecklist', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('renders every item unticked with counts', () => {
    const root = document.body.appendChild(document.createElement('main'));
    expect(mountChecklist(root, MARKDOWN, localStorage)).toEqual({ total: 3 });
    expect(root.querySelector('h1')!.textContent).toBe('Test list');
    expect(boxes(root)).toHaveLength(3);
    expect(progress(root)).toBe('0 of 3 done');
    expect(root.querySelector('[data-section-count]')!.textContent).toBe('0/2');
    // Each label is tied to its box, so clicking the text ticks it.
    expect(root.querySelector(`label[for="${boxes(root)[0].id}"]`)!.textContent).toBe('Types');
  });

  it('saves ticks and brings them back on the next mount', () => {
    const root = document.body.appendChild(document.createElement('main'));
    mountChecklist(root, MARKDOWN, localStorage);
    boxes(root)[1].click();
    expect(progress(root)).toBe('1 of 3 done');
    expect(JSON.parse(localStorage.getItem(PROGRESS_KEY)!)).toEqual(['Editor :: Undoes']);

    const again = document.body.appendChild(document.createElement('main'));
    mountChecklist(again, MARKDOWN, localStorage);
    expect(boxes(again).map((box) => box.checked)).toEqual([false, true, false]);

    boxes(again)[1].click();
    expect(JSON.parse(localStorage.getItem(PROGRESS_KEY)!)).toEqual([]);
  });

  it('clears every tick with the reset button', () => {
    const root = document.body.appendChild(document.createElement('main'));
    mountChecklist(root, MARKDOWN, localStorage);
    boxes(root).forEach((box) => box.click());
    expect(progress(root)).toBe('3 of 3 done');
    root.querySelector<HTMLButtonElement>('[data-reset]')!.click();
    expect(boxes(root).every((box) => !box.checked)).toBe(true);
    expect(progress(root)).toBe('0 of 3 done');
  });

  it('still works when storage is missing, broken or full', () => {
    const root = document.body.appendChild(document.createElement('main'));
    mountChecklist(root, MARKDOWN, null);
    boxes(root)[0].click();
    expect(progress(root)).toBe('1 of 3 done');

    const broken = {
      getItem: () => 'not json',
      setItem: () => {
        throw new Error('full');
      },
    } as unknown as Storage;
    const other = document.body.appendChild(document.createElement('main'));
    mountChecklist(other, MARKDOWN, broken);
    expect(() => boxes(other)[0].click()).not.toThrow();
    expect(progress(other)).toBe('1 of 3 done');
  });

  it('ignores saved progress that is not a list of strings', () => {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ nope: true }));
    const root = document.body.appendChild(document.createElement('main'));
    mountChecklist(root, MARKDOWN, localStorage);
    expect(progress(root)).toBe('0 of 3 done');
  });
});
