/**
 * Phone layout (issue #185, part of #123). Under 640px (Tailwind's `sm`, see docs/ui-sizing.md) the app
 * shows one pane at a time, Editor or Preview, with a segmented control to switch, and the file tree
 * opens as a drawer over the editor. Wider windows don't change: the CSS for all of this only applies
 * inside the phone media query, so the state set here is harmless on desktop and tablet.
 */
export type PhonePane = 'editor' | 'preview';

/** The same breakpoint as the `@media (width < 40rem)` rules in style.css. */
export const PHONE_QUERY = '(width < 40rem)';
/** The chosen pane lasts for this tab's session, like the host's room id. */
export const PHONE_PANE_KEY = 'latex-editor.phone-pane';

type PhoneLayoutElements = {
  /** Gets `data-phone-pane` and `is-files-open`, which the phone CSS reads. */
  root: HTMLElement;
  editorButton: HTMLButtonElement;
  previewButton: HTMLButtonElement;
  filesButton: HTMLButtonElement;
  filePane: HTMLElement;
  /** Covers the panes while the drawer is open. A click on it closes the drawer. */
  backdrop: HTMLElement;
  /** Made inert while the drawer is open, so Tab stays out of the panes behind it. */
  content: HTMLElement;
  /** Gets focus after a file is picked in the drawer, since the row that had it is hidden. Not the editor itself, so the soft keyboard stays down. */
  editorPane: HTMLElement;
  isPhone: () => boolean;
  /** Defaults to sessionStorage. Pass null to keep the choice in memory only. */
  storage?: Storage | null;
  /** Called after the visible pane changes, so the editor can measure itself again. */
  onPaneChange?: (pane: PhonePane) => void;
};

function defaultStorage(): Storage | null {
  // Some browsers throw just for touching sessionStorage when site data is blocked.
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function createPhoneLayout(elements: PhoneLayoutElements) {
  const { root, editorButton, previewButton, filesButton, filePane, backdrop, content, editorPane, isPhone, onPaneChange } = elements;
  const storage = elements.storage === undefined ? defaultStorage() : elements.storage;

  const read = (): PhonePane => {
    try {
      return storage?.getItem(PHONE_PANE_KEY) === 'preview' ? 'preview' : 'editor';
    } catch {
      return 'editor';
    }
  };

  let pane: PhonePane = read();
  let filesOpen = false;

  const render = () => {
    root.dataset.phonePane = pane;
    editorButton.setAttribute('aria-pressed', String(pane === 'editor'));
    previewButton.setAttribute('aria-pressed', String(pane === 'preview'));
    root.classList.toggle('is-files-open', filesOpen);
    filesButton.setAttribute('aria-expanded', String(filesOpen));
    backdrop.hidden = !filesOpen;
    content.inert = filesOpen;
  };

  const showPane = (next: PhonePane) => {
    if (next === pane) return;
    pane = next;
    try {
      storage?.setItem(PHONE_PANE_KEY, pane);
    } catch {
      // Storage is full or blocked: the choice still holds until the page reloads.
    }
    render();
    onPaneChange?.(pane);
  };

  const openFiles = () => {
    if (filesOpen) return;
    filesOpen = true;
    // The drawer sits over the editor, so show the editor behind it.
    showPane('editor');
    render();
    // The open file's row first, then the first row, then a button like New file when the tree is empty.
    const target = ['.file-row.is-active .file-row-main', '.file-row-main', 'button'].map((selector) => filePane.querySelector<HTMLElement>(selector)).find(Boolean);
    target?.focus();
  };

  const closeFiles = (restoreFocus = false) => {
    if (!filesOpen) return;
    filesOpen = false;
    render();
    if (restoreFocus) filesButton.focus();
  };

  editorButton.addEventListener('click', () => showPane('editor'));
  previewButton.addEventListener('click', () => showPane('preview'));
  filesButton.addEventListener('click', () => (filesOpen ? closeFiles(true) : openFiles()));
  backdrop.addEventListener('click', () => closeFiles(true));
  filePane.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !filesOpen) return;
    event.preventDefault();
    event.stopPropagation();
    closeFiles(true);
  });

  render();

  return {
    get pane() {
      return pane;
    },
    get filesOpen() {
      return filesOpen;
    },
    showPane,
    openFiles,
    closeFiles,
    /** A file was picked: on a phone, close the drawer and show the editor. */
    fileOpened() {
      if (!isPhone()) return;
      // The tree redraws when a file opens, so the row that had focus may already be gone: don't check where focus is.
      const wasOpen = filesOpen;
      closeFiles();
      showPane('editor');
      if (wasOpen) editorPane.focus({ preventScroll: true });
    },
    /** The window got wider or narrower. Close the drawer when it leaves phone width, so it doesn't pop open later. */
    viewportChanged() {
      if (!isPhone()) closeFiles();
    },
  };
}

export type PhoneLayout = ReturnType<typeof createPhoneLayout>;
