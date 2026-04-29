type HistoryListener = () => void;

type HistoryOptions = {
  initialText: string;
  limit?: number;
};

export function createEditHistory(options: HistoryOptions) {
  const limit = options.limit ?? 100;
  let current = options.initialText;
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  const listeners = new Set<HistoryListener>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  return {
    record(nextText: string) {
      if (nextText === current) return;
      undoStack.push(current);
      if (undoStack.length > limit) undoStack.shift();
      current = nextText;
      redoStack.length = 0;
      notify();
    },
    rebase(nextText: string) {
      current = nextText;
      undoStack.length = 0;
      redoStack.length = 0;
      notify();
    },
    canUndo() {
      return undoStack.length > 0;
    },
    canRedo() {
      return redoStack.length > 0;
    },
    undo() {
      if (!undoStack.length) return null;
      const previous = undoStack.pop()!;
      redoStack.push(current);
      current = previous;
      notify();
      return current;
    },
    redo() {
      if (!redoStack.length) return null;
      const next = redoStack.pop()!;
      undoStack.push(current);
      current = next;
      notify();
      return current;
    },
    subscribe(listener: HistoryListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
