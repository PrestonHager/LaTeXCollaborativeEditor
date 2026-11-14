/**
 * A small menu that opens where you right-click or long-press (#188). The file tree uses it for a row's
 * actions, which otherwise only show on hover. It's `--popover-menu` wide like the menu bar's
 * dropdowns (docs/ui-sizing.md), and on phones a full-width list pinned to the bottom (style.css).
 *
 * Arrow keys, Home and End move between items, Enter or Space runs one, and Escape or Tab closes it.
 * Escape puts focus back where it was. A click or tap anywhere else closes it too.
 */
export type ContextMenuItem = {
  label: string;
  /** An icon element to show before the label, if any. */
  icon?: Element | null;
  destructive?: boolean;
  run: () => void;
};

/** How far the menu stays from the window edge, like the hover preview card. */
const EDGE = 12;

export function createContextMenu(doc: Document = document) {
  const menu = doc.createElement('div');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  menu.tabIndex = -1;
  doc.body.append(menu);

  let returnFocus: HTMLElement | null = null;

  const items = () => Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));

  const close = (restoreFocus = false) => {
    if (menu.hidden) return;
    menu.hidden = true;
    menu.replaceChildren();
    doc.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('blur', onResize);
    const back = returnFocus;
    returnFocus = null;
    if (restoreFocus && back?.isConnected) back.focus();
  };

  function onOutside(event: Event) {
    if (!menu.contains(event.target as Node)) close();
  }
  function onResize() {
    close();
  }

  const place = (point: { clientX: number; clientY: number }) => {
    const view = doc.defaultView ?? window;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    // Open down and to the right of the point, or flip when that would run off the window.
    let left = point.clientX;
    let top = point.clientY;
    if (left + width > view.innerWidth - EDGE) left = point.clientX - width;
    if (top + height > view.innerHeight - EDGE) top = point.clientY - height;
    left = Math.max(EDGE, Math.min(left, view.innerWidth - EDGE - width));
    top = Math.max(EDGE, Math.min(top, view.innerHeight - EDGE - height));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  };

  menu.addEventListener('keydown', (event) => {
    const list = items();
    const index = list.indexOf(doc.activeElement as HTMLButtonElement);
    const moves: Record<string, number> = {
      ArrowDown: (index + 1) % list.length,
      ArrowUp: (index - 1 + list.length) % list.length,
      Home: 0,
      End: list.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      list[moves[event.key]]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      close(true);
    }
  });

  return {
    element: menu,
    get isOpen() {
      return !menu.hidden;
    },
    /** Open the menu at a point, labelled for screen readers. Focus goes to its first item. */
    open(entries: ContextMenuItem[], point: { clientX: number; clientY: number }, label: string, from?: HTMLElement | null) {
      close();
      if (!entries.length) return;
      returnFocus = from ?? (doc.activeElement as HTMLElement | null);
      menu.setAttribute('aria-label', label);
      menu.replaceChildren(
        ...entries.map((entry) => {
          const item = doc.createElement('button');
          item.type = 'button';
          item.className = 'context-menu-item';
          item.setAttribute('role', 'menuitem');
          if (entry.destructive) item.dataset.variant = 'destructive';
          if (entry.icon) item.append(entry.icon);
          const text = doc.createElement('span');
          text.textContent = entry.label;
          item.append(text);
          item.addEventListener('click', () => {
            close();
            entry.run();
          });
          return item;
        }),
      );
      menu.hidden = false;
      place(point);
      doc.addEventListener('pointerdown', onOutside, true);
      window.addEventListener('resize', onResize);
      window.addEventListener('blur', onResize);
      items()[0]?.focus({ preventScroll: true });
    },
    close,
  };
}

export type ContextMenu = ReturnType<typeof createContextMenu>;
