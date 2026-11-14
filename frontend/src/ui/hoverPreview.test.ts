import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHoverPreview, HOVER_PREVIEW_DELAY_MS, type MockRenderer } from './hoverPreview';
import type { CommandId } from './menuBar';

const pointer = (el: Element, type: string, pointerType = 'mouse') => {
  const event = new Event(type, { bubbles: type === 'pointerdown' });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  el.dispatchEvent(event);
};
const key = (keyName: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true }));

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

function setup(opts: Partial<Parameters<typeof createHoverPreview>[1]> = {}) {
  document.body.innerHTML = `
    <div id="menu-bar">
      <div class="menu-root"><div data-popover aria-hidden="false">
        <button class="menu-item" data-command="file.saveNow" data-description="Save right away."><span class="menu-item-label">Save Now</span></button>
        <button class="menu-item" data-command="edit.undo"><span class="menu-item-label">Undo</span></button>
      </div></div>
      <div class="menu-root"><div data-popover aria-hidden="true">
        <button class="menu-item" data-command="help.about" data-description="About."><span class="menu-item-label">About</span></button>
      </div></div>
    </div>
    <div id="toolbar">
      <button data-command="view.layoutSplit" aria-label="Split view" data-tooltip-text="Split view"></button>
      <button data-command="help.documentation" aria-label="Documentation"></button>
    </div>
    <div id="hover-preview"></div>`;
  const card = document.getElementById('hover-preview')!;
  const descriptions: Partial<Record<CommandId, string>> = { 'view.layoutSplit': 'Show the editor and preview side by side.' };
  const preview = createHoverPreview(card, {
    description: (id) => descriptions[id],
    shortcutLabel: (id) => (id === 'file.saveNow' ? 'Ctrl+S' : undefined),
    ...opts,
  });
  preview.attach(document.getElementById('menu-bar')!, '.menu-item[data-command]', 'right');
  preview.attach(document.getElementById('toolbar')!, 'button[data-command]', 'bottom');
  const byCommand = (id: string) => document.querySelector<HTMLElement>(`[data-command="${id}"]`)!;
  return { card, preview, byCommand };
}

