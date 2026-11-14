/** Popovers stay this far inside the window edge: half of `--viewport-gutter` (docs/ui-sizing.md). */
export const EDGE_GAP = 16;

/**
 * Pull an open popover back inside the window when it would run past the right edge, by setting
 * `--popover-shift`, which style.css adds to its `margin-inline-start`. Its width is capped at the
 * window minus `--viewport-gutter` in CSS, so a shift is all it needs (#186: at 390px the File menu
 * ran 54px off-screen, and the Share popover did too once Share moved up beside the Menu button).
 * Call it right after the popover opens.
 */
export function keepOnScreen(popover: HTMLElement) {
  popover.style.removeProperty('--popover-shift');
  // Offsets, not the popover's own box: it's still scaled down at this point, while it animates open.
  const parentLeft = (popover.offsetParent as HTMLElement | null)?.getBoundingClientRect().left ?? 0;
  const left = parentLeft + popover.offsetLeft;
  const overflow = left + popover.offsetWidth - (window.innerWidth - EDGE_GAP);
  if (overflow > 0) popover.style.setProperty('--popover-shift', `${-Math.min(overflow, Math.max(left - EDGE_GAP, 0))}px`);
}
