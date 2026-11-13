import * as Y from 'yjs';
import { EditorView, keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import type { PresenceAwareness } from './awareness';

// y-codemirror.next only shows a peer's name when you hover its caret, in a serif font. Keep the
// label up, in the UI font. The label text is white on the peer's colour, and every colour in
// presence.ts's palette is at least 4.5:1 against white.
const remoteCursorTheme = EditorView.theme({
  '.cm-ySelectionInfo': {
    opacity: 1,
    fontFamily: 'system-ui, sans-serif',
    fontSize: '0.6875rem',
    fontWeight: '500',
    top: '-1.25em',
    padding: '0 0.25rem',
    borderRadius: '0.2rem 0.2rem 0.2rem 0',
    pointerEvents: 'none',
  },
  '.cm-ySelectionCaret': { borderLeftWidth: '2px', borderRightWidth: '0' },
  '.cm-ySelectionCaretDot': { display: 'none' },
});

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
    // Build the editor extensions, the binding plus the undo keys. With awareness, peers' cursors show too.
    extensions(awareness: PresenceAwareness | null = null): Extension[] {
      const binding = [yCollab(yText, awareness, { undoManager: manager }), keymap.of(yUndoManagerKeymap)];
      return awareness ? [...binding, remoteCursorTheme] : binding;
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
