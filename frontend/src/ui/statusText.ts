import type { TransportState } from '../net/p2pTransport';

export type ConnectionInfo = {
  isHost: boolean;
  /** False until the host clicks Share. Guests are always in a room. */
  inRoom: boolean;
  state: TransportState;
  peers: number;
};

/**
 * Short text for the connection pill. It says who's here instead of the raw transport state,
 * since nobody showing up yet is normal for a host.
 */
export function connectionText({ isHost, inRoom, state, peers }: ConnectionInfo): string {
  if (!inRoom) return 'Not shared';
  if (peers > 0) {
    const who = peers === 1 ? '1 other person' : `${peers} other people`;
    // Relayed still works, it just goes through a TURN server, so we only mention it.
    return state === 'Relayed' ? `Connected with ${who} (relayed)` : `Connected with ${who}`;
  }
  if (isHost) return 'Shared, waiting for others';
  if (state === 'Reconnecting') return "Can't reach the host";
  return 'Looking for the host';
}

/** True when a guest lost the host and nobody else is around, which is worth a notice with help. */
export function connectionFailed({ isHost, inRoom, state, peers }: ConnectionInfo): boolean {
  return !isHost && inRoom && peers === 0 && state === 'Reconnecting';
}

const SAVED = /^Saved( to .+)?$/;

/** Check if a status line means a save just finished. */
export const isSavedStatus = (status: string) => SAVED.test(status);

/** Add the time to a "Saved to ..." status, so you can tell how fresh it is. */
export function saveStatusText(status: string, savedAt: Date | null, locale?: string): string {
  if (!savedAt || !SAVED.test(status)) return status;
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(savedAt);
  return `${status} at ${time}`;
}
