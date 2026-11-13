import * as Y from 'yjs';
import { PresenceAwareness, type PresenceState } from './awareness';
import {
  HEARTBEAT_MS,
  MAX_PRESENCE_BYTES,
  PEER_TIMEOUT_MS,
  PRESENCE_COLORS,
  PresenceSync,
  RECEIVE_BURST,
  RECEIVE_PER_SECOND,
  RateLimiter,
  SEND_INTERVAL_MS,
  anonymousName,
  assignColors,
  colorForPeer,
  initials,
  lightColor,
  parseAwarenessMessage,
  toWireState,
  type AwarenessMessage,
  type WireState,
} from './presence';

const FILE = '3f2a9c4e-1b2d-4c6e-8f00-1234567890ab';
const TNAME = `file:${FILE}`;
const RED = PRESENCE_COLORS[0];
// Presence ids whose preferred colour is the first and second palette colour.
const RED_ID = 'aaaaaaaaaaaaaaa6';
const ORANGE_ID = 'aaaaaaaaaaaaaaa5';

const goodState = (overrides: Partial<WireState> = {}): WireState => ({
  name: 'Ada Lovelace',
  color: RED,
  file: FILE,
  cursor: { anchor: { tname: TNAME, item: { client: 12345, clock: 3 } }, head: { tname: TNAME, item: { client: 12345, clock: 7 }, assoc: -1 } },
  ...overrides,
});
const message = (state: unknown = goodState(), clock = 1) => ({ kind: 'awareness', clock, state });

// WCAG relative luminance and contrast.
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('parseAwarenessMessage', () => {
  it('accepts a full state and a leave, and strips fields it does not know', () => {
    const parsed = parseAwarenessMessage({ ...message(), extra: 1, state: { ...goodState(), email: 'x@y.z' } });
    expect(parsed).toEqual({ kind: 'awareness', clock: 1, state: goodState() });
    expect(parsed?.state).not.toHaveProperty('email');
    expect(parseAwarenessMessage(message(null, 9))).toEqual({ kind: 'awareness', clock: 9, state: null });
  });

  it('accepts no file and no cursor, and positions at the end of a file (no item)', () => {
    expect(parseAwarenessMessage(message(goodState({ file: null, cursor: null })))?.state?.file).toBeNull();
    const end = { tname: TNAME };
    expect(parseAwarenessMessage(message(goodState({ cursor: { anchor: end, head: end } })))?.state?.cursor).toEqual({ anchor: end, head: end });
    // Projects from before multi-file keep their text in a root type called `doc`.
    const legacy = { tname: 'doc' };
    expect(parseAwarenessMessage(message(goodState({ file: 'doc', cursor: { anchor: legacy, head: legacy } })))).not.toBeNull();
  });

  it.each([
    ['not an object', 'awareness'],
    ['another kind', { ...message(), kind: 'hello' }],
    ['a missing clock', { kind: 'awareness', state: null }],
    ['a negative clock', message(null, -1)],
    ['a fractional clock', message(null, 1.5)],
    ['a state that is a string', message('hi')],
    ['an empty name', message(goodState({ name: '' }))],
    ['a name with spaces around it', message(goodState({ name: ' Ada ' }))],
    ['a name over 40 characters', message(goodState({ name: 'x'.repeat(41) }))],
    ['a huge name', message(goodState({ name: 'x'.repeat(100_000) }))],
    ['a name with a newline', message(goodState({ name: 'Ada\nLovelace' }))],
    ['a name with a bidi override', message(goodState({ name: 'Ada‮ecalevol' }))],
    ['a name that is not a string', message(goodState({ name: 42 as unknown as string }))],
    ['a colour outside the palette', message(goodState({ color: '#ffffff' }))],
    ['CSS in the colour', message(goodState({ color: 'red; background: url(x)' }))],
    ['an uppercase colour', message(goodState({ color: RED.toUpperCase() }))],
    ['a file id with a slash', message(goodState({ file: '../etc' }))],
    ['a long file id', message(goodState({ file: 'a'.repeat(65) }))],
    ['a cursor without a file', message(goodState({ file: null }))],
    ['a cursor that is an array', message(goodState({ cursor: [] as unknown as WireState['cursor'] }))],
    ['a cursor missing its head', message(goodState({ cursor: { anchor: { tname: TNAME } } as WireState['cursor'] }))],
    ['a cursor in another file', message(goodState({ cursor: { anchor: { tname: 'file:other' }, head: { tname: 'file:other' } } }))],
    ['a cursor in some other root type', message(goodState({ file: 'meta', cursor: { anchor: { tname: 'meta' }, head: { tname: 'meta' } } }))],
    ['a position with a nested type id', message(goodState({ cursor: { anchor: { tname: TNAME, type: { client: 1, clock: 1 } } as never, head: { tname: TNAME } } }))],
    ['a position with a bad assoc', message(goodState({ cursor: { anchor: { tname: TNAME, assoc: 5 }, head: { tname: TNAME } } }))],
    ['a position with a negative clock', message(goodState({ cursor: { anchor: { tname: TNAME, item: { client: 1, clock: -1 } }, head: { tname: TNAME } } }))],
    ['a position with a client id over 32 bits', message(goodState({ cursor: { anchor: { tname: TNAME, item: { client: 2 ** 32, clock: 1 } }, head: { tname: TNAME } } }))],
    ['a presence id without a join time', message(goodState({ id: RED_ID }))],
    ['a join time without a presence id', message(goodState({ joined: 5 }))],
    ['an uppercase presence id', message(goodState({ id: RED_ID.toUpperCase(), joined: 5 }))],
    ['a short presence id', message(goodState({ id: RED_ID.slice(1), joined: 5 }))],
    ['a long presence id', message(goodState({ id: `${RED_ID}0`, joined: 5 }))],
    ['a presence id that is not hex', message(goodState({ id: 'gggggggggggggggg', joined: 5 }))],
    ['a presence id that is a number', message(goodState({ id: 12 as never, joined: 5 }))],
    ['a negative join time', message(goodState({ id: RED_ID, joined: -1 }))],
    ['a fractional join time', message(goodState({ id: RED_ID, joined: 1.5 }))],
    ['a join time that is a string', message(goodState({ id: RED_ID, joined: '5' as never }))],
    ['a position item that is a string', message(goodState({ cursor: { anchor: { tname: TNAME, item: 'x' as never }, head: { tname: TNAME } } }))],
  ])('drops %s', (_label, payload) => {
    expect(parseAwarenessMessage(payload)).toBeNull();
  });
});

