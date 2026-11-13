// Decide whether closing or reloading the tab should ask "Leave site? Changes may not be saved" (issue #121).
// The unload handler writes the session to localStorage first, so edits that only live in the
// autosave debounce are already safe on the host's local storage. Only ask for work that a
// synchronous write can't keep.
import type { SessionWriteResult } from '../state/appSession';

export type LeaveState = {
  /** The tab is reloading for an update and already saved. Never ask then. */
  reloadingForUpdate: boolean;
  /** Edits the autosave hasn't written to the project's storage yet. */
  unsavedEdits: boolean;
  /** Saving is paused, so edits only go to storage once the person resumes. */
  savingPaused: boolean;
  /** Where the project saves: local is this browser, which the session write covers. */
  provider: 'local' | 'drive';
  /** How the synchronous session write in the unload handler went. */
  sessionWrite: SessionWriteResult;
  /** The last save to storage failed and nothing has saved since. */
  saveFailed: boolean;
  /** Files held by a storage conflict, waiting for the person to pick a version. */
  heldConflicts: number;
  /** Files still uploading, or still arriving from a peer. */
  filesInFlight: number;
};

/** Why leaving now could lose work, or null when it's safe. */
export function unsavedReason(state: LeaveState): string | null {
  if (state.reloadingForUpdate) return null;
  if (state.heldConflicts > 0) return 'files are waiting for you to pick a version';
  if (state.filesInFlight > 0) return 'files are still uploading or arriving';
  if (state.saveFailed) return 'the last save failed';
  if (!state.unsavedEdits) return null;
  if (state.savingPaused) return 'saving is paused';
  // Drive (or any remote provider) hasn't got these edits yet.
  if (state.provider !== 'local') return 'edits are not saved to storage yet';
  // In this browser, the whole doc just went to localStorage, and the next load saves it properly.
  return state.sessionWrite === 'full' ? null : 'edits could not be kept in this browser';
}

export const shouldConfirmLeave = (state: LeaveState): boolean => unsavedReason(state) !== null;
