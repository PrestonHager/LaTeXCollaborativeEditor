import type { OutlineHost } from '../ui/outline';

/**
 * The Outline section at the bottom of the Files pane (issue #248). This part is in the initial
 * load and only opens and closes the section; the outline itself is a lazy chunk (ui/outline.ts)
 * that loads the first time the section is open.
 */

export const OUTLINE_OPEN_KEY = 'latex-editor.outline-open';

type Mounted = { refresh(): void; dispose(): void };
type OutlineModule = { mountOutline(list: HTMLElement, host: OutlineHost): Mounted };

export interface OutlineSectionElements {
  section: HTMLElement;
  toggle: HTMLButtonElement;
  list: HTMLElement;
  load: () => Promise<OutlineModule>;
  host: OutlineHost;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

export function createOutlineSection({ section, toggle, list, load, host, storage = safeStorage() }: OutlineSectionElements) {
  let open = false;
  try {
    open = storage?.getItem(OUTLINE_OPEN_KEY) === '1';
  } catch {
    // Blocked storage: start closed.
  }
  let mounted: Mounted | null = null;
  let loading: Promise<void> | null = null;

  const render = () => {
    toggle.setAttribute('aria-expanded', String(open));
    section.classList.toggle('is-open', open);
    list.hidden = !open;
  };

  /** Loads and draws the outline the first time it's open. A failed load is tried again next time. */
  const ensure = (): Promise<void> => {
    if (!open || mounted) return Promise.resolve();
    loading ??= load().then(
      (module) => {
        mounted = module.mountOutline(list, host);
      },
      (error: unknown) => {
        console.warn('Outline failed to load', error);
        const li = document.createElement('li');
        li.className = 'outline-empty';
        li.textContent = "The outline couldn't load. Close and open it to try again.";
        list.replaceChildren(li);
      },
    ).finally(() => {
      loading = null;
    });
    return loading;
  };

  toggle.addEventListener('click', () => {
    open = !open;
    try {
      storage?.setItem(OUTLINE_OPEN_KEY, open ? '1' : '0');
    } catch {
      // The choice still holds until the page reloads.
    }
    render();
    void ensure();
  });

  render();
  const ready = ensure();

  return {
    get open() {
      return open;
    },
    /** Resolves once an open outline has loaded (or failed to). For tests. */
    ready: () => loading ?? ready,
    /** Draw it again now, like after the project doc was replaced. */
    refresh() {
      mounted?.refresh();
    },
  };
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
