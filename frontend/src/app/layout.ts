export type LayoutMode = 'split' | 'editor-only' | 'preview-only';

type LayoutElements = {
  splitRoot: HTMLElement;
  splitter: HTMLElement;
  editorPane: HTMLElement;
  previewPane: HTMLElement;
  /** Called after the person changes the mode or lets go of the splitter, so it can be saved. */
  onChange?: (state: { mode: LayoutMode; splitRatio: number }) => void;
};

/** Show the editor, the preview, or both with a draggable splitter between them. */
export function createLayout({ splitRoot, splitter, editorPane, previewPane, onChange }: LayoutElements) {
  let layoutMode: LayoutMode = 'split';
  let splitRatio = 0.5;
  const changed = () => onChange?.({ mode: layoutMode, splitRatio });

  const applyLayoutMode = () => {
    splitRoot.classList.toggle('is-editor-only', layoutMode === 'editor-only');
    splitRoot.classList.toggle('is-preview-only', layoutMode === 'preview-only');
    splitter.style.display = layoutMode === 'split' ? '' : 'none';
    editorPane.style.display = layoutMode === 'preview-only' ? 'none' : '';
    previewPane.style.display = layoutMode === 'editor-only' ? 'none' : '';
    if (layoutMode === 'split') {
      const left = Math.max(20, Math.min(80, Math.round(splitRatio * 100)));
      splitRoot.style.gridTemplateColumns = `${left}% 8px ${100 - left}%`;
      splitter.setAttribute('aria-valuenow', String(left));
    } else {
      splitRoot.style.gridTemplateColumns = '1fr';
    }
  };

  /**
   * Drag with a mouse, a pen or a finger (#188). Pointer capture keeps the drag going over the editor and
   * the preview's iframe, `touch-action: none` in style.css stops the browser from scrolling instead, and
   * on touch screens the splitter has an invisible 44px hit area around its 8px bar.
   */
  const installSplitter = () => {
    // The one pointer dragging, so a second finger on the screen doesn't move the splitter too.
    let dragging: number | null = null;
    const ratioAt = (clientX: number) => {
      const bounds = splitRoot.getBoundingClientRect();
      return bounds.width > 0 ? Math.max(0.2, Math.min(0.8, (clientX - bounds.left) / bounds.width)) : splitRatio;
    };
    const onMove = (event: PointerEvent) => {
      if (dragging === null || event.pointerId !== dragging || layoutMode !== 'split') return;
      splitRatio = ratioAt(event.clientX);
      applyLayoutMode();
    };
    const end = (event: PointerEvent) => {
      if (dragging === null || event.pointerId !== dragging) return;
      dragging = null;
      document.body.classList.remove('is-resizing');
      // Lifting the finger or button keeps the new size, and so does the browser cancelling the drag.
      changed();
    };
    splitter.addEventListener('pointerdown', (event) => {
      // Only the main mouse button. Touch and pen report 0 too.
      if (layoutMode !== 'split' || dragging !== null || event.button > 0) return;
      // No text selection, and no compatibility mouse events, while dragging.
      event.preventDefault();
      dragging = event.pointerId;
      document.body.classList.add('is-resizing');
      splitter.setPointerCapture?.(event.pointerId);
    });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    // Keyboard users move the splitter with the arrow keys instead of dragging.
    splitter.addEventListener('keydown', (event) => {
      if (layoutMode !== 'split') return;
      const steps: Record<string, number> = { ArrowLeft: -0.05, ArrowRight: 0.05 };
      const step = steps[event.key];
      if (step === undefined) return;
      event.preventDefault();
      splitRatio = Math.max(0.2, Math.min(0.8, splitRatio + step));
      applyLayoutMode();
      changed();
    });
  };

  return {
    get mode() {
      return layoutMode;
    },
    get splitRatio() {
      return splitRatio;
    },
    setMode(mode: LayoutMode) {
      if (mode === layoutMode) return applyLayoutMode();
      layoutMode = mode;
      applyLayoutMode();
      changed();
    },
    /** Put back a saved layout without reporting it as a change. */
    restore(state: { mode: LayoutMode; splitRatio: number }) {
      layoutMode = state.mode;
      splitRatio = Math.max(0.2, Math.min(0.8, state.splitRatio));
      applyLayoutMode();
    },
    applyLayoutMode,
    installSplitter,
  };
}

export type Layout = ReturnType<typeof createLayout>;
