import type { CommandId } from './menuBar';

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

type Box = { top: number; left: number; right: number; bottom: number };
type Size = { width: number; height: number };
export type TourPlacement = 'below' | 'above' | 'right' | 'left';

/**
 * Work out where the tour card goes so it doesn't cover what it points at. Try below, above,
 * right, then left of the target, and take the first spot that fits on screen. Tall panes like
 * the file list or editor have no room above or below, so the card ends up beside them. If no
 * spot fits (a small window), keep the card on screen where it covers the least of the target.
 */
export function placeTourCard(
  target: Box,
  card: Size,
  viewport: Size,
  margin = 12,
): { top: number; left: number; placement: TourPlacement } {
  // Only the part of the target that's on screen matters, some panes run past the edge.
  const t = {
    top: Math.max(target.top, 0),
    left: Math.max(target.left, 0),
    right: Math.min(target.right, viewport.width),
    bottom: Math.min(target.bottom, viewport.height),
  };
  const maxTop = viewport.height - card.height - margin;
  const maxLeft = viewport.width - card.width - margin;
  // Math.max last, so a card bigger than the window still starts at the top left.
  const onScreenTop = (top: number) => Math.max(margin, Math.min(top, maxTop));
  const onScreenLeft = (left: number) => Math.max(margin, Math.min(left, maxLeft));
  const spots: { placement: TourPlacement; top: number; left: number }[] = [
    { placement: 'below', top: t.bottom + margin, left: onScreenLeft(t.left) },
    { placement: 'above', top: t.top - card.height - margin, left: onScreenLeft(t.left) },
    { placement: 'right', top: onScreenTop(t.top), left: t.right + margin },
    { placement: 'left', top: onScreenTop(t.top), left: t.left - card.width - margin },
  ];
  const fits = spots.find((s) => s.top >= margin && s.left >= margin && s.top <= maxTop && s.left <= maxLeft);
  if (fits) return fits;

  // Nothing fits, so pull each spot onto the screen and pick the one that hides the least.
  const covered = (top: number, left: number) =>
    Math.max(0, Math.min(t.right, left + card.width) - Math.max(t.left, left)) *
    Math.max(0, Math.min(t.bottom, top + card.height) - Math.max(t.top, top));
  let best = { placement: spots[0].placement, top: 0, left: 0 };
  let bestCovered = Infinity;
  for (const spot of spots) {
    const top = onScreenTop(spot.top);
    const left = onScreenLeft(spot.left);
    const area = covered(top, left);
    if (area < bestCovered) {
      best = { placement: spot.placement, top, left };
      bestCovered = area;
    }
  }
  return best;
}

type TourStep = { target: string; title: string; body: string };

// Where a command has no keybind, the step names its menu item instead.
const SHORTCUT_FALLBACK: Partial<Record<CommandId, string>> = { 'app.commandPalette': 'Help > Command Palette' };

/** Fill each `{shortcut:<command id>}` in a step's text with that command's keybind for this platform. */
export function fillShortcuts(text: string, shortcutLabel?: (commandId: CommandId) => string | undefined): string {
  return text.replace(/\{shortcut:([\w.]+)\}/g, (_match, id: CommandId) => shortcutLabel?.(id) ?? SHORTCUT_FALLBACK[id] ?? id);
}

type TourOptions = {
  store?: KeyValueStore;
  /** The keybind label for a command, to fill `{shortcut:<command id>}` in the step text. */
  shortcutLabel?: (commandId: CommandId) => string | undefined;
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

  const position = (target: HTMLElement) => {
    const { width, height } = card.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const spot = placeTourCard(target.getBoundingClientRect(), { width, height }, viewport);
    card.style.top = `${spot.top}px`;
    card.style.left = `${spot.left}px`;
    card.dataset.placement = spot.placement;
  };

  const show = () => {
    const list = visibleSteps();
    const step = list[index];
    if (!step) return close();
    highlighted?.classList.remove('tour-highlight');
    highlighted = document.querySelector<HTMLElement>(step.target);
    highlighted?.classList.add('tour-highlight');
    titleEl.textContent = step.title;
    // Fill the keybinds in each time, so a changed keybind shows up here too.
    bodyEl.textContent = fillShortcuts(step.body, options.shortcutLabel);
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
