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

  const installSplitter = () => {
    let dragging = false;
    const onMove = (event: PointerEvent) => {
      if (!dragging || layoutMode !== 'split') return;
      const bounds = splitRoot.getBoundingClientRect();
      const ratio = (event.clientX - bounds.left) / bounds.width;
      splitRatio = Math.max(0.2, Math.min(0.8, ratio));
      applyLayoutMode();
    };
    const onUp = () => {
      if (dragging) changed();
      dragging = false;
      document.body.classList.remove('is-resizing');
    };
    splitter.addEventListener('pointerdown', (event) => {
      if (layoutMode !== 'split') return;
      dragging = true;
      document.body.classList.add('is-resizing');
      splitter.setPointerCapture(event.pointerId);
    });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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
