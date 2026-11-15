import { keepOnScreen } from './keepOnScreen';

describe('keepOnScreen', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  });

  /** A popover in a positioned parent at `parentLeft`, `offsetLeft` into it and `offsetWidth` wide. */
  const popover = (parentLeft: number, offsetLeft: number, offsetWidth: number) => {
    const parent = document.createElement('div');
    parent.getBoundingClientRect = () => ({ left: parentLeft } as DOMRect);
    const el = parent.appendChild(document.createElement('div'));
    Object.defineProperty(el, 'offsetParent', { configurable: true, get: () => parent });
    Object.defineProperty(el, 'offsetLeft', { configurable: true, get: () => offsetLeft });
    Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => offsetWidth });
    return el;
  };

  it('shifts a popover left by how far it runs past the window, less the edge gap', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    // The File menu at 390px: 110 to 444.
    const el = popover(100, 10, 334);
    keepOnScreen(el);
    expect(el.style.getPropertyValue('--popover-shift')).toBe('-70px');
  });

  it('leaves a popover that fits alone, and clears an old shift', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    const el = popover(100, 10, 334);
    el.style.setProperty('--popover-shift', '-70px');
    keepOnScreen(el);
    expect(el.style.getPropertyValue('--popover-shift')).toBe('');
  });

  it('never pushes a popover past the left edge gap', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    const el = popover(0, 20, 400);
    keepOnScreen(el);
    expect(el.style.getPropertyValue('--popover-shift')).toBe('-4px');
  });

  it('sets the room below the popover, so a tall menu scrolls instead of running off the bottom (#191)', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    // The File menu on a touch tablet: its parent is the menu bar at y 20, and the menu starts 36px below that.
    const parent = document.createElement('div');
    parent.getBoundingClientRect = () => ({ left: 100, top: 20 } as DOMRect);
    const el = parent.appendChild(document.createElement('div'));
    Object.defineProperty(el, 'offsetParent', { configurable: true, get: () => parent });
    Object.defineProperty(el, 'offsetTop', { configurable: true, get: () => 36 });
    Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => 334 });
    keepOnScreen(el);
    expect(el.style.getPropertyValue('--popover-room')).toBe('696px');
  });

  it('never sets a negative room', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 100 });
    const el = popover(0, 0, 100);
    Object.defineProperty(el, 'offsetTop', { configurable: true, get: () => 200 });
    keepOnScreen(el);
    expect(el.style.getPropertyValue('--popover-room')).toBe('0px');
  });
});
