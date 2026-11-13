/** The button's name and tooltip, like "Preview is approximate: 3 changes". */
export function previewChangesLabel(count: number): string {
  return `Preview is approximate: ${count} change${count === 1 ? '' : 's'}`;
}

type PreviewChangesElements = {
  /** Wraps the button and the popover. Hidden while there are no changes. */
  root: HTMLElement;
  button: HTMLButtonElement;
  /** Small count next to the icon. The button's aria-label already says the number. */
  count: HTMLElement;
  popover: HTMLElement;
  summary: HTMLElement;
  list: HTMLElement;
};

/**
 * The info button in the preview pane's bar. It shows when the last compile had to strip or
 * rewrite things for LaTeX.js, and opens a small popover that lists them.
 *
 * The list is app UI, not part of the sandboxed preview. Entries can quote the document, which
 * peers write, so they only ever go in as text.
 */
export function createPreviewChanges(els: PreviewChangesElements) {
  const { root, button, count, popover, summary, list } = els;
  let open = false;

  const setOpen = (next: boolean, { restoreFocus = false } = {}) => {
    open = next;
    button.setAttribute('aria-expanded', String(next));
    popover.setAttribute('aria-hidden', String(!next));
    // Hidden content shouldn't be reachable with Tab while the popover is closed.
    popover.inert = !next;
    if (!next && restoreFocus) button.focus();
  };
  setOpen(false);

  button.addEventListener('click', () => setOpen(!open));

  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false, { restoreFocus: true });
  });

  // Close on a click anywhere else in the app...
  document.addEventListener('pointerdown', (event) => {
    if (open && !root.contains(event.target as Node | null)) setOpen(false);
  });
  // ...and when focus moves out of it, say with Tab.
  root.addEventListener('focusout', (event) => {
    const next = event.relatedTarget as Node | null;
    if (open && next && !root.contains(next)) setOpen(false);
  });
  // Clicks inside the preview frame never reach this document, but they take focus from the window.
  window.addEventListener('blur', () => {
    if (open) setOpen(false);
  });

  return {
    /** Show the changes from the last render. An empty list hides the button. */
    setChanges(changes: readonly string[]) {
      const label = previewChangesLabel(changes.length);
      root.hidden = changes.length === 0;
      button.setAttribute('aria-label', label);
      button.dataset.tooltip = label;
      count.textContent = String(changes.length);
      summary.textContent = `To show this document, the preview (LaTeX.js) made ${changes.length === 1 ? 'this change' : `these ${changes.length} changes`}. Your source isn't changed.`;
      list.replaceChildren(
        ...changes.map((change) => {
          const item = document.createElement('li');
          item.textContent = change;
          return item;
        }),
      );
      if (!changes.length && open) setOpen(false);
    },
    get isOpen() {
      return open;
    },
    close() {
      setOpen(false);
    },
  };
}

export type PreviewChanges = ReturnType<typeof createPreviewChanges>;

/** Find the info button's parts in the page. */
export function previewChangesElements(root: ParentNode = document): PreviewChangesElements {
  const get = <T extends HTMLElement>(id: string) => {
    const el = root.querySelector<T>(`#${id}`);
    if (!el) throw new Error(`Missing #${id}`);
    return el;
  };
  return {
    root: get('preview-changes'),
    button: get<HTMLButtonElement>('preview-changes-btn'),
    count: get('preview-changes-count'),
    popover: get('preview-changes-popover'),
    summary: get('preview-changes-summary'),
    list: get('preview-changes-list'),
  };
}
