import * as Y from 'yjs';
import { keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';

type UndoListener = () => void;

// Shared undo for the collaborative editor. It only reverts our own edits, so
// a peer's changes stay put when we undo or redo.
export function createCollabUndo(yText: Y.Text) {
  const manager = new Y.UndoManager(yText);
  const listeners = new Set<UndoListener>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  manager.on('stack-item-added', notify);
  manager.on('stack-item-popped', notify);
  manager.on('stack-cleared', notify);

  return {
    manager,
    // Build the editor extensions, the binding plus the undo keys.
    extensions(): Extension[] {
      return [yCollab(yText, null, { undoManager: manager }), keymap.of(yUndoManagerKeymap)];
    },
    canUndo() {
      return manager.canUndo();
    },
    canRedo() {
      return manager.canRedo();
    },
    undo() {
      manager.undo();
    },
    redo() {
      manager.redo();
    },
    clear() {
      manager.clear();
    },
    subscribe(listener: UndoListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
