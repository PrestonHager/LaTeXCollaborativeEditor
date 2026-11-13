import { createTour, hasSeenTour, markTourSeen, TOUR_SEEN_KEY } from './tour';
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
