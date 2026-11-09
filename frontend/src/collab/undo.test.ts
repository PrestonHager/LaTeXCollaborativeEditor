import * as Y from 'yjs';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { createCollabUndo } from './undo';

// Set up a local editor bound to its own Y.Doc, plus a peer doc that syncs both ways.
function setup(initial = 'hello') {
  const localDoc = new Y.Doc();
  const peerDoc = new Y.Doc();
  const localText = localDoc.getText('doc');
  const peerText = peerDoc.getText('doc');

  localDoc.on('update', (update, origin) => {
    if (origin !== 'remote') Y.applyUpdate(peerDoc, update, 'remote');
  });
  peerDoc.on('update', (update, origin) => {
    if (origin !== 'remote') Y.applyUpdate(localDoc, update, 'remote');
  });

  peerDoc.transact(() => peerText.insert(0, initial), 'init');

  const undo = createCollabUndo(localText);
  const view = new EditorView({
    state: EditorState.create({ doc: localText.toString(), extensions: undo.extensions() }),
    parent: document.body,
  });

  return { undo, view, localText, peerText };
}

describe('createCollabUndo', () => {
  it('keeps a peer edit when undoing a local edit', () => {
    const { undo, view, peerText } = setup('hello');

    view.dispatch({ changes: { from: 5, insert: ' world' } });
    expect(peerText.toString()).toBe('hello world');

    // Now the peer types at the start of the doc.
    peerText.insert(0, '> ');
    expect(view.state.doc.toString()).toBe('> hello world');

    expect(undo.canUndo()).toBe(true);
    undo.undo();
    expect(view.state.doc.toString()).toBe('> hello');
    expect(peerText.toString()).toBe('> hello');

    expect(undo.canRedo()).toBe(true);
    undo.redo();
    expect(view.state.doc.toString()).toBe('> hello world');
    view.destroy();
  });

  it('does not undo edits that came from a peer', () => {
    const { undo, view, peerText } = setup('abc');

    peerText.insert(3, 'def');
    expect(view.state.doc.toString()).toBe('abcdef');
    expect(undo.canUndo()).toBe(false);

    undo.undo();
    expect(view.state.doc.toString()).toBe('abcdef');
    view.destroy();
  });

  it('runs undo and redo from the editor keymap', () => {
    const { undo, view } = setup('x');

    view.dispatch({ changes: { from: 1, insert: 'y' } });
    undo.manager.stopCapturing();

    const press = (key: string) =>
      runScopeHandlers(view, new KeyboardEvent('keydown', { key, ctrlKey: true }), 'editor');

    expect(press('z')).toBe(true);
    expect(view.state.doc.toString()).toBe('x');
    expect(press('y')).toBe(true);
    expect(view.state.doc.toString()).toBe('xy');
    view.destroy();
  });

  it('notifies listeners and clears the stacks', () => {
    const { undo, view } = setup('a');
    const listener = vi.fn();
    const off = undo.subscribe(listener);

    view.dispatch({ changes: { from: 1, insert: 'b' } });
    expect(listener).toHaveBeenCalled();
    expect(undo.canUndo()).toBe(true);

    undo.clear();
    expect(undo.canUndo()).toBe(false);
    expect(undo.canRedo()).toBe(false);

    // Once unsubscribed we shouldn't hear about new edits.
    off();
    listener.mockClear();
    view.dispatch({ changes: { from: 2, insert: 'c' } });
    expect(listener).not.toHaveBeenCalled();
    view.destroy();
  });
});
