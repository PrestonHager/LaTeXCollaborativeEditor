import type { CommandId } from './menuBar';

/** Draws a small picture of what a command does, or null when a picture wouldn't help. */
export type MockRenderer = (commandId: CommandId) => HTMLElement | null;

/** Where the card goes: beside a menu item's menu, or under a toolbar button. */
export type PreviewSide = 'right' | 'bottom';

type HoverPreviewOptions = {
  /** What the command does, when the button has no data-description of its own (the menu item's text). */
  description: (commandId: CommandId) => string | undefined;
  /** The command's keybind label, if it has one. */
  shortcutLabel?: (commandId: CommandId) => string | undefined;
  /** Loads the pictures. They're a lazy chunk; until it arrives, or if it fails, the card shows text. */
  loadMocks?: () => Promise<MockRenderer>;
  /** How long the pointer or keyboard focus rests on a button before the card shows. */
  delayMs?: number;
  /** The shorter wait when moving straight from one button to the next while a card was showing. */
  warmDelayMs?: number;
};

/** Longer than the toolbar tooltip, which shows as soon as the pointer arrives. */
export const HOVER_PREVIEW_DELAY_MS = 800;
const WARM_DELAY_MS = 150;
/** How long after a card hides the next one still counts as "moving along the menu". */
const WARM_WINDOW_MS = 400;
const EDGE = 12;
const GAP = 6;

/**
 * The preview card for menu items and toolbar buttons (#89). Resting the mouse on one, or reaching it
 * with the keyboard, shows a small picture of what the command does and its palette description,
 * after a longer delay than the tooltip. It hides as soon as the pointer leaves, focus moves on, or
 * anything is pressed, and follows its button if the page scrolls. It never runs a command: only a click does, and that goes to the button's
 * own handler.
 *
 * Touch has no hover, so a tap never shows it (#188 covers touch). The card ignores the pointer,
 * so it can't catch a hover or a click meant for what's underneath.
 */
