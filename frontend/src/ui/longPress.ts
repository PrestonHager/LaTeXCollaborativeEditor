/**
 * Long-press for touch screens (#188, part of #123). Touch has no right-click and no hover, so holding
 * a finger still on something does what those do with a mouse: open the file tree's menu, or show a
 * toolbar button's name.
 *
 * Only touch and pen start one. A mouse has a right button and hover for this, and holding the left
 * button is how a drag starts. The press is dropped if the finger moves (it's a scroll or a drag), lifts
 * early (it's a tap), or the browser takes the touch over (pointercancel).
 *
 * When a long-press fires, the click that the finger's lift would send next is swallowed, so the
 * long-press doesn't also open the file or run the button. So is the browser's own context menu, which
 * Android Chrome opens for the same hold.
 */

/** How long a finger has to stay down. Android's own long-press is 400 to 500ms. */
export const LONG_PRESS_MS = 500;
/** How far, in CSS pixels, a finger can drift before the press counts as a scroll or drag instead. */
export const LONG_PRESS_MOVE_TOLERANCE = 10;
/** How long after a long-press the click and context menu it causes are still swallowed. */
const SWALLOW_MS = 800;

export type LongPressPoint = { clientX: number; clientY: number };

type LongPressOptions = {
  delayMs?: number;
  moveTolerance?: number;
  /** Which pointers start a press. Defaults to touch and pen. */
  pointerTypes?: readonly string[];
};

/**
 * Call `onLongPress` when a finger rests on `target` (or anything inside it) for `delayMs`. Pass a
 * `selector` to only start on matching descendants, which then gets passed as the element.
 * Returns a function that removes the listeners.
 */
export function onLongPress(
  target: HTMLElement,
  onPress: (element: HTMLElement, point: LongPressPoint) => void,
  options: LongPressOptions & { selector?: string } = {},
): () => void {
  const delayMs = options.delayMs ?? LONG_PRESS_MS;
  const tolerance = options.moveTolerance ?? LONG_PRESS_MOVE_TOLERANCE;
  const pointerTypes = options.pointerTypes ?? ['touch', 'pen'];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pointerId: number | null = null;
  let start: LongPressPoint = { clientX: 0, clientY: 0 };
  let swallowUntil = 0;

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pointerId = null;
  };

  const onPointerDown = (event: PointerEvent) => {
    cancel();
    if (!pointerTypes.includes(event.pointerType) || event.isPrimary === false) return;
    const element = options.selector ? (event.target as Element | null)?.closest?.<HTMLElement>(options.selector) : target;
    if (!element || !target.contains(element)) return;
    pointerId = event.pointerId;
    start = { clientX: event.clientX, clientY: event.clientY };
    timer = setTimeout(() => {
      timer = null;
      pointerId = null;
      if (!element.isConnected) return;
      swallowUntil = Date.now() + SWALLOW_MS;
      onPress(element, start);
    }, delayMs);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (timer === null || event.pointerId !== pointerId) return;
    if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > tolerance) cancel();
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (event.pointerId === pointerId) cancel();
  };

  // The finger lifting after a long-press still clicks. Swallow that one click, and Android's own menu.
  const swallow = (event: Event) => {
    if (Date.now() > swallowUntil) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'click') swallowUntil = 0;
  };

  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerup', onPointerEnd);
  target.addEventListener('pointercancel', onPointerEnd);
  target.addEventListener('pointerleave', onPointerEnd);
  target.addEventListener('click', swallow, true);
  target.addEventListener('contextmenu', swallow, true);

  return () => {
    cancel();
    target.removeEventListener('pointerdown', onPointerDown);
    target.removeEventListener('pointermove', onPointerMove);
    target.removeEventListener('pointerup', onPointerEnd);
    target.removeEventListener('pointercancel', onPointerEnd);
    target.removeEventListener('pointerleave', onPointerEnd);
    target.removeEventListener('click', swallow, true);
    target.removeEventListener('contextmenu', swallow, true);
  };
}

/** How long a tooltip opened by a long-press stays up. */
export const TOUCH_TOOLTIP_MS = 1500;

/**
 * The touch fallback for tooltips (#188). On a touch screen a tap would leave a CSS tooltip stuck on,
 * so style.css hides them under `(hover: none)`. Holding a finger on a button with a `data-tooltip`
 * shows its name and shortcut for a moment instead, without running it. The hover preview cards (#89)
 * stay mouse and keyboard only: the command palette has the same descriptions.
 */
export function attachTouchTooltips(root: HTMLElement, selector = '[data-tooltip]', options: LongPressOptions = {}) {
  let shown: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const hide = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (shown) delete shown.dataset.touchTooltip;
    shown = null;
  };
  const stop = onLongPress(
    root,
    (element) => {
      hide();
      if (!element.dataset.tooltip) return;
      shown = element;
      element.dataset.touchTooltip = 'open';
      timer = setTimeout(hide, TOUCH_TOOLTIP_MS);
    },
    { ...options, selector },
  );
  // The next touch anywhere puts it away.
  const doc = root.ownerDocument;
  const onDown = () => {
    if (shown) hide();
  };
  doc.addEventListener('pointerdown', onDown, true);
  return () => {
    hide();
    stop();
    doc.removeEventListener('pointerdown', onDown, true);
  };
}