describe('parseAwarenessMessage with a presence id', () => {
  it('keeps the id and join time when both are there', () => {
    expect(parseAwarenessMessage(message(goodState({ id: RED_ID, joined: 1700000000000 })))?.state).toEqual(goodState({ id: RED_ID, joined: 1700000000000 }));
    // A peer from before presence ids sends neither.
    expect(parseAwarenessMessage(message())?.state).not.toHaveProperty('id');
  });
});

describe('assignColors', () => {
  const candidate = (peerId: string, joined: number | null, presenceId: string | null, preferred = presenceId ? colorForPeer(presenceId) : RED) => ({
    peerId,
    presenceId,
    joined,
    preferred,
  });

  it('gives everyone their preferred colour when nobody clashes', () => {
    const colors = assignColors([candidate('a', 1, RED_ID), candidate('b', 2, ORANGE_ID)]);
    expect(colors).toEqual(new Map([['a', RED], ['b', PRESENCE_COLORS[1]]]));
  });

  it('moves whoever joined later to the next free colour, wrapping round the palette', () => {
    const colors = assignColors([candidate('late', 9, RED_ID), candidate('early', 1, RED_ID), candidate('orange', 5, ORANGE_ID)]);
    expect(colors.get('early')).toBe(RED);
    expect(colors.get('orange')).toBe(PRESENCE_COLORS[1]);
    expect(colors.get('late')).toBe(PRESENCE_COLORS[2]);
    const last = PRESENCE_COLORS[PRESENCE_COLORS.length - 1];
    const wrapped = assignColors([candidate('a', 1, null, last), candidate('b', 2, null, last)]);
    expect(wrapped.get('b')).toBe(RED);
  });

  it('gives the same answer whatever order the peers are listed in, so every screen agrees', () => {
    const people = [candidate('p1', 3, RED_ID), candidate('p2', 3, RED_ID), candidate('p3', 3, ORANGE_ID), candidate('old', null, null), candidate('p4', 1, 'aaaaaaaaaaaaaaa0')];
    const expected = assignColors(people);
    expect(assignColors([...people].reverse())).toEqual(expected);
    expect(assignColors([people[2], people[0], people[4], people[3], people[1]])).toEqual(expected);
    // A build without presence ids goes first, since it keeps its own colour on its own screen.
    expect(expected.get('old')).toBe(RED);
    // Same join time and id (two tabs in one browser): the peer id breaks the tie.
    expect(expected.get('p1')).not.toBe(expected.get('p2'));
    expect(new Set(expected.values()).size).toBe(people.length);
  });

  it('repeats colours only past eight people', () => {
    const people = Array.from({ length: 9 }, (_, i) => candidate(`p${i}`, i, RED_ID));
    const colors = assignColors(people);
    expect(new Set([...colors.values()].slice(0, 8)).size).toBe(8);
    expect(colors.get('p8')).toBe(RED);
  });
});

