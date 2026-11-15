import { clearHostRoomId, readHostRoomId, writeHostRoomId } from './hostRoom';

describe('hostRoom', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('returns null when no room was shared yet', () => {
    expect(readHostRoomId()).toBeNull();
  });

  it('remembers the room id across reads', () => {
    writeHostRoomId('room-1');
    expect(readHostRoomId()).toBe('room-1');
    writeHostRoomId('room-2');
    expect(readHostRoomId()).toBe('room-2');
  });

  it('forgets the room when sharing stops', () => {
    writeHostRoomId('room-1');
    clearHostRoomId();
    expect(readHostRoomId()).toBeNull();
  });

  it('ignores a blank stored value', () => {
    sessionStorage.setItem('latex_editor_host_room_v1', '  ');
    expect(readHostRoomId()).toBeNull();
  });

  it('survives blocked storage', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('sessionStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
    expect(() => writeHostRoomId('room-1')).not.toThrow();
    expect(() => clearHostRoomId()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(readHostRoomId()).toBeNull();
    vi.unstubAllGlobals();
  });
});
