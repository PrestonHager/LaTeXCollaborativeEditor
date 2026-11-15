/** Popovers stay this far inside the window edge: half of `--viewport-gutter` (docs/ui-sizing.md). */
export const EDGE_GAP = 16;

/**
 * Pull an open popover back inside the window when it would run past the right edge, by setting
 * `--popover-shift`, which style.css adds to its `margin-inline-start`. Its width is capped at the
 * window minus `--viewport-gutter` in CSS, so a shift is all it needs (#186: at 390px the File menu
 * ran 54px off-screen, and the Share popover did too once Share moved up beside the Menu button).
 * It also sets `--popover-room`, the height left between the popover's top and the bottom of the window,
 * which `.menu-popover` uses as its max-height. Call it right after the popover opens.
 */
export function keepOnScreen(popover: HTMLElement) {
  popover.style.removeProperty('--popover-shift');
  // Offsets, not the popover's own box: it's still scaled down at this point, while it animates open.
  const parentBox = (popover.offsetParent as HTMLElement | null)?.getBoundingClientRect();
  const left = (parentBox?.left ?? 0) + popover.offsetLeft;
  const overflow = left + popover.offsetWidth - (window.innerWidth - EDGE_GAP);
  if (overflow > 0) popover.style.setProperty('--popover-shift', `${-Math.min(overflow, Math.max(left - EDGE_GAP, 0))}px`);
  // The room left below the popover's top. Menus use it as their max-height and scroll inside it (#191:
  // with 44px touch rows on a tablet, the File menu ran about 340px past the bottom of a 768px-tall window).
  const top = (parentBox?.top ?? 0) + popover.offsetTop;
  popover.style.setProperty('--popover-room', `${Math.max(Math.floor(window.innerHeight - top - EDGE_GAP), 0)}px`);
}
