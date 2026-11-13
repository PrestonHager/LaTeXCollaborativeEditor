export const TOUR_SEEN_KEY = 'latex-editor.tour-seen';

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

/** Check if the first-run tour was already shown. Storage can throw (private mode), so treat that as seen. */
export function hasSeenTour(store: KeyValueStore | undefined): boolean {
  try {
    return store?.getItem(TOUR_SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markTourSeen(store: KeyValueStore | undefined) {
  try {
    store?.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    // Nothing to do, the tour just shows again next time.
  }
}

type TourStep = { target: string; title: string; body: string };

type TourOptions = {
  store?: KeyValueStore;
  /** Called when the tour closes, whether it finished or got skipped. */
  onClose?: () => void;
};

/**
 * Wire up the first-run tour card in index.html (#tour). The steps are the <li>s in
 * #tour-steps, each pointing at a part of the page with data-target.
 */
export function createTour(card: HTMLElement, stepList: HTMLElement, options: TourOptions = {}) {
  const steps: TourStep[] = Array.from(stepList.querySelectorAll<HTMLElement>('li')).map((li) => ({
    target: li.dataset.target ?? '',
    title: li.dataset.title ?? '',
    body: li.textContent?.trim() ?? '',
  }));
  const titleEl = card.querySelector<HTMLElement>('[data-tour-title]')!;
  const bodyEl = card.querySelector<HTMLElement>('[data-tour-body]')!;
  const countEl = card.querySelector<HTMLElement>('[data-tour-count]')!;
  const backBtn = card.querySelector<HTMLButtonElement>('[data-tour-back]')!;
  const nextBtn = card.querySelector<HTMLButtonElement>('[data-tour-next]')!;
  const skipBtn = card.querySelector<HTMLButtonElement>('[data-tour-skip]')!;
  let index = 0;
  let highlighted: HTMLElement | null = null;
  let returnFocus: HTMLElement | null = null;

  // Skip steps whose target isn't on the page right now, like a hidden pane.
  const visibleSteps = () =>
    steps.filter((step) => {
      const el = document.querySelector<HTMLElement>(step.target);
      return el && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none';
    });

  /** Put the card next to the target: below it if there's room, otherwise above, kept on screen. */
  const position = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const margin = 12;
    const below = rect.bottom + margin;
    const fitsBelow = below + cardRect.height < window.innerHeight;
    let top = fitsBelow ? below : rect.top - cardRect.height - margin;
    // Big targets like the editor leave no room either way, so sit inside them instead.
    if (top < margin) top = Math.min(rect.top + margin, window.innerHeight - cardRect.height - margin);
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - cardRect.width - margin);
    card.style.top = `${Math.max(margin, top)}px`;
    card.style.left = `${Math.max(margin, left)}px`;
  };

  const show = () => {
    const list = visibleSteps();
    const step = list[index];
    if (!step) return close();
    highlighted?.classList.remove('tour-highlight');
    highlighted = document.querySelector<HTMLElement>(step.target);
    highlighted?.classList.add('tour-highlight');
    titleEl.textContent = step.title;
    bodyEl.textContent = step.body;
    countEl.textContent = `${index + 1} of ${list.length}`;
    backBtn.disabled = index === 0;
    nextBtn.textContent = index === list.length - 1 ? 'Done' : 'Next';
    card.hidden = false;
    if (highlighted) position(highlighted);
    nextBtn.focus();
  };

  const close = () => {
    if (card.hidden) return;
    card.hidden = true;
    highlighted?.classList.remove('tour-highlight');
    highlighted = null;
    markTourSeen(options.store);
    // Put focus back where it was, so keyboard users don't end up at the top of the page.
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
    options.onClose?.();
  };

  nextBtn.addEventListener('click', () => {
    index += 1;
    show();
  });
  backBtn.addEventListener('click', () => {
    index = Math.max(0, index - 1);
    show();
  });
  skipBtn.addEventListener('click', close);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  const onResize = () => {
    if (!card.hidden && highlighted) position(highlighted);
  };
  window.addEventListener('resize', onResize);

  card.hidden = true;
  return {
    start() {
      index = 0;
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      show();
    },
    /** Start the tour only if this browser hasn't seen it. */
    startIfNew() {
      if (hasSeenTour(options.store)) return false;
      this.start();
      return true;
    },
    close,
    isOpen: () => !card.hidden,
    stepCount: () => steps.length,
  };
}
