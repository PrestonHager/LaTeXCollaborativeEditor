import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachTouchTooltips, LONG_PRESS_MOVE_TOLERANCE, LONG_PRESS_MS, onLongPress, TOUCH_TOOLTIP_MS } from './longPress';

// jsdom has no PointerEvent, so give a plain event the fields the code reads.
function pointer(target: EventTarget, type: string, init: { pointerType?: string; pointerId?: number; x?: number; y?: number; isPrimary?: boolean } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerType: init.pointerType ?? 'touch',
    pointerId: init.pointerId ?? 1,
    clientX: init.x ?? 10,
    clientY: init.y ?? 10,
    isPrimary: init.isPrimary ?? true,
  });
  target.dispatchEvent(event);
  return event;
}

function click(target: EventTarget, type = 'click') {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('onLongPress', () => {
  let root: HTMLElement;
  let row: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<ul id="root"><li><button class="row">a</button></li><li class="other">b</li></ul>';
    root = document.getElementById('root')!;
    row = root.querySelector('.row')!;
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('fires once a finger has rested for the delay, at the point it went down', () => {
    const onPress = vi.fn();
    onLongPress(root, onPress, { selector: '.row' });
    pointer(row, 'pointerdown', { x: 40, y: 50 });
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(onPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onPress).toHaveBeenCalledWith(row, { clientX: 40, clientY: 50 });
  });

  it('is a tap, not a long-press, when the finger lifts early, and the tap still clicks', () => {
    const onPress = vi.fn();
    onLongPress(root, onPress, { selector: '.row' });
    pointer(row, 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS - 100);
    pointer(row, 'pointerup');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onPress).not.toHaveBeenCalled();
    expect(click(row).defaultPrevented).toBe(false);
  });

  it('allows a little drift, but a scroll or drag cancels it', () => {
    const onPress = vi.fn();
    onLongPress(root, onPress, { selector: '.row' });
    pointer(row, 'pointerdown', { x: 10, y: 10 });
    pointer(row, 'pointermove', { x: 10 + LONG_PRESS_MOVE_TOLERANCE, y: 10 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onPress).toHaveBeenCalledTimes(1);

    pointer(row, 'pointerdown', { x: 10, y: 10 });
    pointer(row, 'pointermove', { x: 10, y: 10 + LONG_PRESS_MOVE_TOLERANCE + 1 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('ignores moves and lifts from another finger', () => {
    const onPress = vi.fn();
    onLongPress(root, onPress, { selector: '.row' });
    pointer(row, 'pointerdown', { pointerId: 1 });
    pointer(row, 'pointermove', { pointerId: 2, x: 300 });
    pointer(row, 'pointerup', { pointerId: 2 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is cancelled when the browser takes the touch over', () => {
    const onPress = vi.fn();
    onLongPress(root, onPress, { selector: '.row' });
    pointer(row, 'pointerdown');
    pointer(row, 'pointercancel');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('only starts for touch and pen, the primary pointer, and matching elements', () => {
    const onPress = vi.fn();
    onLongPress(root, onPress, { selector: '.row' });
    pointer(row, 'pointerdown', { pointerType: 'mouse' });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    pointer(row, 'pointerdown', { isPrimary: false });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    pointer(root.querySelector('.other')!, 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onPress).not.toHaveBeenCalled();
    pointer(row, 'pointerdown', { pointerType: 'pen' });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('swallows the click and the native menu that follow a long-press, then lets clicks through again', () => {
    const onPress = vi.fn();
    const onClick = vi.fn();
    row.addEventListener('click', onClick);
    onLongPress(root, onPress);
    pointer(row, 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onPress).toHaveBeenCalledWith(root, expect.anything());
    expect(click(row, 'contextmenu').defaultPrevented).toBe(true);
    pointer(row, 'pointerup');
    expect(click(row).defaultPrevented).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
    expect(click(row).defaultPrevented).toBe(false);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('stops swallowing after a moment, even when no click came', () => {
    onLongPress(root, vi.fn(), { delayMs: 100 });
    pointer(row, 'pointerdown');
    vi.advanceTimersByTime(100);
    vi.advanceTimersByTime(1000);
    expect(click(row).defaultPrevented).toBe(false);
  });

  it("doesn't fire for an element the page removed while the finger was down", () => {
    const onPress = vi.fn();
    onLongPress(root, onPress, { selector: '.row' });
    pointer(row, 'pointerdown');
    row.remove();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('removes its listeners', () => {
    const onPress = vi.fn();
    const stop = onLongPress(root, onPress);
    pointer(row, 'pointerdown');
    stop();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    pointer(row, 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('attachTouchTooltips', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="bar"><button id="save" data-tooltip="Save now (Ctrl+S)"></button><button id="empty" data-tooltip=""></button></div>';
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('shows the tooltip on long-press without running the button, then hides it', () => {
    const save = document.getElementById('save')!;
    const run = vi.fn();
    save.addEventListener('click', run);
    attachTouchTooltips(document.getElementById('bar')!);
    pointer(save, 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(save.dataset.touchTooltip).toBe('open');
    pointer(save, 'pointerup');
    click(save);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(TOUCH_TOOLTIP_MS);
    expect(save.dataset.touchTooltip).toBeUndefined();
  });

  it('hides on the next touch, and skips buttons with no tooltip text', () => {
    const save = document.getElementById('save')!;
    const empty = document.getElementById('empty')!;
    const stop = attachTouchTooltips(document.getElementById('bar')!);
    pointer(save, 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    pointer(document.body, 'pointerdown');
    expect(save.dataset.touchTooltip).toBeUndefined();
    pointer(empty, 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(empty.dataset.touchTooltip).toBeUndefined();
    stop();
    pointer(save, 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(save.dataset.touchTooltip).toBeUndefined();
  });
});
