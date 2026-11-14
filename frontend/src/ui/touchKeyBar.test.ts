import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import * as Y from 'yjs';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { createTouchKeyBar, insertTouchKey, TOUCH_KEYS } from './touchKeyBar';
import { createEditorPane } from './editor';

// Scrolling the cursor into view measures text, which jsdom can't do, so give it empty boxes.
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

type Listener = () => void;

/** A stand-in for window: a (pointer: coarse) query and a visualViewport we can resize. */
function fakeWindow({ touch = true, viewport = true } = {}) {
  const mediaListeners: Listener[] = [];
  const media = {
    matches: touch,
    addEventListener: (_type: string, fn: Listener) => mediaListeners.push(fn),
    removeEventListener: vi.fn(),
  };
  const viewportListeners: Record<string, Listener[]> = {};
  const visualViewport = {
    height: 800,
    offsetTop: 0,
    scale: 1,
    addEventListener: (type: string, fn: Listener) => (viewportListeners[type] ??= []).push(fn),
    removeEventListener: vi.fn(),
  };
  const win = {
    innerHeight: 800,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    matchMedia: vi.fn(() => media),
    visualViewport: viewport ? visualViewport : null,
  };
  return {
    win: win as unknown as Window,
    media,
    visualViewport,
    setTouch(value: boolean) {
      media.matches = value;
      mediaListeners.forEach((fn) => fn());
    },
    resizeViewport(height: number, extra: Partial<typeof visualViewport> = {}) {
      Object.assign(visualViewport, { height, ...extra });
      (viewportListeners.resize ?? []).forEach((fn) => fn());
    },
  };
}

function makeView(doc = 'ab', extensions: Extension = []) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({ state: EditorState.create({ doc, extensions }), parent });
  return { view, parent };
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const keyButton = (bar: HTMLElement, text: string) => bar.querySelector<HTMLButtonElement>(`button[data-key="${CSS.escape(text)}"]`)!;

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.className = '';
  document.documentElement.removeAttribute('style');
});

describe('TOUCH_KEYS', () => {
  it('has the LaTeX keys from #189, in order, each with a spoken name', () => {
    expect(TOUCH_KEYS.map((key) => key.text)).toEqual(['\\', '{', '}', '$', '%', '[', ']', '&']);
    for (const key of TOUCH_KEYS) expect(key.label).not.toBe('');
  });
});

describe('insertTouchKey', () => {
  it.each(TOUCH_KEYS.map((key) => key.text))('inserts %s at the cursor', (text) => {
    const { view } = makeView('ab');
    view.dispatch({ selection: { anchor: 1 } });
    expect(insertTouchKey(view, text)).toBe(true);
    expect(view.state.doc.toString()).toBe(`a${text}b`);
    expect(view.state.selection.main.head).toBe(2);
  });

  it('replaces the selection, as typing does', () => {
    const { view } = makeView('hello');
    view.dispatch({ selection: { anchor: 1, head: 4 } });
    insertTouchKey(view, '$');
    expect(view.state.doc.toString()).toBe('h$o');
  });

  it('marks the change as typing', () => {
    const events: boolean[] = [];
    const { view } = makeView('', [EditorView.updateListener.of((update) => {
      update.transactions.forEach((tr) => events.push(tr.isUserEvent('input.type')));
    })]);
    insertTouchKey(view, '\\');
    expect(events).toEqual([true]);
  });

  it('does nothing in a read-only editor', () => {
    const { view } = makeView('ab', [EditorState.readOnly.of(true)]);
    expect(insertTouchKey(view, '{')).toBe(false);
    expect(view.state.doc.toString()).toBe('ab');
  });

  it('goes into the shared Yjs text and undo takes it back', () => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('main');
    ytext.insert(0, 'x');
    const undoManager = new Y.UndoManager(ytext);
    const { view } = makeView(ytext.toString(), [yCollab(ytext, null, { undoManager })]);
    view.dispatch({ selection: { anchor: 1 } });

    insertTouchKey(view, '&');
    expect(ytext.toString()).toBe('x&');

    const undo = yUndoManagerKeymap.find((binding) => binding.key === 'Mod-z')!.run!;
    undo(view);
    expect(ytext.toString()).toBe('x');
    expect(view.state.doc.toString()).toBe('x');
  });
});

