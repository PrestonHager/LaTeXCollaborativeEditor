/**
 * Preview zoom (issue #190, part of #123): Fit width, Zoom in and Zoom out, and pinch-zoom on touch screens.
 *
 * The page in the preview frame is as wide as the frame (LaTeX.js treats the window as the paper), so a zoom
 * level scales the text and the page reflows to the pane: there's never a sideways scrollbar. The zoom goes on
 * the frame document's root as CSS `zoom`, set by the frame's own script (see PREVIEW_LINK_SCRIPT), because
 * the sandboxed frame has no same-origin access for the app to reach in.
 *
 * - **Fit width** fills the pane. In a narrow pane (a phone) the side margins shrink to a small gutter
 *   (previewZoomCss) and the text is scaled up until body text is at least READABLE_TEXT_PX. In a wider pane
 *   it's the page at 100%. It's the default on phones.
 * - **Zoom in / out** step through ZOOM_STEPS, starting from the current scale, Fit width's included.
 * - Pinching the preview (or Ctrl + wheel, which is how a trackpad pinch arrives) zooms the preview, not the
 *   app: the frame stops the browser's own pinch with `touch-action` and handles the gesture itself.
 */
export type PreviewZoom = 'fit' | number;

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
/** Fit width scales a phone's text up to this size in CSS pixels (LaTeX.js's 10pt is about 13.3px). */
export const READABLE_TEXT_PX = 16;
/** Under this frame width the page's side margins shrink to a gutter, at any zoom (30rem, the frame's own rem). */
export const NARROW_FRAME_PX = 480;

/** A zoom level inside the allowed range, to two decimals. Anything that isn't a finite number gives 1. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) * 100) / 100;
}

/** The next step up (+1) or down (-1) from a scale that may sit between steps. */
export function stepZoom(scale: number, direction: 1 | -1): number {
  const current = clampZoom(scale);
  // A little slack, so 1.249 after a pinch counts as 1.25 and the next step is 1.5.
  const next = direction > 0 ? ZOOM_STEPS.find((step) => step > current + 0.005) : [...ZOOM_STEPS].reverse().find((step) => step < current - 0.005);
  return next ?? (direction > 0 ? ZOOM_MAX : ZOOM_MIN);
}

/** "125%" for a scale. */
export function zoomPercent(scale: number): string {
  return `${Math.round(clampZoom(scale) * 100)}%`;
}

/** The value for the frame script's data-zoom attribute: "fit" or a number. */
export function zoomAttribute(zoom: PreviewZoom): string {
  return zoom === 'fit' ? 'fit' : String(clampZoom(zoom));
}

/**
 * CSS that goes in the preview document (not the HTML export). `touch-action` keeps the browser from
 * pinch-zooming the whole app when the pinch starts over the preview; the frame script zooms the preview
 * instead. In a narrow frame the side margins become a 1rem gutter, so the text gets the width.
 */
export function previewZoomCss(): string {
  return (
    'html{touch-action:pan-x pan-y;-webkit-text-size-adjust:100%;text-size-adjust:100%;}' +
    `@media screen and (max-width:${NARROW_FRAME_PX / 16}rem){html{--marginleftwidth:1rem!important;--marginrightwidth:1rem!important;` +
    '--textwidth:calc(100% - 2rem)!important;--marginparwidth:0px!important;}}'
  );
}

type ZoomStateOptions = {
  /** Fit width is the default on phones, 100% elsewhere. */
  isPhone: () => boolean;
  /** Called with the new zoom whenever it changes, or when the frame needs to hear it again. */
  apply: (zoom: PreviewZoom) => void;
  /** Called after any change, the frame's reports included, so the controls can update. */
  onChange?: () => void;
};

/**
 * The zoom the person picked, or the default for the device until they pick one. It isn't saved: a new tab
 * starts at the device's default again.
 */
export function createPreviewZoomState({ isPhone, apply, onChange }: ZoomStateOptions) {
  const deviceDefault = (): PreviewZoom => (isPhone() ? 'fit' : 1);
  let zoom: PreviewZoom = deviceDefault();
  let chosen = false;
  // The scale Fit width works out to in the frame, which the frame reports. 1 until it does.
  let fitScale = 1;

  const set = (next: PreviewZoom, byPerson = true) => {
    const value = next === 'fit' ? 'fit' : clampZoom(next);
    if (byPerson) chosen = true;
    if (value === zoom) return;
    zoom = value;
    apply(zoom);
    onChange?.();
  };

  return {
    get zoom() {
      return zoom;
    },
    /** The scale the preview shows at now: Fit width's worked-out scale, or the zoom level. */
    get scale() {
      return zoom === 'fit' ? fitScale : zoom;
    },
    get isFit() {
      return zoom === 'fit';
    },
    canZoomIn() {
      return this.scale < ZOOM_MAX;
    },
    canZoomOut() {
      return this.scale > ZOOM_MIN;
    },
    set,
    fit() {
      set('fit');
    },
    zoomIn() {
      set(stepZoom(this.scale, 1));
    },
    zoomOut() {
      set(stepZoom(this.scale, -1));
    },
    /**
     * The frame reports a scale: the one Fit width worked out to (fit true), or one the person pinched to
     * (fit false). It's already showing, so nothing goes back to the frame.
     */
    frameReported(scale: number, fit: boolean) {
      if (fit) {
        if (zoom !== 'fit') return;
        fitScale = clampZoom(scale);
      } else {
        chosen = true;
        zoom = clampZoom(scale);
      }
      onChange?.();
    },
    /** The window crossed the phone breakpoint. Until the person picks a zoom, follow the device default. */
    deviceChanged() {
      if (!chosen) set(deviceDefault(), false);
    },
  };
}

export type PreviewZoomState = ReturnType<typeof createPreviewZoomState>;

type ZoomControlElements = {
  fitButton: HTMLButtonElement;
  zoomOutButton: HTMLButtonElement;
  zoomInButton: HTMLButtonElement;
  /** Shows the scale, like "125%". */
  level: HTMLElement;
};

/** Wire the preview bar's zoom buttons to the state. Returns render, for the state's onChange. */
export function bindPreviewZoomControls(elements: ZoomControlElements, getState: () => PreviewZoomState) {
  const { fitButton, zoomOutButton, zoomInButton, level } = elements;
  fitButton.addEventListener('click', () => getState().fit());
  zoomOutButton.addEventListener('click', () => getState().zoomOut());
  zoomInButton.addEventListener('click', () => getState().zoomIn());
  const render = () => {
    const state = getState();
    fitButton.setAttribute('aria-pressed', String(state.isFit));
    zoomOutButton.disabled = !state.canZoomOut();
    zoomInButton.disabled = !state.canZoomIn();
    level.textContent = zoomPercent(state.scale);
  };
  return render;
}
