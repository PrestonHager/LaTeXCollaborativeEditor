import { createTour, hasSeenTour, markTourSeen, placeTourCard, TOUR_SEEN_KEY } from './tour';
import { mountAppShell } from '../test/appShell';

const memoryStore = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
};

const brokenStore = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('tour state', () => {
  it('remembers that the tour was shown', () => {
    const store = memoryStore();
    expect(hasSeenTour(store)).toBe(false);
    markTourSeen(store);
    expect(store.getItem(TOUR_SEEN_KEY)).toBe('1');
    expect(hasSeenTour(store)).toBe(true);
  });

  it("treats storage that throws as seen, so it doesn't pop up every visit", () => {
    expect(hasSeenTour(brokenStore)).toBe(true);
    expect(() => markTourSeen(brokenStore)).not.toThrow();
    expect(hasSeenTour(undefined)).toBe(false);
  });
});

describe('placeTourCard', () => {
  const card = { width: 352, height: 205 };
  const desktop = { width: 1280, height: 800 };
  const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
  type Spot = ReturnType<typeof placeTourCard>;
  const overlaps = (spot: Spot, t: ReturnType<typeof box>) =>
    spot.left < t.right && spot.left + card.width > t.left && spot.top < t.bottom && spot.top + card.height > t.top;

  it('goes below a short target, lined up with its left edge', () => {
    const menus = box(110, 10, 317, 42);
    expect(placeTourCard(menus, card, desktop)).toEqual({ placement: 'below', top: 54, left: 110 });
  });

  it('goes above when there is no room below', () => {
    const status = box(1000, 700, 1260, 760);
    const spot = placeTourCard(status, card, desktop);
    expect(spot).toEqual({ placement: 'above', top: 700 - 205 - 12, left: 1280 - 352 - 12 });
  });

  it('puts the card beside tall panes instead of on top of them', () => {
    const files = box(0, 92, 240, 767);
    const editor = box(240, 92, 760, 767);
    // The preview runs a little past the right edge of the window.
    const preview = box(768, 92, 1288, 767);
    expect(placeTourCard(files, card, desktop)).toEqual({ placement: 'right', top: 92, left: 252 });
    expect(placeTourCard(editor, card, desktop)).toEqual({ placement: 'right', top: 92, left: 772 });
    expect(placeTourCard(preview, card, desktop)).toEqual({ placement: 'left', top: 92, left: 768 - 352 - 12 });
    for (const target of [files, editor, preview]) expect(overlaps(placeTourCard(target, card, desktop), target)).toBe(false);
  });

  it('stays on screen and covers as little as it can when nothing fits', () => {
    const phone = { width: 390, height: 844 };
    const files = box(0, 164, 240, 811);
    const spot = placeTourCard(files, card, phone);
    // Pushed up against the top, only clipping the top of the pane.
    expect(spot).toEqual({ placement: 'above', top: 12, left: 12 });

    const whole = box(0, 0, 390, 844);
    const fallback = placeTourCard(whole, card, phone);
    expect(fallback.top).toBeGreaterThanOrEqual(12);
    expect(fallback.top + card.height).toBeLessThanOrEqual(844 - 12);
    expect(fallback.left + card.width).toBeLessThanOrEqual(390 - 12);
  });

  it('keeps the card at the top left when the window is smaller than the card', () => {
    const tiny = { width: 200, height: 150 };
    const spot = placeTourCard(box(0, 0, 100, 100), card, tiny);
    expect(spot.top).toBe(12);
    expect(spot.left).toBe(12);
  });
});

describe('createTour', () => {
  const setup = (store = memoryStore()) => {
    mountAppShell();
    const card = document.getElementById('tour')!;
    const onClose = vi.fn();
    const tour = createTour(card, document.getElementById('tour-steps')!, { store, onClose });
    const q = <T extends HTMLElement>(selector: string) => card.querySelector<T>(selector)!;
    return { card, tour, store, onClose, q };
  };

  it('walks through the steps and only shows once', () => {
    const { card, tour, store, onClose, q } = setup();
    expect(card.hidden).toBe(true);
    expect(tour.stepCount()).toBeGreaterThanOrEqual(5);

    expect(tour.startIfNew()).toBe(true);
    expect(tour.isOpen()).toBe(true);
    expect(q('[data-tour-title]').textContent).toBe('Menus');
    expect(q('[data-tour-count]').textContent).toBe(`1 of ${tour.stepCount()}`);
    expect(q<HTMLButtonElement>('[data-tour-back]').disabled).toBe(true);
    expect(document.getElementById('menu-bar')!.classList.contains('tour-highlight')).toBe(true);
    expect(document.activeElement).toBe(q('[data-tour-next]'));

    q<HTMLButtonElement>('[data-tour-next]').click();
    expect(q('[data-tour-title]').textContent).toBe('Toolbar');
    expect(document.getElementById('menu-bar')!.classList.contains('tour-highlight')).toBe(false);
    q<HTMLButtonElement>('[data-tour-back]').click();
    expect(q('[data-tour-title]').textContent).toBe('Menus');

    // Click Next through to the end, then Done closes it.
    for (let i = 1; i < tour.stepCount(); i += 1) q<HTMLButtonElement>('[data-tour-next]').click();
    expect(q('[data-tour-next]').textContent).toBe('Done');
    q<HTMLButtonElement>('[data-tour-next]').click();
    expect(tour.isOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(hasSeenTour(store)).toBe(true);
    expect(tour.startIfNew()).toBe(false);
    // Each step checks layout styles, which jsdom is slow at, so give this one more time.
  }, 30_000);

  it('can be skipped with the button or Escape, and gives focus back', () => {
    const { card, tour, q } = setup();
    const opener = document.getElementById('share-btn') as HTMLButtonElement;
    opener.focus();
    tour.start();
    q<HTMLButtonElement>('[data-tour-skip]').click();
    expect(tour.isOpen()).toBe(false);
    expect(document.activeElement).toBe(opener);

    // Help > Show tour opens it again even after it's been seen.
    tour.start();
    expect(tour.isOpen()).toBe(true);
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(tour.isOpen()).toBe(false);
    expect(document.querySelector('.tour-highlight')).toBeNull();
  });

  it('skips steps whose part of the page is hidden', () => {
    const { tour, q } = setup();
    (document.getElementById('toolbar') as HTMLElement).style.display = 'none';
    tour.start();
    q<HTMLButtonElement>('[data-tour-next]').click();
    expect(q('[data-tour-title]').textContent).toBe('Files');
    expect(q('[data-tour-count]').textContent).toBe(`2 of ${tour.stepCount() - 1}`);
    window.dispatchEvent(new Event('resize'));
    tour.close();
  });
});
