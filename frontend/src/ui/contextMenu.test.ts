import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContextMenu } from './contextMenu';

const key = (target: Element, name: string) => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

function setup() {
  document.body.innerHTML = '<button id="row">main.tex</button><p id="elsewhere">x</p>';
  const row = document.getElementById('row') as HTMLButtonElement;
  row.focus();
  const menu = createContextMenu();
  const rename = vi.fn();
  const remove = vi.fn();
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  menu.open(
    [
      { label: 'Rename or move', icon, run: rename },
      { label: 'Delete', destructive: true, run: remove },
    ],
    { clientX: 30, clientY: 40 },
    'Actions for main.tex',
  );
  const items = () => Array.from(menu.element.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
  return { menu, row, rename, remove, items };
}

describe('context menu', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('opens at the point as a labelled menu, with focus on the first item', () => {
    const { menu, items } = setup();
    expect(menu.isOpen).toBe(true);
    expect(menu.element.getAttribute('role')).toBe('menu');
    expect(menu.element.getAttribute('aria-label')).toBe('Actions for main.tex');
    expect(items().map((item) => item.textContent)).toEqual(['Rename or move', 'Delete']);
    expect(items()[0].querySelector('svg')).not.toBeNull();
    expect(items()[1].dataset.variant).toBe('destructive');
    expect(document.activeElement).toBe(items()[0]);
    expect(menu.element.style.left).toBe('30px');
    expect(menu.element.style.top).toBe('40px');
  });

  it('flips and clamps to stay inside the window', () => {
    document.body.innerHTML = '';
    const menu = createContextMenu();
    Object.defineProperty(menu.element, 'offsetWidth', { value: 240 });
    Object.defineProperty(menu.element, 'offsetHeight', { value: 100 });
    menu.open([{ label: 'Delete', run: () => undefined }], { clientX: window.innerWidth - 20, clientY: window.innerHeight - 20 }, 'x');
    expect(menu.element.style.left).toBe(`${window.innerWidth - 20 - 240}px`);
    expect(menu.element.style.top).toBe(`${window.innerHeight - 20 - 100}px`);
    menu.open([{ label: 'Delete', run: () => undefined }], { clientX: 100, clientY: 0 }, 'x');
    expect(menu.element.style.left).toBe('100px');
    expect(menu.element.style.top).toBe('12px');
  });

  it('runs an item on click and closes', () => {
    const { menu, items, remove } = setup();
    items()[1].click();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(menu.isOpen).toBe(false);
    expect(menu.element.children).toHaveLength(0);
  });

  it('moves with the arrow keys, Home and End, wrapping around', () => {
    const { menu, items } = setup();
    key(menu.element, 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    key(menu.element, 'ArrowDown');
    expect(document.activeElement).toBe(items()[0]);
    key(menu.element, 'ArrowUp');
    expect(document.activeElement).toBe(items()[1]);
    key(menu.element, 'Home');
    expect(document.activeElement).toBe(items()[0]);
    key(menu.element, 'End');
    expect(document.activeElement).toBe(items()[1]);
    expect(key(menu.element, 'x').defaultPrevented).toBe(false);
  });

  it('closes on Escape and Tab, putting focus back', () => {
    const { menu, row } = setup();
    expect(key(menu.element, 'Escape').defaultPrevented).toBe(true);
    expect(menu.isOpen).toBe(false);
    expect(document.activeElement).toBe(row);

    const again = setup();
    key(again.menu.element, 'Tab');
    expect(again.menu.isOpen).toBe(false);
    expect(document.activeElement).toBe(again.row);
  });

  it('closes on a press outside it, on resize, and not on a press inside it', () => {
    const { menu, items } = setup();
    items()[0].dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(menu.isOpen).toBe(true);
    document.getElementById('elsewhere')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(menu.isOpen).toBe(false);
    menu.close();

    const again = setup();
    window.dispatchEvent(new Event('resize'));
    expect(again.menu.isOpen).toBe(false);
  });

  it('stays closed with nothing to show', () => {
    document.body.innerHTML = '';
    const menu = createContextMenu();
    menu.open([], { clientX: 0, clientY: 0 }, 'x');
    expect(menu.isOpen).toBe(false);
  });
});
