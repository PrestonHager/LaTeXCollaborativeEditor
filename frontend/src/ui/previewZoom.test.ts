import { describe, expect, it, vi } from 'vitest';
import {
  bindPreviewZoomControls,
  clampZoom,
  createPreviewZoomState,
  NARROW_FRAME_PX,
  previewZoomCss,
  stepZoom,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomAttribute,
  zoomPercent,
} from './previewZoom';

describe('zoom levels', () => {
  it('keeps a scale in range, to two decimals, and turns junk into 100%', () => {
    expect(clampZoom(1.234)).toBe(1.23);
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(9)).toBe(ZOOM_MAX);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Infinity)).toBe(1);
  });

  it('steps up and down from a step, or from a scale between steps', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1.2, 1)).toBe(1.25);
    expect(stepZoom(1.2, -1)).toBe(1.1);
    // A pinch that stopped a hair under a step counts as that step.
    expect(stepZoom(1.249, 1)).toBe(1.5);
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });

  it('labels a scale as a percentage and writes the data-zoom attribute', () => {
    expect(zoomPercent(1.25)).toBe('125%');
    expect(zoomPercent(0.667)).toBe('67%');
    expect(zoomAttribute('fit')).toBe('fit');
    expect(zoomAttribute(1.5)).toBe('1.5');
    expect(zoomAttribute(40)).toBe(String(ZOOM_MAX));
  });

  it('stops the browser pinch in the frame and narrows the margins in a narrow frame only', () => {
    const css = previewZoomCss();
    expect(css).toContain('touch-action:pan-x pan-y');
    expect(css).toContain(`@media screen and (max-width:${NARROW_FRAME_PX / 16}rem)`);
    expect(css).toContain('--textwidth:calc(100% - 2rem)!important');
  });
});

describe('createPreviewZoomState', () => {
  function setup(phone: boolean) {
    let isPhone = phone;
    const apply = vi.fn();
    const onChange = vi.fn();
    const state = createPreviewZoomState({ isPhone: () => isPhone, apply, onChange });
    return { state, apply, onChange, setPhone: (value: boolean) => (isPhone = value) };
  }

  it('starts on Fit width on a phone and 100% elsewhere', () => {
    expect(setup(true).state.zoom).toBe('fit');
    expect(setup(false).state.zoom).toBe(1);
  });

  it('zooms in and out a step at a time, and stops at the ends', () => {
    const { state, apply } = setup(false);
    state.zoomIn();
    expect(state.zoom).toBe(1.1);
    expect(apply).toHaveBeenLastCalledWith(1.1);
    state.zoomOut();
    state.zoomOut();
    expect(state.zoom).toBe(0.9);
    state.set(ZOOM_MAX);
    expect(state.canZoomIn()).toBe(false);
    apply.mockClear();
    state.zoomIn();
    expect(apply).not.toHaveBeenCalled();
    state.set(ZOOM_MIN);
    expect(state.canZoomOut()).toBe(false);
    expect(state.canZoomIn()).toBe(true);
  });

  it('goes back to Fit width, and zooms from the scale Fit width worked out to', () => {
    const { state, apply, onChange } = setup(true);
    expect(state.scale).toBe(1);
    state.frameReported(1.2, true);
    expect(state.zoom).toBe('fit');
    expect(state.scale).toBe(1.2);
    expect(onChange).toHaveBeenCalled();
    state.zoomIn();
    expect(state.zoom).toBe(1.25);
    expect(state.isFit).toBe(false);
    state.fit();
    expect(state.isFit).toBe(true);
    expect(apply).toHaveBeenLastCalledWith('fit');
  });

  it('ignores a late Fit width report once the person picked a scale', () => {
    const { state } = setup(true);
    state.set(2);
    state.frameReported(1.2, true);
    expect(state.zoom).toBe(2);
    expect(state.scale).toBe(2);
  });

  it('takes a pinched scale without sending it back to the frame', () => {
    const { state, apply } = setup(true);
    state.frameReported(2.37, false);
    expect(state.zoom).toBe(2.37);
    expect(apply).not.toHaveBeenCalled();
  });

  it('follows the device default across the phone breakpoint until the person picks a zoom', () => {
    const { state, setPhone } = setup(false);
    setPhone(true);
    state.deviceChanged();
    expect(state.zoom).toBe('fit');
    setPhone(false);
    state.deviceChanged();
    expect(state.zoom).toBe(1);
    state.zoomIn();
    setPhone(true);
    state.deviceChanged();
    expect(state.zoom).toBe(1.1);
  });

  it('counts a pinch as picking a zoom', () => {
    const { state, setPhone } = setup(false);
    state.frameReported(1.6, false);
    setPhone(true);
    state.deviceChanged();
    expect(state.zoom).toBe(1.6);
  });
});

describe('bindPreviewZoomControls', () => {
  it('runs the state from the buttons and shows the scale and Fit width', () => {
    document.body.innerHTML =
      '<button id="fit"></button><button id="out"></button><output id="level"></output><button id="in"></button>';
    const el = (id: string) => document.getElementById(id) as HTMLButtonElement;
    let render = () => {};
    const state = createPreviewZoomState({ isPhone: () => true, apply: () => {}, onChange: () => render() });
    render = bindPreviewZoomControls({ fitButton: el('fit'), zoomOutButton: el('out'), zoomInButton: el('in'), level: el('level') }, () => state);
    render();
    expect(el('fit').getAttribute('aria-pressed')).toBe('true');
    expect(el('level').textContent).toBe('100%');
    el('in').click();
    expect(el('fit').getAttribute('aria-pressed')).toBe('false');
    expect(el('level').textContent).toBe('110%');
    el('out').click();
    el('out').click();
    expect(el('level').textContent).toBe('90%');
    el('fit').click();
    expect(state.isFit).toBe(true);
    state.set(ZOOM_MIN);
    expect(el('out').disabled).toBe(true);
    expect(el('in').disabled).toBe(false);
  });
});
