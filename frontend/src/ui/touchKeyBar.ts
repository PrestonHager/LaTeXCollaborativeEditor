import { EditorView } from '@codemirror/view';

/**
 * On phones and tablets: a bar of LaTeX keys above the on-screen keyboard, and keeping the
 * cursor line in view when that keyboard opens (#189).
 *
 * Android Chrome shrinks the page for the keyboard because of `interactive-widget=resizes-content`
 * in index.html's viewport tag. Safari on iOS doesn't, so we read `visualViewport` and set
 * `--keyboard-inset` (how much of the window the keyboard covers) and `--app-height` on <html>.
 */

/** The keys on the bar, in order, with the name a screen reader says. */
export const TOUCH_KEYS: ReadonlyArray<{ text: string; label: string }> = [
  { text: '\\', label: 'Backslash' },
  { text: '{', label: 'Opening brace' },
  { text: '}', label: 'Closing brace' },
  { text: '$', label: 'Dollar sign' },
  { text: '%', label: 'Percent sign' },
  { text: '[', label: 'Opening bracket' },
  { text: ']', label: 'Closing bracket' },
  { text: '&', label: 'Ampersand' },
];

/** Room kept between the cursor line and the top of the bar or keyboard, in pixels. */
const CURSOR_MARGIN = 24;
/** A keyboard is open when it covers more than this many pixels. Smaller gaps are browser toolbars. */
const KEYBOARD_THRESHOLD = 80;
const COARSE_POINTER = '(pointer: coarse)';

/**
 * Put `text` in place of the selection as if it was typed. It's a normal editor transaction, so
 * Yjs sends it to peers, undo takes it back, and `\` opens autocompletion like a typed one.
 * False when the editor is read-only.
 */
export function insertTouchKey(view: EditorView, text: string): boolean {
  if (view.state.readOnly) return false;
  view.dispatch(view.state.replaceSelection(text), { userEvent: 'input.type', scrollIntoView: true });
  return true;
}

type TouchWindow = Pick<Window, 'innerHeight' | 'addEventListener' | 'removeEventListener'> & {
  matchMedia?: Window['matchMedia'];
  visualViewport?: VisualViewport | null;
};

export type TouchKeyBar = {
  element: HTMLElement;
  /** Show or hide the bar for the editor's focus, the pointer type and read-only state now. */
  refresh(): void;
  destroy(): void;
};

export function createTouchKeyBar(view: EditorView, container: HTMLElement, win: TouchWindow = window): TouchKeyBar {
  const doc = container.ownerDocument;
  const root = doc.documentElement;
  const bar = doc.createElement('div');
  bar.className = 'touch-key-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'LaTeX keys');
  bar.hidden = true;
  for (const key of TOUCH_KEYS) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'touch-key';
    button.textContent = key.text;
    button.setAttribute('aria-label', key.label);
    button.dataset.key = key.text;
    bar.appendChild(button);
  }
  container.appendChild(bar);

  let media: MediaQueryList | null = null;
  try {
    media = typeof win.matchMedia === 'function' ? win.matchMedia(COARSE_POINTER) : null;
  } catch {
    media = null;
  }
  const isTouch = () => media?.matches === true;

  // Tapping a key mustn't take focus from the editor, or the keyboard would close.
  const keepFocus = (event: Event) => event.preventDefault();
  bar.addEventListener('pointerdown', keepFocus);
  bar.addEventListener('mousedown', keepFocus);
  bar.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-key]');
    if (!button) return;
    insertTouchKey(view, button.dataset.key!);
    view.focus();
  });

  const refresh = () => {
    const show = isTouch() && !view.state.readOnly && (view.hasFocus || bar.contains(doc.activeElement));
    if (bar.hidden === !show) return;
    bar.hidden = !show;
    root.classList.toggle('has-touch-key-bar', show);
  };

  const onFocusIn = () => refresh();
  const onFocusOut = (event: FocusEvent) => {
    // Moving to one of the bar's own keys keeps it up.
    if (event.relatedTarget instanceof Node && bar.contains(event.relatedTarget)) return;
    // hasFocus still reads true during focusout, so check once focus has moved.
    queueMicrotask(refresh);
  };
  view.dom.addEventListener('focusin', onFocusIn);
  view.dom.addEventListener('focusout', onFocusOut);
  bar.addEventListener('focusout', onFocusOut);
  media?.addEventListener?.('change', refresh);

  const viewport = win.visualViewport ?? null;
  const onViewportChange = () => {
    if (!viewport) return;
    const inset = Math.max(0, Math.round(win.innerHeight - viewport.height - viewport.offsetTop));
    // Pinch zoom changes the visual viewport too, and then the page shouldn't follow it.
    const keyboardOpen = isTouch() && inset > KEYBOARD_THRESHOLD && Math.abs(viewport.scale - 1) < 0.01;
    if (keyboardOpen) {
      root.style.setProperty('--keyboard-inset', `${inset}px`);
      root.style.setProperty('--app-height', `${Math.round(viewport.height)}px`);
    } else {
      root.style.removeProperty('--keyboard-inset');
      root.style.removeProperty('--app-height');
    }
    if (view.hasFocus) {
      view.dispatch({
        effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'nearest', yMargin: CURSOR_MARGIN }),
      });
    }
  };
  viewport?.addEventListener('resize', onViewportChange);
  viewport?.addEventListener('scroll', onViewportChange);

  return {
    element: bar,
    refresh,
    destroy() {
      view.dom.removeEventListener('focusin', onFocusIn);
      view.dom.removeEventListener('focusout', onFocusOut);
      media?.removeEventListener?.('change', refresh);
      viewport?.removeEventListener('resize', onViewportChange);
      viewport?.removeEventListener('scroll', onViewportChange);
      root.classList.remove('has-touch-key-bar');
      root.style.removeProperty('--keyboard-inset');
      root.style.removeProperty('--app-height');
      bar.remove();
    },
  };
}