describe('createTouchKeyBar', () => {
  it('renders a labeled toolbar with a button per key, hidden at first', () => {
    const { view, parent } = makeView();
    const { win } = fakeWindow();
    const bar = createTouchKeyBar(view, parent, win);
    expect(bar.element.parentElement).toBe(parent);
    expect(bar.element.getAttribute('role')).toBe('toolbar');
    expect(bar.element.getAttribute('aria-label')).toBe('LaTeX keys');
    const buttons = [...bar.element.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(TOUCH_KEYS.map((key) => key.text));
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(TOUCH_KEYS.map((key) => key.label));
    expect(buttons.every((b) => b.type === 'button')).toBe(true);
    expect(bar.element.hidden).toBe(true);
  });

  it('shows while the editor has focus on a touch device, and hides when it loses it', async () => {
    const { view, parent } = makeView();
    const outside = document.body.appendChild(document.createElement('button'));
    const { win } = fakeWindow();
    const bar = createTouchKeyBar(view, parent, win);

    view.focus();
    expect(bar.element.hidden).toBe(false);
    expect(document.documentElement.classList.contains('has-touch-key-bar')).toBe(true);

    outside.focus();
    await flush();
    expect(bar.element.hidden).toBe(true);
    expect(document.documentElement.classList.contains('has-touch-key-bar')).toBe(false);
  });

  it('stays hidden without a touch screen, and follows the pointer type when it changes', () => {
    const { view, parent } = makeView();
    const fake = fakeWindow({ touch: false });
    const bar = createTouchKeyBar(view, parent, fake.win);
    view.focus();
    expect(bar.element.hidden).toBe(true);
    fake.setTouch(true);
    expect(bar.element.hidden).toBe(false);
    fake.setTouch(false);
    expect(bar.element.hidden).toBe(true);
  });

  it('stays hidden when there is no matchMedia, or it throws', () => {
    const { view, parent } = makeView();
    const noMedia = { innerHeight: 800, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as Window;
    const bar = createTouchKeyBar(view, parent, noMedia);
    const throwing = { ...noMedia, matchMedia: () => { throw new Error('blocked'); } } as unknown as Window;
    const bar2 = createTouchKeyBar(view, parent, throwing);
    view.focus();
    expect(bar.element.hidden).toBe(true);
    expect(bar2.element.hidden).toBe(true);
  });

  it('hides in a read-only editor', () => {
    const { view, parent } = makeView('ab', [EditorState.readOnly.of(true)]);
    const bar = createTouchKeyBar(view, parent, fakeWindow().win);
    view.focus();
    expect(bar.element.hidden).toBe(true);
  });

  it('inserts the tapped key at the cursor and keeps the editor focused', () => {
    const { view, parent } = makeView('ab');
    const bar = createTouchKeyBar(view, parent, fakeWindow().win);
    view.focus();
    view.dispatch({ selection: { anchor: 2 } });

    const pointerDown = new Event('pointerdown', { bubbles: true, cancelable: true });
    keyButton(bar.element, '{').dispatchEvent(pointerDown);
    expect(pointerDown.defaultPrevented).toBe(true);
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    keyButton(bar.element, '{').dispatchEvent(mouseDown);
    expect(mouseDown.defaultPrevented).toBe(true);

    keyButton(bar.element, '\\').click();
    keyButton(bar.element, '{').click();
    expect(view.state.doc.toString()).toBe('ab\\{');
    expect(view.hasFocus).toBe(true);
    expect(bar.element.hidden).toBe(false);
  });

  it('ignores clicks between the keys', () => {
    const { view, parent } = makeView('ab');
    const bar = createTouchKeyBar(view, parent, fakeWindow().win);
    bar.element.click();
    expect(view.state.doc.toString()).toBe('ab');
  });

  it('stays up when focus moves from the editor to one of its keys', async () => {
    const { view, parent } = makeView();
    const bar = createTouchKeyBar(view, parent, fakeWindow().win);
    view.focus();
    keyButton(bar.element, '%').focus();
    await flush();
    expect(bar.element.hidden).toBe(false);
  });

  it('sets the keyboard inset and app height while the keyboard is open, and clears them after', () => {
    const { view, parent } = makeView();
    const fake = fakeWindow();
    createTouchKeyBar(view, parent, fake.win);
    const style = document.documentElement.style;

    fake.resizeViewport(450);
    expect(style.getPropertyValue('--keyboard-inset')).toBe('350px');
    expect(style.getPropertyValue('--app-height')).toBe('450px');

    fake.resizeViewport(800);
    expect(style.getPropertyValue('--keyboard-inset')).toBe('');
    expect(style.getPropertyValue('--app-height')).toBe('');
  });

  it('ignores pinch zoom, small toolbar changes and non-touch devices', () => {
    const { view, parent } = makeView();
    const fake = fakeWindow();
    createTouchKeyBar(view, parent, fake.win);
    const style = document.documentElement.style;

    fake.resizeViewport(400, { scale: 2 });
    expect(style.getPropertyValue('--keyboard-inset')).toBe('');
    fake.resizeViewport(760, { scale: 1 });
    expect(style.getPropertyValue('--keyboard-inset')).toBe('');
    fake.setTouch(false);
    fake.resizeViewport(450);
    expect(style.getPropertyValue('--keyboard-inset')).toBe('');
  });

  it('scrolls the cursor line into view when the keyboard opens while the editor has focus', () => {
    const { view, parent } = makeView('a\nb\nc');
    const fake = fakeWindow();
    createTouchKeyBar(view, parent, fake.win);
    const effects: unknown[] = [];
    const dispatch = view.dispatch.bind(view);
    view.dispatch = ((...specs: Parameters<typeof view.dispatch>) => {
      effects.push(specs);
      return dispatch(...(specs as [never]));
    }) as typeof view.dispatch;

    fake.resizeViewport(450);
    expect(effects).toHaveLength(0);
    view.focus();
    fake.resizeViewport(400);
    expect(effects).toHaveLength(1);
  });

  it('works without visualViewport', () => {
    const { view, parent } = makeView();
    const bar = createTouchKeyBar(view, parent, fakeWindow({ viewport: false }).win);
    view.focus();
    expect(bar.element.hidden).toBe(false);
    bar.destroy();
  });

  it('removes itself and its listeners on destroy', () => {
    const { view, parent } = makeView();
    const fake = fakeWindow();
    const bar = createTouchKeyBar(view, parent, fake.win);
    view.focus();
    fake.resizeViewport(450);
    bar.destroy();
    expect(parent.querySelector('.touch-key-bar')).toBeNull();
    expect(document.documentElement.classList.contains('has-touch-key-bar')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('');
    expect(fake.media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(fake.visualViewport.removeEventListener).toHaveBeenCalledTimes(2);
  });
});

describe('createEditorPane key bar', () => {
  it('adds the key bar next to the editor', () => {
    const container = document.createElement('div');
    const editor = createEditorPane(container);
    expect(container.querySelector('.touch-key-bar')).toBe(editor.getTouchKeyBar());
  });

  it('hides the key bar when the editor becomes read-only', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createEditorPane(container);
    const bar = editor.getTouchKeyBar();
    bar.hidden = false;
    editor.setEditable(false);
    expect(bar.hidden).toBe(true);
  });
});
