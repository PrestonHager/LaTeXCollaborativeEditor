// The host's room id lives in sessionStorage so a reload of the same tab can offer to resume it.
// It never rejoins on its own (issue #224). It's kept apart from the app session on purpose, since it's rendezvous data and not document content.
const HOST_ROOM_KEY = 'latex_editor_host_room_v1';

export function readHostRoomId(): string | null {
  try {
    const value = sessionStorage.getItem(HOST_ROOM_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export function writeHostRoomId(roomId: string): void {
  try {
    sessionStorage.setItem(HOST_ROOM_KEY, roomId);
  } catch (error) {
    // Blocked storage only means a reload starts a new room, so don't break sharing over it.
    console.warn('Could not remember the share room for this tab', error);
  }
}

/** Forget the room, so the next Share starts a new one (Stop sharing). */
export function clearHostRoomId(): void {
  try {
    sessionStorage.removeItem(HOST_ROOM_KEY);
  } catch {
    // Nothing was saved if storage is blocked.
  }
}
