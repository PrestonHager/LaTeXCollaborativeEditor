import * as Y from 'yjs';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { LOCAL_CLIENT_ID, PresenceAwareness } from './awareness';
import { createCollabUndo } from './undo';
import { PresenceSync, lightColor, toWireState } from './presence';

const user = (name: string, color = '#2563eb') => ({ name, color, colorLight: lightColor(color) });

describe('PresenceAwareness', () => {
  it('keeps our state under the local id and reports changes with their origin', () => {
    const awareness = new PresenceAwareness(user('Me'));
    const listener = vi.fn();
    awareness.on('change', listener);
    expect(awareness.doc.clientID).toBe(LOCAL_CLIENT_ID);
    expect(awareness.getLocalState()).toEqual({ user: user('Me'), file: null, cursor: null });

    awareness.setLocalStateField('file', 'f1');
    expect(listener).toHaveBeenLastCalledWith({ added: [], updated: [0], removed: [] }, 'local');
    awareness.setRemoteState(3, { user: user('Peer'), file: null, cursor: null });
    expect(listener).toHaveBeenLastCalledWith({ added: [3], updated: [], removed: [] }, 'remote');
    awareness.setRemoteState(3, null);
    expect(listener).toHaveBeenLastCalledWith({ added: [], updated: [], removed: [3] }, 'remote');
    // Removing someone who isn't there, or touching our own entry as a remote, does nothing.
    listener.mockClear();
    awareness.setRemoteState(3, null);
    awareness.setRemoteState(LOCAL_CLIENT_ID, null);
    expect(listener).not.toHaveBeenCalled();

    awareness.off('change', listener);
    awareness.setLocalState(null);
    expect(listener).not.toHaveBeenCalled();
    expect(awareness.getLocalState()).toBeNull();
    // With no local state there's no field to set.
    awareness.setLocalStateField('file', 'f2');
    expect(awareness.getLocalState()).toBeNull();
  });
});

describe('remote cursors in the editor', () => {
  it("shows a peer's caret, name label and selection, and sends our own cursor", () => {
    // Two docs that sync both ways, like two tabs in a room.
    const mine = new Y.Doc();
    const theirs = new Y.Doc();
    mine.on('update', (update, origin) => origin !== 'remote' && Y.applyUpdate(theirs, update, 'remote'));
    theirs.on('update', (update, origin) => origin !== 'remote' && Y.applyUpdate(mine, update, 'remote'));
    const name = 'file:abc';
    theirs.getText(name).insert(0, 'hello world\nsecond line');

    const awareness = new PresenceAwareness(user('Me', '#dc2626'));
    awareness.setLocalStateField('file', 'abc');
    const sent: unknown[] = [];
    const sync = new PresenceSync({ awareness, send: (message) => sent.push(message), hasType: (type) => mine.share.has(type) });
    sync.start();

    const undo = createCollabUndo(mine.getText(name));
    const view = new EditorView({
      state: EditorState.create({ doc: mine.getText(name).toString(), extensions: undo.extensions(awareness) }),
      parent: document.body,
    });

    // The peer selects "world" and reports it.
    const text = theirs.getText(name);
    const cursor = { anchor: Y.createRelativePositionFromTypeIndex(text, 6), head: Y.createRelativePositionFromTypeIndex(text, 11) };
    const wire = toWireState({ user: user('Grace', '#9333ea'), file: 'abc', cursor });
    sync.receive(JSON.parse(JSON.stringify({ kind: 'awareness', clock: 1, state: wire })), 'peer-1');

    const caret = view.dom.querySelector<HTMLElement>('.cm-ySelectionCaret');
    expect(caret?.style.backgroundColor).toBe('rgb(147, 51, 234)');
    expect(view.dom.querySelector('.cm-ySelectionInfo')?.textContent).toBe('Grace');
    expect(view.dom.querySelector('.cm-ySelection')?.textContent).toBe('world');

    // Our own selection goes into the awareness once the editor has focus.
    vi.spyOn(view, 'hasFocus', 'get').mockReturnValue(true);
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    view.dispatch({ selection: { anchor: 2, head: 4 } });
    const local = awareness.getLocalState()?.cursor;
    expect(local && Y.createAbsolutePositionFromRelativePosition(local.head, mine)?.index).toBe(4);

    // When the peer leaves, its caret goes away.
    sync.peerLeft('peer-1');
    expect(view.dom.querySelector('.cm-ySelectionCaret')).toBeNull();

    sync.stop();
    view.destroy();
    vi.restoreAllMocks();
  });
});
