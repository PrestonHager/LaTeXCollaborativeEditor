import {
  cleanDisplayName,
  isPresenceId,
  newPresenceId,
  createSettingsStore,
  defaultSettings,
  LEGACY_KEYBINDS_KEY,
  LEGACY_SESSION_KEY,
  LEGACY_TOUR_SEEN_KEY,
  readLegacySettings,
  sanitizeKeybinds,
  SETTINGS_FILE_FORMAT,
  SETTINGS_KEY,
  SETTINGS_VERSION,
} from './settings';

const memoryStore = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};

const brokenStore = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new DOMException('full', 'QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

/** A stand-in for window that lets a test fire the storage event another tab would cause. */
const eventTarget = () => {
  const target = new EventTarget();
  return Object.assign(target, {
    fire: (key: string | null) => target.dispatchEvent(Object.assign(new Event('storage'), { key })),
  });
};

const keybinds = { rules: [{ id: 'file.newFile' as const, keybind: 'Alt+N' }], disabled: ['edit.redo Mod+Y'] };

describe('settings store', () => {
  it('starts with the defaults and saves changes under one key', () => {
    const store = memoryStore();
    const settings = createSettingsStore({ storage: store, target: null, now: () => 7 });
    expect(settings.all()).toEqual(defaultSettings());
    expect(store.data.has(SETTINGS_KEY)).toBe(false);

    expect(settings.set('editorTheme', 'dark')).toBe(true);
    // Setting the same value again is not a change.
    expect(settings.set('editorTheme', 'dark')).toBe(false);
    const saved = JSON.parse(store.data.get(SETTINGS_KEY)!);
    expect(saved).toMatchObject({ version: SETTINGS_VERSION, values: { editorTheme: 'dark' }, updatedAt: { editorTheme: 7 } });
    expect(settings.updatedAt()).toEqual({ editorTheme: 7 });

    // A fresh store reads it back.
    expect(createSettingsStore({ storage: store, target: null }).get('editorTheme')).toBe('dark');
  });

  it('ignores values that do not fit the schema and clamps the split', () => {
    const settings = createSettingsStore({ storage: memoryStore(), target: null });
    expect(settings.update({ editorTheme: 'purple' as never, layoutMode: 'sideways' as never, splitRatio: 5 })).toEqual(['splitRatio']);
    expect(settings.get('splitRatio')).toBe(0.8);
    expect(settings.get('editorTheme')).toBe('system');
    expect(settings.update({ splitRatio: Number.NaN, tourSeen: 'yes' as never, unknown: 1 } as never)).toEqual([]);
  });

  it('hands out copies, so changing a returned value does not change the store', () => {
    const settings = createSettingsStore({ storage: memoryStore(), target: null });
    settings.set('keybinds', keybinds);
    settings.get('keybinds').rules.length = 0;
    expect(settings.get('keybinds')).toEqual(keybinds);
  });

  it('tells listeners what changed and where from, and keeps going when one throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const settings = createSettingsStore({ storage: memoryStore(), target: null });
    const seen: unknown[] = [];
    settings.subscribe(() => {
      throw new Error('boom');
    });
    const stop = settings.subscribe((changed, source) => seen.push([changed, source]));
    settings.update({ editorTheme: 'dark', previewTheme: 'light' });
    settings.reset(['appearance']);
    stop();
    settings.set('tourSeen', true);
    expect(seen).toEqual([
      [['editorTheme', 'previewTheme'], 'local'],
      [['editorTheme', 'previewTheme'], 'reset'],
    ]);
    vi.restoreAllMocks();
  });

  it('resets everything or one section', () => {
    const settings = createSettingsStore({ storage: memoryStore(), target: null });
    settings.update({ editorTheme: 'dark', layoutMode: 'editor-only', keybinds, tourSeen: true });
    expect(settings.reset(['layout'])).toEqual(['layoutMode']);
    expect(settings.get('editorTheme')).toBe('dark');
    expect(settings.reset().sort()).toEqual(['editorTheme', 'keybinds', 'tourSeen']);
    expect(settings.all()).toEqual(defaultSettings());
  });

  it('keeps working in memory when storage is blocked or full', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const settings = createSettingsStore({ storage: brokenStore, target: null });
    expect(settings.isPersistent()).toBe(true);
    expect(settings.set('editorTheme', 'light')).toBe(true);
    expect(settings.get('editorTheme')).toBe('light');
    expect(settings.isPersistent()).toBe(false);
    // It only warns once, not on every change.
    settings.set('editorTheme', 'dark');
    expect(console.warn).toHaveBeenCalledTimes(1);

    const none = createSettingsStore({ storage: null, target: null });
    expect(none.isPersistent()).toBe(false);
    expect(none.set('tourSeen', true)).toBe(true);
    vi.restoreAllMocks();
  });

  it('falls back to window.localStorage, and to memory when touching it throws', () => {
    localStorage.clear();
    const settings = createSettingsStore({ target: null });
    settings.set('previewTheme', 'dark');
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).values.previewTheme).toBe('dark');
    localStorage.clear();

    const spy = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(createSettingsStore({ target: null }).isPersistent()).toBe(false);
    spy.mockRestore();
  });

  it('skips junk in the stored blob, and keeps values from a newer build when saving', () => {
    const store = memoryStore({
      [SETTINGS_KEY]: JSON.stringify({ version: 2, values: { editorTheme: 'dark', previewTheme: 42, fontSize: 14 }, updatedAt: { editorTheme: 3, previewTheme: 'x' } }),
    });
    const settings = createSettingsStore({ storage: store, target: null });
    expect(settings.get('editorTheme')).toBe('dark');
    expect(settings.get('previewTheme')).toBe('system');
    expect(settings.updatedAt()).toEqual({ editorTheme: 3 });
    settings.set('tourSeen', true);
    expect(JSON.parse(store.data.get(SETTINGS_KEY)!).values.fontSize).toBe(14);

    // A blob that's not JSON, or has no values, counts as missing.
    expect(createSettingsStore({ storage: memoryStore({ [SETTINGS_KEY]: '{oops' }), target: null }).all()).toEqual(defaultSettings());
    const noValues = memoryStore({ [SETTINGS_KEY]: JSON.stringify({ updatedAt: 'no' }) });
    expect(createSettingsStore({ storage: noValues, target: null }).all()).toEqual(defaultSettings());
    const noVersion = memoryStore({ [SETTINGS_KEY]: JSON.stringify({ values: { tourSeen: true } }) });
    expect(createSettingsStore({ storage: noVersion, target: null }).get('tourSeen')).toBe(true);
  });
});

