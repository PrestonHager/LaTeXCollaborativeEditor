import { createLayout } from './layout';

function setup(onChange?: Parameters<typeof createLayout>[0]['onChange']) {
  const splitRoot = document.createElement('div');
  const splitter = document.createElement('div');
  const editorPane = document.createElement('div');
  const previewPane = document.createElement('div');
  splitRoot.append(editorPane, splitter, previewPane);
  document.body.append(splitRoot);
  // jsdom doesn't lay anything out, so give the split a fixed 1000px width.
  splitRoot.getBoundingClientRect = () => ({ left: 0, width: 1000 }) as DOMRect;
  splitter.setPointerCapture = () => undefined;
  const layout = createLayout({ splitRoot, splitter, editorPane, previewPane, onChange });
  return { layout, splitRoot, splitter, editorPane, previewPane };
}

// jsdom has no PointerEvent, so a MouseEvent with the same name carries clientX for us.
const pointer = (type: string, clientX = 0) => new MouseEvent(type, { clientX, bubbles: true }) as PointerEvent;

/** A pointer event with the fields a touch drag has. */
function touch(type: string, clientX: number, pointerId = 7, button = 0) {
  const event = new MouseEvent(type, { clientX, button, bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  return event;
}

describe('layout', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
  });

  it('starts split down the middle', () => {
    const { layout, splitRoot } = setup();
    layout.applyLayoutMode();
    expect(layout.mode).toBe('split');
    expect(splitRoot.style.gridTemplateColumns).toBe('50% 8px 50%');
  });

  it('hides the other pane and the splitter in single-pane modes', () => {
    const { layout, splitRoot, splitter, editorPane, previewPane } = setup();
    layout.setMode('editor-only');
    expect(splitRoot.classList.contains('is-editor-only')).toBe(true);
    expect(splitter.style.display).toBe('none');
    expect(previewPane.style.display).toBe('none');
    expect(splitRoot.style.gridTemplateColumns).toBe('1fr');
    layout.setMode('preview-only');
    expect(splitRoot.classList.contains('is-preview-only')).toBe(true);
    expect(editorPane.style.display).toBe('none');
    expect(previewPane.style.display).toBe('');
  });

  it('drags the splitter and clamps the ratio', () => {
    const { layout, splitRoot, splitter } = setup();
    layout.installSplitter();
    layout.applyLayoutMode();
    splitter.dispatchEvent(pointer('pointerdown'));
    expect(document.body.classList.contains('is-resizing')).toBe(true);
    window.dispatchEvent(pointer('pointermove', 300));
    expect(splitRoot.style.gridTemplateColumns).toBe('30% 8px 70%');
    window.dispatchEvent(pointer('pointermove', 950));
    expect(splitRoot.style.gridTemplateColumns).toBe('80% 8px 20%');
    window.dispatchEvent(pointer('pointerup'));
    expect(document.body.classList.contains('is-resizing')).toBe(false);
    window.dispatchEvent(pointer('pointermove', 500));
    expect(splitRoot.style.gridTemplateColumns).toBe('80% 8px 20%');
  });

  it('ignores drags when only one pane shows', () => {
    const { layout, splitter } = setup();
    layout.installSplitter();
    layout.setMode('editor-only');
    splitter.dispatchEvent(pointer('pointerdown'));
    expect(document.body.classList.contains('is-resizing')).toBe(false);
  });

  it('reports changes so they can be saved, and restores a saved layout quietly', () => {
    const onChange = vi.fn();
    const { layout, splitRoot, splitter } = setup(onChange);
    layout.installSplitter();
    layout.restore({ mode: 'split', splitRatio: 0.95 });
    expect(layout.splitRatio).toBe(0.8);
    expect(splitRoot.style.gridTemplateColumns).toBe('80% 8px 20%');
    expect(onChange).not.toHaveBeenCalled();

    splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'split', splitRatio: 0.75 });
    splitter.dispatchEvent(pointer('pointerdown', 500));
    window.dispatchEvent(pointer('pointermove', 400));
    window.dispatchEvent(pointer('pointerup'));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'split', splitRatio: 0.4 });
    // A stray pointerup with no drag isn't a change.
    window.dispatchEvent(pointer('pointerup'));
    expect(onChange).toHaveBeenCalledTimes(2);

    layout.setMode('preview-only');
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'preview-only', splitRatio: 0.4 });
    layout.setMode('preview-only');
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  describe('touch dragging (#188)', () => {
    it('follows one finger, captures it, and saves where it lifts', () => {
      const onChange = vi.fn();
      const { layout, splitRoot, splitter } = setup(onChange);
      const capture = vi.fn();
      splitter.setPointerCapture = capture;
      layout.installSplitter();
      layout.applyLayoutMode();
      const down = touch('pointerdown', 500);
      splitter.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
      expect(capture).toHaveBeenCalledWith(7);
      window.dispatchEvent(touch('pointermove', 400));
      expect(splitRoot.style.gridTemplateColumns).toBe('40% 8px 60%');
      // A second finger on the screen doesn't move it, or end the drag.
      window.dispatchEvent(touch('pointermove', 700, 8));
      window.dispatchEvent(touch('pointerup', 700, 8));
      expect(splitRoot.style.gridTemplateColumns).toBe('40% 8px 60%');
      expect(onChange).not.toHaveBeenCalled();
      window.dispatchEvent(touch('pointerup', 400));
      expect(onChange).toHaveBeenCalledWith({ mode: 'split', splitRatio: 0.4 });
      expect(document.body.classList.contains('is-resizing')).toBe(false);
    });

    it('keeps the new size when the browser cancels the touch', () => {
      const onChange = vi.fn();
      const { layout, splitter } = setup(onChange);
      layout.installSplitter();
      layout.applyLayoutMode();
      splitter.dispatchEvent(touch('pointerdown', 500));
      window.dispatchEvent(touch('pointermove', 650));
      window.dispatchEvent(touch('pointercancel', 650));
      expect(onChange).toHaveBeenCalledWith({ mode: 'split', splitRatio: 0.65 });
      expect(document.body.classList.contains('is-resizing')).toBe(false);
      window.dispatchEvent(touch('pointermove', 300));
      expect(layout.splitRatio).toBe(0.65);
    });

    it("doesn't start a second drag, or one from a mouse's other buttons", () => {
      const { layout, splitter } = setup();
      layout.installSplitter();
      layout.applyLayoutMode();
      const right = touch('pointerdown', 300, 1, 2);
      splitter.dispatchEvent(right);
      expect(right.defaultPrevented).toBe(false);
      expect(document.body.classList.contains('is-resizing')).toBe(false);
      splitter.dispatchEvent(touch('pointerdown', 300, 1));
      const second = touch('pointerdown', 300, 2);
      splitter.dispatchEvent(second);
      expect(second.defaultPrevented).toBe(false);
      window.dispatchEvent(touch('pointermove', 300, 2));
      expect(layout.splitRatio).toBe(0.5);
    });

    it('keeps the ratio while the split has no width yet', () => {
      const { layout, splitRoot, splitter } = setup();
      splitRoot.getBoundingClientRect = () => ({ left: 0, width: 0 }) as DOMRect;
      layout.installSplitter();
      layout.applyLayoutMode();
      splitter.dispatchEvent(touch('pointerdown', 0));
      window.dispatchEvent(touch('pointermove', 100));
      expect(layout.splitRatio).toBe(0.5);
    });
  });
});