describe('hover preview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('shows after the delay with the title, keybind and description, and hides as soon as the pointer leaves', () => {
    const { card, preview, byCommand } = setup();
    const save = byCommand('file.saveNow');
    expect(card.hidden).toBe(true);
    expect(card.getAttribute('role')).toBe('tooltip');

    pointer(save, 'pointerenter');
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS - 1);
    expect(card.hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(card.hidden).toBe(false);
    expect(preview.current).toBe(save);
    expect(card.querySelector('.hover-preview-title')?.textContent).toBe('Save Now');
    expect(card.querySelector('.hover-preview-shortcut')?.textContent).toBe('Ctrl+S');
    expect(card.querySelector('.hover-preview-text')?.textContent).toBe('Save right away.');
    expect(save.getAttribute('aria-describedby')).toBe('hover-preview-description');
    expect(save.dataset.hoverPreview).toBe('open');
    expect(card.dataset.side).toBe('right');

    pointer(save, 'pointerleave');
    expect(card.hidden).toBe(true);
    expect(card.childElementCount).toBe(0);
    expect(save.hasAttribute('aria-describedby')).toBe(false);
    expect(save.dataset.hoverPreview).toBeUndefined();
  });

  it('never shows when the pointer leaves before the delay', () => {
    const { card, byCommand } = setup();
    const save = byCommand('file.saveNow');
    pointer(save, 'pointerenter');
    vi.advanceTimersByTime(300);
    pointer(save, 'pointerleave');
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS * 2);
    expect(card.hidden).toBe(true);
  });

  it('ignores touch, since a tap has no hover', () => {
    const { card, byCommand } = setup();
    pointer(byCommand('file.saveNow'), 'pointerenter', 'touch');
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS * 2);
    expect(card.hidden).toBe(true);
  });

  it('never shows for a touch, even when focus moves after typing on a soft keyboard (#188)', () => {
    const { card, byCommand } = setup();
    const save = byCommand('file.saveNow');
    // Typing in the editor with the on-screen keyboard counts as keyboard use...
    key('a');
    // ...but a tap resets that, so the focus the tap (or the menu it opens) moves doesn't preview.
    pointer(save, 'pointerdown', 'touch');
    pointer(save, 'pointerenter', 'touch');
    save.dispatchEvent(new FocusEvent('focusin'));
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS * 2);
    expect(card.hidden).toBe(true);
    expect(save.hasAttribute('aria-describedby')).toBe(false);
  });

  it('never runs the command on hover, and hides on press and click', () => {
    const { card, byCommand } = setup();
    const save = byCommand('file.saveNow');
    const onClick = vi.fn();
    save.addEventListener('click', onClick);
    pointer(save, 'pointerenter');
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS);
    expect(card.hidden).toBe(false);
    expect(onClick).not.toHaveBeenCalled();

    pointer(save, 'pointerdown');
    expect(card.hidden).toBe(true);

    pointer(save, 'pointerleave');
    pointer(save, 'pointerenter');
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS);
    expect(card.hidden).toBe(false);
    save.click();
    expect(card.hidden).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows for keyboard focus, but not for focus that follows a click', () => {
    const { card, byCommand } = setup();
    const save = byCommand('file.saveNow');
    const undo = byCommand('edit.undo');
    const split = byCommand('view.layoutSplit');

    pointer(document.body, 'pointerdown');
    split.focus();
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS * 2);
    expect(card.hidden).toBe(true);
    split.blur();

    key('Tab');
    save.focus();
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS);
    expect(card.hidden).toBe(false);

    // Arrowing on in a menu hides this card and shows the next one sooner.
    key('ArrowDown');
    expect(card.hidden).toBe(false);
    undo.focus();
    expect(card.hidden).toBe(true);
    vi.advanceTimersByTime(150);
    // Undo has no description and no picture, so there's nothing to show.
    expect(card.hidden).toBe(true);

    split.focus();
    vi.advanceTimersByTime(150);
    expect(card.hidden).toBe(false);
    expect(card.querySelector('.hover-preview-title')?.textContent).toBe('Split view');
    expect(card.querySelector('.hover-preview-text')?.textContent).toBe('Show the editor and preview side by side.');

    // Any other key, like Enter to run it, gets the card out of the way.
    key('Enter');
    expect(card.hidden).toBe(true);
  });

  it('hides when focus leaves, the window resizes, or the window loses focus', () => {
    const { card, byCommand } = setup();
    const save = byCommand('file.saveNow');
    const showSave = () => {
      key('Tab');
      save.focus();
      vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS);
      expect(card.hidden).toBe(false);
    };
    showSave();
    save.blur();
    expect(card.hidden).toBe(true);
    for (const fire of [() => window.dispatchEvent(new Event('resize')), () => window.dispatchEvent(new Event('blur'))]) {
      vi.advanceTimersByTime(1000);
      showSave();
      fire();
      expect(card.hidden).toBe(true);
      save.blur();
    }
  });

  it("skips items in a closed menu and buttons with nothing to say", () => {
    const { card, byCommand } = setup();
    pointer(byCommand('help.about'), 'pointerenter');
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS);
    expect(card.hidden).toBe(true);
    pointer(byCommand('help.documentation'), 'pointerenter');
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS);
    expect(card.hidden).toBe(true);
  });

  it('moving straight to the next button shows its card after a short wait', () => {
    const { card, byCommand } = setup();
    const save = byCommand('file.saveNow');
    const split = byCommand('view.layoutSplit');
    pointer(save, 'pointerenter');
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS);
    // Entering the next one before leaving the last still swaps the card.
    pointer(split, 'pointerenter');
    expect(card.hidden).toBe(true);
    vi.advanceTimersByTime(150);
    expect(card.hidden).toBe(false);
    expect(save.dataset.hoverPreview).toBeUndefined();
    // Entering the same button again doesn't restart anything.
    pointer(split, 'pointerenter');
    expect(card.hidden).toBe(false);
    pointer(split, 'pointerleave');
    // Long after, it's the full delay again.
    vi.advanceTimersByTime(1000);
    pointer(save, 'pointerenter');
    vi.advanceTimersByTime(150);
    expect(card.hidden).toBe(true);
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS);
    expect(card.hidden).toBe(false);
  });

  it('adds the picture once the lazy chunk loads, and keeps showing text if it fails', async () => {
    const renderMock: MockRenderer = (id) => (id === 'view.layoutSplit' || id === 'help.documentation' ? document.createElement('div') : null);
    let fail = true;
    const loadMocks = vi.fn(() => (fail ? Promise.reject(new Error('offline')) : Promise.resolve(renderMock)));
    const { card, byCommand } = setup({ loadMocks });
    const split = byCommand('view.layoutSplit');
    const docs = byCommand('help.documentation');

    pointer(split, 'pointerenter');
    await vi.advanceTimersByTimeAsync(HOVER_PREVIEW_DELAY_MS);
    expect(card.hidden).toBe(false);
    expect(card.querySelector('.hover-preview-mock')).toBeNull();
    pointer(split, 'pointerleave');

    // A failed load is tried again on the next hover. The card that's showing gets its picture.
    fail = false;
    await vi.advanceTimersByTimeAsync(1000);
    pointer(split, 'pointerenter');
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS);
    await vi.advanceTimersByTimeAsync(0);
    const mock = card.querySelector('.hover-preview-mock');
    expect(mock?.getAttribute('aria-hidden')).toBe('true');
    expect(loadMocks).toHaveBeenCalledTimes(2);
    pointer(split, 'pointerleave');

    // A picture alone is enough, with no description to point at.
    pointer(docs, 'pointerenter');
    await vi.advanceTimersByTimeAsync(HOVER_PREVIEW_DELAY_MS);
    expect(card.hidden).toBe(false);
    expect(card.querySelector('.hover-preview-mock')).not.toBeNull();
    expect(card.querySelector('.hover-preview-text')).toBeNull();
    expect(docs.hasAttribute('aria-describedby')).toBe(false);
    expect(loadMocks).toHaveBeenCalledTimes(2);
  });

  it('sits beside the menu, flips left at the window edge, and stays on screen under the toolbar', () => {
    const { card, byCommand } = setup();
    Object.defineProperty(card, 'offsetWidth', { configurable: true, value: 352 });
    Object.defineProperty(card, 'offsetHeight', { configurable: true, value: 200 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const save = byCommand('file.saveNow');
    const menu = save.closest<HTMLElement>('[data-popover]')!;
    save.getBoundingClientRect = () => rect(10, 100, 240, 30);
    menu.getBoundingClientRect = () => rect(10, 90, 240, 300);
    pointer(save, 'pointerenter');
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS);
    expect([card.style.left, card.style.top]).toEqual(['256px', '100px']);
    pointer(save, 'pointerleave');

    menu.getBoundingClientRect = () => rect(1000, 90, 240, 300);
    save.getBoundingClientRect = () => rect(1000, 700, 240, 30);
    vi.advanceTimersByTime(1000);
    pointer(save, 'pointerenter');
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS);
    expect([card.style.left, card.style.top]).toEqual([`${1000 - 6 - 352}px`, `${800 - 12 - 200}px`]);
    pointer(save, 'pointerleave');

    const split = byCommand('view.layoutSplit');
    split.getBoundingClientRect = () => rect(1250, 40, 28, 28);
    vi.advanceTimersByTime(1000);
    pointer(split, 'pointerenter');
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS);
    expect([card.style.left, card.style.top]).toEqual([`${1280 - 12 - 352}px`, '74px']);
    expect(card.dataset.side).toBe('bottom');
  });

  it('stays up while the page scrolls, and follows its button when that scroll moves it', () => {
    const { card, byCommand } = setup();
    const save = byCommand('file.saveNow');
    const menu = save.closest<HTMLElement>('[data-popover]')!;
    menu.getBoundingClientRect = () => rect(10, 90, 240, 300);
    let top = 100;
    save.getBoundingClientRect = () => rect(10, top, 240, 30);
    pointer(save, 'pointerenter');
    // A scroll while waiting doesn't cancel it (the app scrolls a little as a menu opens).
    vi.advanceTimersByTime(300);
    document.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS);
    expect(card.hidden).toBe(false);
    expect(card.style.top).toBe('100px');

    // Scrolling something else, like the editor, leaves the card where it is.
    top = 150;
    document.getElementById('toolbar')!.dispatchEvent(new Event('scroll'));
    expect(card.style.top).toBe('100px');
    // Scrolling the menu or the page moves it with the button.
    menu.dispatchEvent(new Event('scroll'));
    expect(card.style.top).toBe('150px');
    top = 120;
    document.dispatchEvent(new Event('scroll'));
    expect(card.style.top).toBe('120px');
    expect(card.hidden).toBe(false);
  });

  it('destroy stops listening', () => {
    const { card, preview, byCommand } = setup();
    const save = byCommand('file.saveNow');
    pointer(save, 'pointerenter');
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS);
    preview.destroy();
    expect(card.hidden).toBe(true);
    pointer(save, 'pointerenter');
    vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS);
    expect(card.hidden).toBe(true);
    // Attaching twice doesn't double up.
    preview.attach(document.getElementById('menu-bar')!, '.menu-item[data-command]', 'right');
    preview.attach(document.getElementById('menu-bar')!, '.menu-item[data-command]', 'right');
  });
});