describe('moving old settings over', () => {
  const legacy = () =>
    memoryStore({
      [LEGACY_KEYBINDS_KEY]: JSON.stringify(keybinds),
      [LEGACY_TOUR_SEEN_KEY]: '1',
      [LEGACY_SESSION_KEY]: JSON.stringify({ documentName: 'Paper', content: 'x', providerMode: 'local', saveNowEnabled: true, editorTheme: 'dark', previewTheme: 'light' }),
    });

  it('reads the keybinds, tour flag and themes from the old keys, then removes the standalone ones', () => {
    const store = legacy();
    const settings = createSettingsStore({ storage: store, target: null });
    expect(settings.all()).toEqual({ ...defaultSettings(), editorTheme: 'dark', previewTheme: 'light', keybinds, tourSeen: true });
    expect(store.data.has(LEGACY_KEYBINDS_KEY)).toBe(false);
    expect(store.data.has(LEGACY_TOUR_SEEN_KEY)).toBe(false);
    // The session blob still holds the project, so it stays.
    expect(store.data.has(LEGACY_SESSION_KEY)).toBe(true);
    expect(JSON.parse(store.data.get(SETTINGS_KEY)!).values).toMatchObject({ editorTheme: 'dark', keybinds, tourSeen: true });
  });

  it('only migrates once: the new blob wins over old keys left behind', () => {
    const store = legacy();
    store.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, values: { editorTheme: 'light' }, updatedAt: {} }));
    const settings = createSettingsStore({ storage: store, target: null });
    expect(settings.get('editorTheme')).toBe('light');
    expect(settings.get('keybinds')).toEqual(defaultSettings().keybinds);
    expect(store.data.has(LEGACY_KEYBINDS_KEY)).toBe(true);
  });

  it('keeps the old keys when the new blob could not be written', () => {
    const store = legacy();
    store.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const settings = createSettingsStore({ storage: store, target: null });
    expect(settings.get('tourSeen')).toBe(true);
    expect(store.data.has(LEGACY_KEYBINDS_KEY)).toBe(true);
    vi.restoreAllMocks();
  });

  it('skips old values that are junk, and finds nothing in an empty browser', () => {
    expect(readLegacySettings(memoryStore())).toBeNull();
    expect(readLegacySettings(undefined)).toBeNull();
    expect(readLegacySettings(brokenStore)).toBeNull();
    const junk = memoryStore({
      [LEGACY_KEYBINDS_KEY]: '{not json',
      [LEGACY_TOUR_SEEN_KEY]: 'yes',
      [LEGACY_SESSION_KEY]: JSON.stringify({ editorTheme: 'purple', previewTheme: 'dark' }),
    });
    expect(readLegacySettings(junk)?.values).toEqual({ previewTheme: 'dark' });
  });

  it('cleans the display name, and lets it be cleared', () => {
    const settings = createSettingsStore({ storage: memoryStore(), target: null });
    expect(settings.get('displayName')).toBe('');
    expect(settings.set('displayName', '  Ada \u202e Lovelace\n ')).toBe(true);
    expect(settings.get('displayName')).toBe('Ada Lovelace');
    expect(settings.set('displayName', '   ')).toBe(false);
    expect(settings.set('displayName', 7 as never)).toBe(false);
    expect(settings.set('displayName', '')).toBe(true);
    expect(cleanDisplayName('x'.repeat(50))).toHaveLength(40);
    // Characters, not UTF-16 units: an emoji counts once.
    expect([...cleanDisplayName('😀'.repeat(50))!]).toHaveLength(40);
    expect(cleanDisplayName(null)).toBeUndefined();
    // The presence id is 16 lowercase hex characters or empty; anything else is refused.
    expect(settings.get('presenceId')).toBe('');
    expect(settings.set('presenceId', 'abcdef0123456789')).toBe(true);
    expect(settings.set('presenceId', 'ABCDEF0123456789')).toBe(false);
    expect(settings.set('presenceId', 'abc')).toBe(false);
    expect(settings.set('presenceId', 5 as never)).toBe(false);
    expect(settings.get('presenceId')).toBe('abcdef0123456789');
    expect(isPresenceId(newPresenceId())).toBe(true);
    expect(newPresenceId()).not.toBe(newPresenceId());
    expect(newPresenceId((bytes) => bytes.fill(0xab))).toBe('abababababababab');
  });

  it('cleans up keybind rules', () => {
    expect(sanitizeKeybinds(null)).toBeUndefined();
    expect(sanitizeKeybinds({ rules: 'nope', disabled: [] })).toBeUndefined();
    expect(sanitizeKeybinds({ rules: [{ id: 'a', keybind: 'Alt+A', off: 1 }, { id: 3 }, null], disabled: ['ok', 4] })).toEqual({
      rules: [{ id: 'a', keybind: 'Alt+A', off: true }],
      disabled: ['ok'],
    });
  });
});