export function createHoverPreview(card: HTMLElement, options: HoverPreviewOptions) {
  const delayMs = options.delayMs ?? HOVER_PREVIEW_DELAY_MS;
  const warmDelayMs = options.warmDelayMs ?? WARM_DELAY_MS;
  const sides = new Map<HTMLElement, PreviewSide>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let shownFor: HTMLElement | null = null;
  let warmUntil = 0;
  let usingKeyboard = false;
  let renderMock: MockRenderer | null = null;
  let mocksRequested = false;
  const descriptionId = `${card.id || 'hover-preview'}-description`;

  card.hidden = true;
  card.setAttribute('role', 'tooltip');

  const requestMocks = () => {
    if (mocksRequested || !options.loadMocks) return;
    mocksRequested = true;
    options.loadMocks().then(
      (render) => {
        renderMock = render;
        // A card that showed as text while the pictures loaded gets its picture now.
        if (shownFor) show(shownFor);
      },
      // Text only, then. Try again on the next hover, say once back online.
      () => {
        mocksRequested = false;
      },
    );
  };

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const hide = () => {
    cancel();
    if (!shownFor) return;
    warmUntil = Date.now() + WARM_WINDOW_MS;
    shownFor.removeAttribute('aria-describedby');
    delete shownFor.dataset.hoverPreview;
    shownFor = null;
    card.hidden = true;
    card.replaceChildren();
  };

  /** A button in a closed menu is still in the page, just invisible. */
  const isVisible = (target: HTMLElement) => target.isConnected && !target.closest('[aria-hidden="true"], [hidden], [inert]');

  const titleOf = (target: HTMLElement) =>
    target.querySelector('.menu-item-label')?.textContent?.trim() || target.dataset.tooltipText || target.getAttribute('aria-label') || '';

  const place = (target: HTMLElement, side: PreviewSide) => {
    const rect = target.getBoundingClientRect();
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    let left: number;
    let top: number;
    if (side === 'right') {
      // Beside the whole menu, not just the item, so the card never covers the other items.
      const menu = (target.closest('[data-popover]') ?? target).getBoundingClientRect();
      left = menu.right + GAP;
      if (left + width > window.innerWidth - EDGE) left = menu.left - GAP - width;
      top = rect.top;
    } else {
      left = rect.left;
      top = rect.bottom + GAP;
    }
    left = Math.max(EDGE, Math.min(left, window.innerWidth - EDGE - width));
    top = Math.max(EDGE, Math.min(top, window.innerHeight - EDGE - height));
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  };

  const show = (target: HTMLElement) => {
    timer = null;
    if (!isVisible(target)) return;
    const commandId = target.dataset.command as CommandId;
    const description = target.dataset.description ?? options.description(commandId);
    const mock = renderMock?.(commandId) ?? null;
    if (!description && !mock) return;

    const header = document.createElement('div');
    header.className = 'hover-preview-header';
    const title = document.createElement('span');
    title.className = 'hover-preview-title';
    title.textContent = titleOf(target);
    header.append(title);
    const shortcut = options.shortcutLabel?.(commandId);
    if (shortcut) {
      const kbd = document.createElement('kbd');
      kbd.className = 'hover-preview-shortcut';
      kbd.textContent = shortcut;
      header.append(kbd);
    }
    const parts: HTMLElement[] = [header];
    if (mock) {
      // The picture repeats the text, so screen readers only get the text.
      const frame = document.createElement('div');
      frame.className = 'hover-preview-mock';
      frame.setAttribute('aria-hidden', 'true');
      frame.append(mock);
      parts.push(frame);
    }
    if (description) {
      const text = document.createElement('p');
      text.className = 'hover-preview-text';
      text.id = descriptionId;
      text.textContent = description;
      parts.push(text);
    }
    card.replaceChildren(...parts);

    if (shownFor && shownFor !== target) {
      shownFor.removeAttribute('aria-describedby');
      delete shownFor.dataset.hoverPreview;
    }
    shownFor = target;
    // Hides the button's own tooltip (style.css), since the card says the same and more.
    target.dataset.hoverPreview = 'open';
    if (description) target.setAttribute('aria-describedby', descriptionId);
    else target.removeAttribute('aria-describedby');
    card.dataset.side = sides.get(target) ?? 'bottom';
    card.hidden = false;
    place(target, sides.get(target) ?? 'bottom');
  };

  const schedule = (target: HTMLElement) => {
    if (shownFor === target) return;
    const warm = shownFor !== null || Date.now() < warmUntil;
    hide();
    requestMocks();
    timer = setTimeout(() => show(target), warm ? warmDelayMs : delayMs);
  };

  const leave = (target: HTMLElement) => {
    if (shownFor === target || timer !== null) hide();
  };

  const onPointerEnter = (event: PointerEvent) => {
    // A tap fires pointerenter too. Touch has no hover, so it never previews.
    if (event.pointerType === 'touch') return;
    schedule(event.currentTarget as HTMLElement);
  };
  const onPointerLeave = (event: PointerEvent) => leave(event.currentTarget as HTMLElement);
  const onFocusIn = (event: FocusEvent) => {
    // Only for focus from the keyboard. A click or a menu opening moves focus too, and that isn't curiosity.
    if (usingKeyboard) schedule(event.currentTarget as HTMLElement);
  };
  const onFocusOut = (event: FocusEvent) => leave(event.currentTarget as HTMLElement);

  const onKeyDown = (event: KeyboardEvent) => {
    usingKeyboard = true;
    // Any key that isn't just moving focus means the user is doing something, so get out of the way.
    if (shownFor && !['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Shift'].includes(event.key)) hide();
  };
  const onPointerDown = () => {
    usingKeyboard = false;
    hide();
  };
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  // A scroll that moves the button moves the card with it. The pointer may well still be on the
  // button (the app scrolls a little as a menu opens), and if it isn't, pointerleave hides the card.
  const onScroll = (event: Event) => {
    const scrolled = event.target;
    if (shownFor && (scrolled === document || (scrolled instanceof Node && scrolled.contains(shownFor)))) {
      place(shownFor, sides.get(shownFor) ?? 'bottom');
    }
  };
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);

  return {
    /** Preview every `[data-command]` button in `root`. */
    attach(root: ParentNode, selector: string, side: PreviewSide) {
      root.querySelectorAll<HTMLElement>(selector).forEach((target) => {
        if (sides.has(target)) return;
        sides.set(target, side);
        target.addEventListener('pointerenter', onPointerEnter);
        target.addEventListener('pointerleave', onPointerLeave);
        target.addEventListener('focusin', onFocusIn);
        target.addEventListener('focusout', onFocusOut);
        target.addEventListener('click', hide);
      });
    },
    hide,
    /** The button whose card is showing, if any. */
    get current(): HTMLElement | null {
      return shownFor;
    },
    destroy() {
      hide();
      sides.forEach((_side, target) => {
        target.removeEventListener('pointerenter', onPointerEnter);
        target.removeEventListener('pointerleave', onPointerLeave);
        target.removeEventListener('focusin', onFocusIn);
        target.removeEventListener('focusout', onFocusOut);
        target.removeEventListener('click', hide);
      });
      sides.clear();
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('blur', hide);
    },
  };
}
