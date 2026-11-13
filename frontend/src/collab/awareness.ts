// Who's in the room and where their cursor is (issue #22).
//
// This is the small part of y-protocols' Awareness that y-codemirror.next's remote cursors use:
// a local state, the states of everyone else, and a 'change' event. It doesn't send anything. The
// sending, checking and timeouts live in presence.ts, which only loads once you share.
import type * as Y from 'yjs';

/** A cursor as y-codemirror.next keeps it: two Yjs relative positions, so it follows edits. */
export type PresenceCursor = { anchor: Y.RelativePosition; head: Y.RelativePosition };

/** What one person in the room shares: a name, a colour, the open file id, and the cursor. Nothing else. */
export type PresenceState = {
  /** `user` is the field name y-codemirror.next reads for the label and colours. */
  user: { name: string; color: string; colorLight: string };
  file: string | null;
  cursor: PresenceCursor | null;
};

export type AwarenessChange = { added: number[]; updated: number[]; removed: number[] };
type ChangeListener = (change: AwarenessChange, origin: 'local' | 'remote') => void;

/** Our own entry in getStates(). Remote peers get ids from 1 up (see presence.ts). */
export const LOCAL_CLIENT_ID = 0;

export class PresenceAwareness {
  /** y-codemirror.next reads `awareness.doc.clientID` to skip our own cursor. Only that field is used. */
  readonly doc = { clientID: LOCAL_CLIENT_ID };
  readonly clientID = LOCAL_CLIENT_ID;
  private readonly states = new Map<number, PresenceState>();
  private readonly listeners = new Set<ChangeListener>();

  constructor(user: PresenceState['user']) {
    this.states.set(LOCAL_CLIENT_ID, { user, file: null, cursor: null });
  }

  getLocalState(): PresenceState | null {
    return this.states.get(LOCAL_CLIENT_ID) ?? null;
  }

  setLocalState(state: PresenceState | null) {
    this.setState(LOCAL_CLIENT_ID, state, 'local');
  }

  setLocalStateField<K extends keyof PresenceState>(field: K, value: PresenceState[K]) {
    const state = this.getLocalState();
    if (state) this.setLocalState({ ...state, [field]: value });
  }

  /** Everyone's state, ours included, by client id. */
  getStates(): Map<number, PresenceState> {
    return this.states;
  }

  /** Set or (with null) remove a remote peer's state. Only presence.ts calls this, with checked input. */
  setRemoteState(clientId: number, state: PresenceState | null) {
    if (clientId === LOCAL_CLIENT_ID) return;
    this.setState(clientId, state, 'remote');
  }

  on(_event: 'change', listener: ChangeListener) {
    this.listeners.add(listener);
  }

  off(_event: 'change', listener: ChangeListener) {
    this.listeners.delete(listener);
  }

  private setState(clientId: number, state: PresenceState | null, origin: 'local' | 'remote') {
    const had = this.states.has(clientId);
    if (state) this.states.set(clientId, state);
    else if (had) this.states.delete(clientId);
    else return;
    const change: AwarenessChange = { added: [], updated: [], removed: [] };
    (state ? (had ? change.updated : change.added) : change.removed).push(clientId);
    for (const listener of [...this.listeners]) listener(change, origin);
  }
}