describe('colours and names', () => {
  it('only uses colours readable in light and dark themes', () => {
    for (const color of PRESENCE_COLORS) {
      // White initials and name labels on the colour.
      expect(contrast(color, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      // The caret and avatar against the dark editor and the dark page.
      expect(contrast(color, '#1e1e1e')).toBeGreaterThanOrEqual(3);
      expect(contrast(color, '#0a0a0a')).toBeGreaterThanOrEqual(3);
    }
  });

  it('gives each peer id the same colour every time, spread over the palette', () => {
    expect(colorForPeer('peer-a')).toBe(colorForPeer('peer-a'));
    const used = new Set(Array.from({ length: 64 }, (_, i) => colorForPeer(`peer-${i}`)));
    expect(used.size).toBeGreaterThan(4);
    for (const color of used) expect(PRESENCE_COLORS).toContain(color);
    expect(lightColor('#dc2626')).toBe('#dc262633');
  });

  it('makes anonymous animal names that pass the name check', () => {
    expect(anonymousName(() => 0)).toBe('Brave Badger');
    expect(anonymousName(() => 0.999)).toBe('Wise Walrus');
    const name = anonymousName();
    expect(parseAwarenessMessage(message(goodState({ name })))).not.toBeNull();
  });

  it('takes initials from the first two words', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('grace')).toBe('G');
    expect(initials('  Curious   Otter  Three ')).toBe('CO');
    expect(initials('   ')).toBe('?');
    expect(initials('😀 smile')).toBe('😀S');
  });
});

describe('RateLimiter', () => {
  it('allows a burst, then refills at the given rate, per key', () => {
    let now = 0;
    const limiter = new RateLimiter(3, 2, () => now);
    expect([1, 2, 3, 4].map(() => limiter.allow('a'))).toEqual([true, true, true, false]);
    // Other peers have their own bucket.
    expect(limiter.allow('b')).toBe(true);
    now = 500; // one token back
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(false);
    now = 60_000; // full again, but never more than the burst
    expect([1, 2, 3, 4].map(() => limiter.allow('a'))).toEqual([true, true, true, false]);
    limiter.forget('a');
    expect(limiter.allow('a')).toBe(true);
  });
});

describe('toWireState', () => {
  it('sends a cursor only when it is in the open file', () => {
    const doc = new Y.Doc();
    const text = doc.getText(TNAME);
    text.insert(0, 'hello');
    const cursor = { anchor: Y.createRelativePositionFromTypeIndex(text, 1), head: Y.createRelativePositionFromTypeIndex(text, 5) };
    const state: PresenceState = { user: { name: 'Ada', color: RED, colorLight: lightColor(RED) }, file: FILE, cursor };
    const wire = toWireState(state);
    expect(wire.cursor?.anchor).toEqual({ tname: TNAME, item: { client: doc.clientID, clock: 1 } });
    expect(wire.cursor?.head).toEqual({ tname: TNAME });
    expect(parseAwarenessMessage(message(wire))).not.toBeNull();
    expect(toWireState({ ...state, file: 'other' }).cursor).toBeNull();
    expect(toWireState({ ...state, file: null }).cursor).toBeNull();
  });
});

