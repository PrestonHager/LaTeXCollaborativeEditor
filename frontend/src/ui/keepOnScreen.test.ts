import { keepOnScreen } from './keepOnScreen';

describe('keepOnScreen', () => {
  const width = window.innerWidth;
  afterEach(() => Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }));

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
});
