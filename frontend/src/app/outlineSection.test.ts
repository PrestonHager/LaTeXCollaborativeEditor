import { createOutlineSection, OUTLINE_OPEN_KEY } from './outlineSection';

function elements(stored: string | null = null) {
  const section = document.createElement('nav');
  const toggle = document.createElement('button');
  const list = document.createElement('ol');
  section.append(toggle, list);
  const store = new Map<string, string>(stored === null ? [] : [[OUTLINE_OPEN_KEY, stored]]);
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
  const mounted = { refresh: vi.fn(), dispose: vi.fn() };
  const mountOutline = vi.fn(() => mounted);
  const load = vi.fn(async () => ({ mountOutline }));
  const host = { project: () => null, open: vi.fn() };
  return { section, toggle, list, store, storage, mounted, mountOutline, load, host };
}

describe('createOutlineSection', () => {
  it('starts closed without loading anything, and loads the outline once opened', async () => {
    const e = elements();
    const outline = createOutlineSection(e);
    await outline.ready();
    expect(outline.open).toBe(false);
    expect(e.toggle.getAttribute('aria-expanded')).toBe('false');
    expect(e.list.hidden).toBe(true);
    expect(e.load).not.toHaveBeenCalled();
    outline.refresh();

    e.toggle.click();
    await outline.ready();
    expect(e.section.classList.contains('is-open')).toBe(true);
    expect(e.list.hidden).toBe(false);
    expect(e.mountOutline).toHaveBeenCalledWith(e.list, e.host);
    expect(e.store.get(OUTLINE_OPEN_KEY)).toBe('1');
    outline.refresh();
    expect(e.mounted.refresh).toHaveBeenCalled();

    // Closing and opening again doesn't load or mount twice.
    e.toggle.click();
    expect(e.list.hidden).toBe(true);
    expect(e.store.get(OUTLINE_OPEN_KEY)).toBe('0');
    e.toggle.click();
    await outline.ready();
    expect(e.load).toHaveBeenCalledTimes(1);
    expect(e.mountOutline).toHaveBeenCalledTimes(1);
  });

  it('opens on load when it was left open', async () => {
    const e = elements('1');
    const outline = createOutlineSection(e);
    await outline.ready();
    expect(outline.open).toBe(true);
    expect(e.mountOutline).toHaveBeenCalled();
  });

  it('says so when the outline fails to load, and tries again next time', async () => {
    const e = elements('1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    e.load.mockRejectedValueOnce(new Error('offline'));
    const outline = createOutlineSection(e);
    await outline.ready();
    expect(e.list.textContent).toBe("The outline couldn't load. Close and open it to try again.");
    e.toggle.click();
    e.toggle.click();
    await outline.ready();
    expect(e.mountOutline).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('copes with storage that throws', async () => {
    const e = elements();
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const outline = createOutlineSection({ ...e, storage: broken });
    expect(outline.open).toBe(false);
    e.toggle.click();
    expect(outline.open).toBe(true);
    await outline.ready();
    // Without a storage argument it uses localStorage.
    const plain = elements();
    localStorage.setItem(OUTLINE_OPEN_KEY, '1');
    const fromLocal = createOutlineSection({ section: plain.section, toggle: plain.toggle, list: plain.list, load: plain.load, host: plain.host });
    expect(fromLocal.open).toBe(true);
    localStorage.removeItem(OUTLINE_OPEN_KEY);
  });
});