describe('settings across tabs', () => {
  it("picks up another tab's change from the storage event and says what changed", () => {
    const store = memoryStore();
    const target = eventTarget();
    const settings = createSettingsStore({ storage: store, target });
    const other = createSettingsStore({ storage: store, target: null });
    const listener = vi.fn();
    settings.subscribe(listener);

    other.update({ editorTheme: 'dark', keybinds });
    target.fire('some-other-key');
    expect(listener).not.toHaveBeenCalled();
    target.fire(SETTINGS_KEY);
    expect(listener).toHaveBeenCalledWith(['editorTheme', 'keybinds'], 'other-tab');
    expect(settings.get('keybinds')).toEqual(keybinds);

    // localStorage.clear() in another tab fires with a null key: back to defaults.
    store.data.clear();
    target.fire(null);
    expect(listener).toHaveBeenLastCalledWith(['editorTheme', 'keybinds'], 'other-tab');
    expect(settings.all()).toEqual(defaultSettings());

    settings.dispose();
    other.set('tourSeen', true);
    target.fire(SETTINGS_KEY);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('listens on window by default', () => {
    localStorage.clear();
    const settings = createSettingsStore();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, values: { previewTheme: 'dark' }, updatedAt: {} }));
    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }));
    expect(settings.get('previewTheme')).toBe('dark');
    settings.dispose();
    localStorage.clear();
  });
});

describe('export and import', () => {
  it('round-trips through a JSON file', () => {
    const settings = createSettingsStore({ storage: memoryStore(), target: null, now: () => Date.UTC(2026, 10, 13) });
    settings.update({ editorTheme: 'light', keybinds, splitRatio: 0.3 });
    const text = settings.exportJson();
    const file = JSON.parse(text);
    expect(file).toMatchObject({ format: SETTINGS_FILE_FORMAT, version: SETTINGS_VERSION, exportedAt: '2026-11-13T00:00:00.000Z' });

    const other = createSettingsStore({ storage: memoryStore(), target: null });
    const listener = vi.fn();
    other.subscribe(listener);
    expect(other.importJson(text)).toEqual({ ok: true, applied: ['editorTheme', 'splitRatio', 'keybinds'], skipped: [] });
    expect(other.all()).toEqual(settings.all());
    expect(listener).toHaveBeenCalledWith(['editorTheme', 'splitRatio', 'keybinds'], 'import');
  });

  it('skips settings that are unknown or invalid, and keeps the rest', () => {
    const settings = createSettingsStore({ storage: memoryStore(), target: null });
    const text = JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: 1, settings: { editorTheme: 'dark', previewTheme: 'neon', fontSize: 12 } });
    expect(settings.importJson(text)).toEqual({ ok: true, applied: ['editorTheme'], skipped: ['previewTheme', 'fontSize'] });
  });

  it('turns away files that are not settings files', () => {
    const settings = createSettingsStore({ storage: memoryStore(), target: null });
    const bad = (text: string) => {
      const result = settings.importJson(text);
      return result.ok ? '' : result.error;
    };
    expect(bad('{')).toMatch(/not valid JSON/);
    expect(bad('null')).toMatch(/not a settings file/);
    expect(bad(JSON.stringify({ format: 'something-else', version: 1, settings: {} }))).toMatch(/not a settings file/);
    expect(bad(JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: 1 }))).toMatch(/not a settings file/);
    expect(bad(JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: 99, settings: {} }))).toMatch(/newer version/);
    expect(bad(JSON.stringify({ format: SETTINGS_FILE_FORMAT, settings: {} }))).toMatch(/not a settings file/);
    expect(settings.all()).toEqual(defaultSettings());
  });
});