describe('PresenceSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(hasType: (name: string) => boolean = () => true) {
    const awareness = new PresenceAwareness({ name: 'Me', color: RED, colorLight: lightColor(RED) });
    const send = vi.fn<(message: AwarenessMessage, peerId?: string) => void>();
    const onPeersChange = vi.fn();
    const sync = new PresenceSync({ awareness, self: { peerId: 'me', presenceId: RED_ID }, send, hasType, onPeersChange });
    return { awareness, send, onPeersChange, sync };
  }

  it('sends our state on start, to new peers, and on a heartbeat', () => {
    const { send, sync } = setup();
    sync.start();
    sync.start(); // a second start does nothing
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ kind: 'awareness', clock: 1, state: { name: 'Me', color: RED, file: null, cursor: null } });
    sync.peerJoined('peer-1');
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ clock: 2 }), 'peer-1');
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2][1]).toBeUndefined();
  });

  it('sends local changes at most once per interval, with the latest state', () => {
    const { awareness, send, sync } = setup();
    sync.start();
    send.mockClear();
    vi.advanceTimersByTime(SEND_INTERVAL_MS);
    awareness.setLocalStateField('file', 'a');
    expect(send).toHaveBeenCalledTimes(1);
    awareness.setLocalStateField('file', 'b');
    awareness.setLocalStateField('file', 'c');
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SEND_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].state?.file).toBe('c');
    // A remote change isn't ours to send.
    awareness.setRemoteState(5, null);
    vi.advanceTimersByTime(SEND_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('never sends a message over the size cap', () => {
    const { awareness, send, sync } = setup();
    awareness.setLocalStateField('user', { name: 'x'.repeat(MAX_PRESENCE_BYTES), color: RED, colorLight: '' });
    sync.start();
    expect(send).not.toHaveBeenCalled();
  });

  it('puts valid peer states into the awareness and lists the peers', () => {
    const { awareness, onPeersChange, sync } = setup();
    sync.start();
    sync.receive(message(), 'peer-1');
    const [peer] = sync.list();
    expect(peer).toMatchObject({ peerId: 'peer-1', name: 'Ada Lovelace', color: RED, file: FILE });
    expect(peer.cursor?.head).toBeInstanceOf(Y.RelativePosition);
    const state = awareness.getStates().get(peer.clientId);
    expect(state?.user).toEqual({ name: 'Ada Lovelace', color: RED, colorLight: lightColor(RED) });
    expect(onPeersChange).toHaveBeenCalledTimes(1);
    // A cursor move only updates the editor, not the avatars.
    sync.receive(message(goodState(), 2), 'peer-1');
    expect(onPeersChange).toHaveBeenCalledTimes(1);
    sync.receive(message(goodState({ file: null, cursor: null }), 3), 'peer-1');
    expect(onPeersChange).toHaveBeenCalledTimes(2);
    expect(sync.list()[0].clientId).toBe(peer.clientId);
  });

  it('ignores old clocks, junk, and messages before start', () => {
    const { sync } = setup();
    sync.receive(message(), 'peer-1');
    expect(sync.list()).toEqual([]);
    sync.start();
    sync.receive(message(goodState(), 5), 'peer-1');
    sync.receive(message(goodState({ name: 'Older' }), 4), 'peer-1');
    expect(sync.list()[0].name).toBe('Ada Lovelace');
    sync.receive({ kind: 'awareness', clock: 6, state: { name: '<b>' } }, 'peer-1');
    expect(sync.list()[0].name).toBe('Ada Lovelace');
  });

  it('drops a cursor into a root type the doc does not have, so nothing new gets created', () => {
    const { sync } = setup(() => false);
    sync.start();
    sync.receive(message(), 'peer-1');
    expect(sync.list()[0]).toMatchObject({ file: FILE, cursor: null });
  });

  it('rate-limits each peer', () => {
    const { sync } = setup();
    sync.start();
    for (let clock = 1; clock <= RECEIVE_BURST; clock++) sync.receive(message(goodState(), clock), 'peer-1');
    sync.receive(message(goodState({ name: 'Flood' }), 1000), 'peer-1');
    expect(sync.list()[0].name).toBe('Ada Lovelace');
    vi.advanceTimersByTime(Math.ceil(1000 / RECEIVE_PER_SECOND) + 1);
    sync.receive(message(goodState({ name: 'Later' }), 1001), 'peer-1');
    expect(sync.list()[0].name).toBe('Later');
  });

  it('clears a peer that leaves, says it is leaving, or times out', () => {
    const { awareness, onPeersChange, sync } = setup();
    sync.start();
    sync.receive(message(), 'leaver');
    sync.receive(message(), 'quitter');
    sync.receive(message(), 'quiet');
    expect(awareness.getStates().size).toBe(4);

    sync.peerLeft('leaver');
    sync.peerLeft('nobody'); // unknown peers are fine
    sync.receive(message(null, 2), 'quitter');
    sync.receive(message(null, 1), 'never-seen');
    expect(sync.list().map((peer) => peer.peerId)).toEqual(['quiet']);

    onPeersChange.mockClear();
    vi.advanceTimersByTime(PEER_TIMEOUT_MS - 1000);
    expect(sync.list()).toHaveLength(1);
    vi.advanceTimersByTime(PEER_TIMEOUT_MS / 6 + 1000);
    expect(sync.list()).toEqual([]);
    expect(onPeersChange).toHaveBeenCalledWith([]);
    expect([...awareness.getStates().keys()]).toEqual([0]);
  });

  it('keeps a peer that sends heartbeats', () => {
    const { sync } = setup();
    sync.start();
    for (let i = 1; i <= 4; i++) {
      sync.receive(message(goodState(), i), 'peer-1');
      vi.advanceTimersByTime(HEARTBEAT_MS);
    }
    expect(sync.list()).toHaveLength(1);
  });

  it('on stop, says goodbye, forgets everyone and stops sending', () => {
    const { awareness, send, sync } = setup();
    sync.start();
    sync.receive(message(), 'peer-1');
    send.mockClear();
    sync.stop();
    sync.stop();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ kind: 'awareness', state: null });
    expect(parseAwarenessMessage(send.mock.calls[0][0])).not.toBeNull();
    expect(sync.list()).toEqual([]);
    expect(awareness.getStates().size).toBe(1);
    awareness.setLocalStateField('file', 'x');
    sync.peerJoined('peer-2');
    vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a pending throttled send does nothing after stop', () => {
    const { awareness, send, sync } = setup();
    sync.start();
    awareness.setLocalStateField('file', 'a');
    sync.stop();
    send.mockClear();
    vi.advanceTimersByTime(SEND_INTERVAL_MS * 2);
    expect(send).not.toHaveBeenCalled();
  });

  it('every message it sends passes the receiving check', () => {
    const doc = new Y.Doc();
    const text = doc.getText(TNAME);
    text.insert(0, 'abc');
    const { awareness, send, sync } = setup();
    awareness.setLocalState({
      user: { name: anonymousName(), color: colorForPeer('me'), colorLight: '' },
      file: FILE,
      cursor: { anchor: Y.createRelativePositionFromTypeIndex(text, 0), head: Y.createRelativePositionFromTypeIndex(text, 3, -1) },
    });
    sync.start();
    // Through JSON, the way Trystero sends it.
    const wire = JSON.parse(JSON.stringify(send.mock.calls[0][0]));
    expect(parseAwarenessMessage(wire)?.state?.cursor).not.toBeNull();
  });
  it('sends our presence id and when we joined, and every peer works out the same distinct colours', () => {
    vi.setSystemTime(1_000);
    // Three tabs, two of whose ids prefer red, wired to each other like a room.
    const tabs = ['tab-a', 'tab-b', 'tab-c'].map((peerId, i) => {
      const awareness = new PresenceAwareness({ name: `Tab ${i}`, color: RED, colorLight: '' });
      return { peerId, awareness, sync: null as unknown as PresenceSync, presenceId: i === 2 ? ORANGE_ID : RED_ID };
    });
    for (const tab of tabs) {
      tab.sync = new PresenceSync({
        awareness: tab.awareness,
        self: { peerId: tab.peerId, presenceId: tab.presenceId },
        hasType: () => true,
        send: (wire, to) => {
          for (const other of tabs) if (other !== tab && (!to || to === other.peerId)) other.sync.receive(JSON.parse(JSON.stringify(wire)), tab.peerId);
        },
      });
    }
    tabs[0].sync.start();
    vi.advanceTimersByTime(5_000);
    tabs[1].sync.start();
    tabs[2].sync.start();
    tabs[0].sync.peerJoined('tab-b');
    tabs[0].sync.peerJoined('tab-c');
    tabs[1].sync.peerJoined('tab-c');
    vi.advanceTimersByTime(SEND_INTERVAL_MS * 2);

    const view = (tab: (typeof tabs)[number]) =>
      Object.fromEntries([[tab.peerId, tab.awareness.getLocalState()?.user.color], ...tab.sync.list().map((peer) => [peer.peerId, peer.color])]);
    const first = view(tabs[0]);
    // The first tab keeps red. The other two joined together, so the smaller presence id goes
    // first: tab-c keeps orange, and tab-b, which also wanted red, gets the next free colour.
    expect(first).toEqual({ 'tab-a': RED, 'tab-b': PRESENCE_COLORS[2], 'tab-c': PRESENCE_COLORS[1] });
    expect(view(tabs[1])).toEqual(first);
    expect(view(tabs[2])).toEqual(first);
    // The editor gets the same colours as the avatars.
    const remote = [...tabs[0].awareness.getStates().values()].map((state) => state.user.color);
    expect(new Set(remote).size).toBe(3);

    // When the first tab leaves, the others get their preferred colours back.
    tabs[0].sync.stop();
    vi.advanceTimersByTime(SEND_INTERVAL_MS * 2);
    expect(view(tabs[1])).toEqual({ 'tab-b': RED, 'tab-c': PRESENCE_COLORS[1] });
    expect(view(tabs[2])).toEqual(view(tabs[1]));
  });

  it('a peer from before presence ids keeps the colour it sends, and we move off it', () => {
    const { awareness, onPeersChange, send, sync } = setup();
    sync.start();
    expect(send.mock.lastCall?.[0].state).toMatchObject({ color: RED, id: RED_ID, joined: expect.any(Number) });
    sync.receive(message(goodState({ color: RED })), 'old-peer');
    expect(sync.list()[0].color).toBe(RED);
    expect(awareness.getLocalState()?.user.color).toBe(PRESENCE_COLORS[1]);
    expect(onPeersChange).toHaveBeenCalledTimes(1);
    // Our new colour goes out so the old peer sees it too.
    vi.advanceTimersByTime(SEND_INTERVAL_MS);
    expect(send.mock.lastCall?.[0].state?.color).toBe(PRESENCE_COLORS[1]);
    // It goes quiet and is dropped: we get red back.
    vi.advanceTimersByTime(PEER_TIMEOUT_MS * 2);
    expect(sync.list()).toEqual([]);
    expect(awareness.getLocalState()?.user.color).toBe(RED);
  });

  it('answers the first message from a peer directly, but not later ones', () => {
    const { send, sync } = setup();
    sync.start();
    send.mockClear();
    sync.receive(message(), 'peer-1');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toBe('peer-1');
    sync.receive(message(goodState(), 2), 'peer-1');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a peer that joined before us and shares our preferred colour keeps it', () => {
    vi.setSystemTime(10_000);
    const { awareness, sync } = setup();
    sync.start();
    sync.receive(message(goodState({ id: RED_ID, joined: 5_000 })), 'earlier');
    sync.receive(message(goodState({ id: RED_ID, joined: 20_000 })), 'later');
    expect(sync.list().map((peer) => peer.color)).toEqual([RED, PRESENCE_COLORS[2]]);
    expect(awareness.getLocalState()?.user.color).toBe(PRESENCE_COLORS[1]);
    // A cursor move doesn't change anyone's colour.
    sync.receive(message(goodState({ id: RED_ID, joined: 20_000 }), 2), 'later');
    expect(sync.list()[1].color).toBe(PRESENCE_COLORS[2]);
    sync.peerLeft('earlier');
    expect(awareness.getLocalState()?.user.color).toBe(RED);
    expect(sync.list()[0].color).toBe(PRESENCE_COLORS[1]);
  });
});
