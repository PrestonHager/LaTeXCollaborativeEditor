// Presence for a shared room (issue #22): who's here, which file they have open, and their cursor.
// Loads with sharing (see app/presenceFlow.ts), not in the initial bundle.
//
// It travels as `{ kind: 'awareness', ... }` on the same `doc-msg` action as the rest of the sync
// messages. Builds from before presence drop it as an unknown kind, so they keep syncing. A new
// Trystero action wouldn't be safe: Trystero 0.26 holds messages for action names it doesn't know
// (in case a handler shows up later), up to 64 per peer for 2 minutes, and once that queue is full
// it refuses that peer's large transfers too, like a snapshot. See docs/protocol.md.
import * as Y from 'yjs';
import { LOCAL_CLIENT_ID, type PresenceAwareness, type PresenceCursor, type PresenceState } from './awareness';
import { cleanDisplayName, isPresenceId, MAX_DISPLAY_NAME_LENGTH } from '../state/settings';
import { dropMessage } from './messages';

/**
 * Peer colours. Each one has at least 4.5:1 contrast with white (the name label's text and the
 * avatar initials) and at least 3:1 with the dark editor background (#1e1e1e), so carets and
 * avatars stand out in both themes. presence.test.ts checks this.
 */
export const PRESENCE_COLORS = ['#dc2626', '#c2410c', '#a16207', '#15803d', '#0e7490', '#2563eb', '#9333ea', '#db2777'] as const;

/** How often we send our state at most, in ms. Changes in between go out together at the end. */
export const SEND_INTERVAL_MS = 100;
/** We resend our state this often even when nothing changed, so peers know we're still here. */
export const HEARTBEAT_MS = 15_000;
/** A peer we haven't heard from for this long is dropped, like y-protocols' outdated timeout. */
export const PEER_TIMEOUT_MS = 30_000;
/** Incoming: each peer can burst this many messages, then gets RECEIVE_PER_SECOND a second. */
export const RECEIVE_BURST = 30;
export const RECEIVE_PER_SECOND = 15;
/** We never send a presence message bigger than this (as JSON). A valid one is well under it. */
export const MAX_PRESENCE_BYTES = 1024;

const COLOR_SET: ReadonlySet<string> = new Set(PRESENCE_COLORS);
const FILE_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
// Every text file is a root Y.Text named file:<id>, or `doc` in projects from before multi-file.
const TYPE_NAME_PATTERN = /^(?:doc|file:[A-Za-z0-9-]{1,64})$/;
// Yjs client ids are unsigned 32-bit numbers. Clocks count operations, so they fit in a safe integer.
const MAX_CLIENT_ID = 0xffffffff;

/** A relative position as JSON. Only root types (named by `tname`) are allowed, which covers every file. */
export type WirePosition = { tname: string; item?: { client: number; clock: number }; assoc?: number };
/**
 * `id` (a random 16-hex presence id, kept in settings) and `joined` (when the sender started
 * sharing, ms since 1970 on its clock) pick the colour. They come together; builds from #163 send
 * neither, and their `color` is used as is.
 */
export type WireState = {
  name: string;
  color: string;
  file: string | null;
  cursor: { anchor: WirePosition; head: WirePosition } | null;
  id?: string;
  joined?: number;
};
/** `state: null` means the sender stopped sharing or is leaving. */
export type AwarenessMessage = { kind: 'awareness'; clock: number; state: WireState | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const isCount = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;

/** The Y.Text name a file's cursor points into. */
export const typeNameForFile = (file: string) => (file === 'doc' ? 'doc' : `file:${file}`);

function parsePosition(value: unknown): WirePosition | null {
  if (!isRecord(value) || typeof value.tname !== 'string' || !TYPE_NAME_PATTERN.test(value.tname)) return null;
  const { item, assoc } = value;
  if (assoc !== undefined && assoc !== -1 && assoc !== 0 && assoc !== 1) return null;
  // `type` (a nested type's id) is never used for our files, so a position with one is junk.
  if (value.type !== undefined && value.type !== null) return null;
  const position: WirePosition = { tname: value.tname };
  if (item !== undefined && item !== null) {
    if (!isRecord(item) || !isCount(item.client, MAX_CLIENT_ID) || !isCount(item.clock)) return null;
    position.item = { client: item.client, clock: item.clock };
  }
  if (assoc !== undefined) position.assoc = assoc;
  return position;
}

function parseState(value: unknown): WireState | null {
  if (!isRecord(value)) return null;
  const { name, color, file, cursor, id, joined } = value;
  // Check the length before cleaning, so a huge string isn't walked character by character.
  if (typeof name !== 'string' || name.length > MAX_DISPLAY_NAME_LENGTH * 2 || cleanDisplayName(name) !== name) return null;
  if (typeof color !== 'string' || !COLOR_SET.has(color)) return null;
  if (file !== null && (typeof file !== 'string' || !FILE_ID_PATTERN.test(file))) return null;
  // Both or neither: an id without a join time (or the other way round) is junk.
  const hasId = id !== undefined;
  if (hasId !== (joined !== undefined) || (hasId && (!isPresenceId(id) || !isCount(joined)))) return null;
  let parsedCursor: WireState['cursor'] = null;
  if (cursor !== null) {
    if (!isRecord(cursor) || file === null) return null;
    const anchor = parsePosition(cursor.anchor);
    const head = parsePosition(cursor.head);
    // A cursor has to be in the file the peer says it has open.
    const tname = typeNameForFile(file);
    if (!anchor || !head || anchor.tname !== tname || head.tname !== tname) return null;
    parsedCursor = { anchor, head };
  }
  const state: WireState = { name, color, file, cursor: parsedCursor };
  if (hasId) Object.assign(state, { id, joined });
  return state;
}

/**
 * Check a presence message from a peer. Returns it with only the fields we know, or null when
 * anything is the wrong type, too long, or not one of our colours.
 */
export function parseAwarenessMessage(payload: unknown): AwarenessMessage | null {
  if (!isRecord(payload) || payload.kind !== 'awareness' || !isCount(payload.clock)) return null;
  if (payload.state === null) return { kind: 'awareness', clock: payload.clock, state: null };
  const state = parseState(payload.state);
  return state ? { kind: 'awareness', clock: payload.clock, state } : null;
}

/** FNV-1a, so the same peer id gets the same colour on every screen. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The colour someone would like: from their presence id, or the peer id for builds without one. */
export const colorForPeer = (id: string): string => PRESENCE_COLORS[hash(id) % PRESENCE_COLORS.length];

/** Someone in the room, as far as colours go. `joined` and `presenceId` are null for builds from #163. */
export type ColorCandidate = { peerId: string; presenceId: string | null; joined: number | null; preferred: string };

/**
 * Give everyone in the room a colour, keyed by peer id. Each person gets their preferred colour
 * unless someone who joined earlier already has it; then they get the next free one in the
 * palette. Only with more than eight people do colours repeat.
 *
 * The order only uses what every peer sends (join time, presence id, peer id), so every screen
 * that sees the same people works out the same colours. Builds from #163 go first, since they
 * keep their own colour on their own screen.
 */
export function assignColors(candidates: ColorCandidate[]): Map<string, string> {
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const order = [...candidates].sort(
    (a, b) => (a.joined ?? -1) - (b.joined ?? -1) || compare(a.presenceId ?? '', b.presenceId ?? '') || compare(a.peerId, b.peerId),
  );
  const taken = new Set<string>();
  const colors = new Map<string, string>();
  for (const candidate of order) {
    const start = Math.max(0, PRESENCE_COLORS.indexOf(candidate.preferred as (typeof PRESENCE_COLORS)[number]));
    let color = PRESENCE_COLORS[start] as string;
    for (let step = 0; step < PRESENCE_COLORS.length; step++) {
      const next = PRESENCE_COLORS[(start + step) % PRESENCE_COLORS.length];
      if (!taken.has(next)) {
        color = next;
        break;
      }
    }
    taken.add(color);
    colors.set(candidate.peerId, color);
  }
  return colors;
}
/** The selection highlight: the colour at 20% opacity, as y-codemirror.next does by default. */
export const lightColor = (color: string) => `${color}33`;

const ADJECTIVES = ['Brave', 'Calm', 'Clever', 'Curious', 'Gentle', 'Happy', 'Jolly', 'Keen', 'Lively', 'Lucky', 'Quick', 'Quiet', 'Sunny', 'Swift', 'Witty', 'Wise'];
const ANIMALS = ['Badger', 'Beaver', 'Capybara', 'Dolphin', 'Falcon', 'Fox', 'Heron', 'Koala', 'Lynx', 'Narwhal', 'Otter', 'Owl', 'Panda', 'Puffin', 'Raccoon', 'Walrus'];

/** A name for someone who hasn't picked one, like "Curious Otter". */
export function anonymousName(random: () => number = Math.random): string {
  const pick = (list: string[]) => list[Math.floor(random() * list.length) % list.length];
  return `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
}

/** One or two letters for an avatar: the first letters of the first two words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => [...word][0]);
  return (letters.join('') || '?').toUpperCase();
}

/**
 * A token bucket per key. Each key starts with `burst` tokens and gets `perSecond` back each second.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly burst: number;
  private readonly perSecond: number;
  private readonly now: () => number;

  constructor(burst: number, perSecond: number, now: () => number = Date.now) {
    this.burst = burst;
    this.perSecond = perSecond;
    this.now = now;
  }

  allow(key: string): boolean {
    const now = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    bucket.tokens = Math.min(this.burst, bucket.tokens + ((now - bucket.at) / 1000) * this.perSecond);
    bucket.at = now;
    this.buckets.set(key, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  forget(key: string) {
    this.buckets.delete(key);
  }
}

/** A peer in the room, as the UI shows it. */
export type PresencePeer = {
  peerId: string;
  clientId: number;
  name: string;
  color: string;
  file: string | null;
  cursor: PresenceCursor | null;
};

type PresenceSyncOptions = {
  awareness: PresenceAwareness;
  /** Our Trystero peer id and saved presence id, for working out colours the way peers do. */
  self: { peerId: string; presenceId: string };
  /** Send on the document channel, to one peer or (without peerId) everyone. */
  send: (message: AwarenessMessage, peerId?: string) => void;
  /** Whether the shared doc has a root type with this name. Cursors into anything else are dropped. */
  hasType: (name: string) => boolean;
  /** Runs when someone joins, leaves, moves to another file or changes name. */
  onPeersChange?: (peers: PresencePeer[]) => void;
  now?: () => number;
};

type RemotePeer = PresencePeer & { clock: number; lastSeen: number; presenceId: string | null; joined: number | null; sentColor: string };

/** Turn our awareness state into what goes on the wire. Cursor positions become plain JSON. */
export function toWireState(state: PresenceState): WireState {
  const toWire = (position: Y.RelativePosition): WirePosition => {
    const json = Y.relativePositionToJSON(position) as { tname?: string; item?: { client: number; clock: number }; assoc?: number };
    return { tname: json.tname ?? '', ...(json.item ? { item: { client: json.item.client, clock: json.item.clock } } : {}), ...(json.assoc ? { assoc: json.assoc } : {}) };
  };
  let cursor: WireState['cursor'] = null;
  if (state.file && state.cursor) {
    const anchor = toWire(state.cursor.anchor);
    const head = toWire(state.cursor.head);
    const tname = typeNameForFile(state.file);
    // Right after a file switch the editor can still hold a cursor in the old file. Don't send it.
    if (anchor.tname === tname && head.tname === tname) cursor = { anchor, head };
  }
  return { name: state.user.name, color: state.user.color, file: state.file, cursor };
}

/**
 * Sends our presence and keeps track of everyone else's. Remote states go into the awareness, so
 * the editor draws their cursors, and are dropped when the peer leaves or goes quiet.
 */
export class PresenceSync {
  private readonly options: PresenceSyncOptions;
  private readonly now: () => number;
  private readonly peers = new Map<string, RemotePeer>();
  private readonly limiter: RateLimiter;
  private nextClientId = LOCAL_CLIENT_ID + 1;
  private clock = 0;
  private lastSent = -Infinity;
  private sendTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private sweeper: ReturnType<typeof setInterval> | undefined;
  private running = false;
  /** When we started sharing. Peers that joined earlier keep their colour if ours clashes. */
  private joined = 0;
  private readonly onLocalChange = (_change: unknown, origin: 'local' | 'remote') => {
    if (origin === 'local') this.scheduleSend();
  };

  constructor(options: PresenceSyncOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.limiter = new RateLimiter(RECEIVE_BURST, RECEIVE_PER_SECOND, this.now);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.joined = Math.floor(this.now());
    this.recolor();
    this.options.awareness.on('change', this.onLocalChange);
    this.heartbeat = setInterval(() => this.sendNow(), HEARTBEAT_MS);
    this.sweeper = setInterval(() => this.removeQuiet(), PEER_TIMEOUT_MS / 6);
    this.sendNow();
  }

  /** Tell everyone we're gone, and forget every peer. */
  stop() {
    if (!this.running) return;
    this.running = false;
    this.options.awareness.off('change', this.onLocalChange);
    clearTimeout(this.sendTimer);
    clearInterval(this.heartbeat);
    clearInterval(this.sweeper);
    this.sendTimer = undefined;
    this.options.send({ kind: 'awareness', clock: ++this.clock, state: null });
    for (const peerId of [...this.peers.keys()]) this.remove(peerId);
    this.emit();
  }

  /** A new peer gets our state right away instead of waiting for the next change or heartbeat. */
  peerJoined(peerId: string) {
    if (this.running) this.options.send(this.message(), peerId);
  }

  peerLeft(peerId: string) {
    this.limiter.forget(peerId);
    if (this.remove(peerId)) this.changed();
  }

  /** Handle `{ kind: 'awareness' }` from a peer. Anything over the rate limit or malformed is dropped. */
  receive(payload: unknown, peerId: string) {
    if (!this.running) return;
    if (!this.limiter.allow(peerId)) {
      dropMessage('presence over the rate limit', peerId);
      return;
    }
    const message = parseAwarenessMessage(payload);
    if (!message) {
      dropMessage('malformed presence', payload);
      return;
    }
    const known = this.peers.get(peerId);
    if (known && message.clock <= known.clock) return;
    if (!message.state) {
      if (this.remove(peerId)) this.changed();
      return;
    }
    const { name, color: sentColor, file } = message.state;
    const presenceId = message.state.id ?? null;
    const joined = message.state.joined ?? null;
    let cursor: PresenceCursor | null = null;
    const wire = message.state.cursor;
    // Turning a position with an unknown root name into an absolute one would create that type, so check first.
    if (wire && this.options.hasType(wire.head.tname)) {
      cursor = { anchor: Y.createRelativePositionFromJSON(wire.anchor), head: Y.createRelativePositionFromJSON(wire.head) };
    }
    const peer: RemotePeer = {
      peerId,
      clientId: known?.clientId ?? this.nextClientId++,
      name,
      // Recolouring below fixes this up; keep the old colour meanwhile so it doesn't flicker.
      color: known?.color ?? sentColor,
      file,
      cursor,
      clock: message.clock,
      lastSeen: this.now(),
      presenceId,
      joined,
      sentColor,
    };
    this.peers.set(peerId, peer);
    // Someone new, or someone whose id or join time changed, can shift who gets which colour.
    const reorder = !known || known.presenceId !== presenceId || known.joined !== joined || known.sentColor !== sentColor;
    const recolored = reorder && this.recolor();
    this.setAwareness(peer);
    // Cursor moves happen a lot and only the editor needs them; the avatars and tree care about the rest.
    if (!known || recolored || known.name !== name || known.file !== file) this.emit();
    // The first we hear from someone, answer them directly. Our join-time send can reach them
    // before their presence has loaded, and they'd otherwise wait for our next heartbeat to learn
    // our colour (and so may briefly show the same one).
    if (!known) this.peerJoined(peerId);
  }

  /** Everyone else in the room who has said where they are, in the order they arrived. */
  list(): PresencePeer[] {
    return [...this.peers.values()].map(({ peerId, clientId, name, color, file, cursor }) => ({ peerId, clientId, name, color, file, cursor }));
  }

  private message(): AwarenessMessage {
    const local = this.options.awareness.getLocalState();
    const state = local ? { ...toWireState(local), id: this.options.self.presenceId, joined: this.joined } : null;
    return { kind: 'awareness', clock: ++this.clock, state };
  }

  private setAwareness(peer: RemotePeer) {
    const { name, color, file, cursor } = peer;
    this.options.awareness.setRemoteState(peer.clientId, { user: { name, color, colorLight: lightColor(color) }, file, cursor });
  }

  /**
   * Work out everyone's colour again (see assignColors), ours included. Updates the awareness for
   * whoever changed; a change to ours goes out to peers. Returns whether any colour changed.
   */
  private recolor(): boolean {
    const { self } = this.options;
    const candidates: ColorCandidate[] = [
      { peerId: self.peerId, presenceId: self.presenceId, joined: this.joined, preferred: colorForPeer(self.presenceId) },
      ...[...this.peers.values()].map((peer) => ({
        peerId: peer.peerId,
        presenceId: peer.presenceId,
        joined: peer.joined,
        // A build from #163 picks its own colour from its peer id and sends it.
        preferred: peer.presenceId ? colorForPeer(peer.presenceId) : peer.sentColor,
      })),
    ];
    const colors = assignColors(candidates);
    let changed = false;
    for (const peer of this.peers.values()) {
      const color = colors.get(peer.peerId) as string;
      if (peer.color === color) continue;
      peer.color = color;
      this.setAwareness(peer);
      changed = true;
    }
    const local = this.options.awareness.getLocalState();
    const own = colors.get(self.peerId) as string;
    if (local && local.user.color !== own) {
      this.options.awareness.setLocalStateField('user', { ...local.user, color: own, colorLight: lightColor(own) });
      changed = true;
    }
    return changed;
  }

  /** Someone left: the people after them might get their preferred colour back. */
  private changed() {
    this.recolor();
    this.emit();
  }

  private scheduleSend() {
    if (!this.running || this.sendTimer !== undefined) return;
    const wait = this.lastSent + SEND_INTERVAL_MS - this.now();
    if (wait <= 0) {
      this.sendNow();
      return;
    }
    this.sendTimer = setTimeout(() => {
      this.sendTimer = undefined;
      this.sendNow();
    }, wait);
  }

  private sendNow() {
    if (!this.running) return;
    const message = this.message();
    // Every field is capped, so this only trips on a bug. Better to skip one update than send junk.
    if (JSON.stringify(message).length > MAX_PRESENCE_BYTES) return;
    this.lastSent = this.now();
    this.options.send(message);
  }

  private removeQuiet() {
    const cutoff = this.now() - PEER_TIMEOUT_MS;
    let changed = false;
    for (const peer of [...this.peers.values()]) {
      if (peer.lastSeen < cutoff) changed = this.remove(peer.peerId) || changed;
    }
    if (changed) this.changed();
  }

  private remove(peerId: string): boolean {
    const peer = this.peers.get(peerId);
    if (!peer) return false;
    this.peers.delete(peerId);
    this.options.awareness.setRemoteState(peer.clientId, null);
    return true;
  }

  private emit() {
    this.options.onPeersChange?.(this.list());
  }
}
