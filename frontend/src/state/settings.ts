import type { KeybindRule, KeybindSettings } from '../app/keymap';
import type { LayoutMode } from '../app/layout';
import type { ThemeMode } from './appSession';
import { emptyProfile, sanitizeProfile, type Profile } from './profile';

/**
 * The person's own settings: themes, layout, keybinds and the like. They live in this browser,
 * apart from the app session and the project, and are never sent to peers in a room (except
 * `displayName` and `presenceId`, which go out in presence messages while you share). Guests keep
 * their own too.
 *
 * Stored under one localStorage key as `{ version, values, updatedAt }`. `updatedAt` holds a
 * timestamp per setting, so a later sync can merge two copies key by key (last write wins).
 */
export const SETTINGS_KEY = 'latex-editor.settings';
export const SETTINGS_VERSION = 1;
/** What an exported settings file says it is, so importing some other JSON file fails cleanly. */
export const SETTINGS_FILE_FORMAT = 'latex-editor-settings';

// Keys older builds used. They get moved into the store once, then the standalone ones are removed.
export const LEGACY_KEYBINDS_KEY = 'latex-editor.keybinds';
export const LEGACY_TOUR_SEEN_KEY = 'latex-editor.tour-seen';
export const LEGACY_SESSION_KEY = 'latex_editor_app_session_v1';

export type Settings = {
  editorTheme: ThemeMode;
  previewTheme: ThemeMode;
  layoutMode: LayoutMode;
  /** Share of the width the editor gets in split view, 0.2 to 0.8. */
  splitRatio: number;
  keybinds: KeybindSettings;
  tourSeen: boolean;
  /** Where the Export dialog saves to: the browser's Download, or Google Drive. */
  exportDestination: ExportDestinationId;
  /**
   * The name peers see next to your cursor when you share (issue #22). Empty until the first share,
   * which fills in an anonymous animal name. It's the only thing about you a room gets.
   */
  displayName: string;
  /**
   * A random id sent with presence so your colour stays the same across reloads (16 hex characters,
   * made on the first share). It says nothing about you and is only used to pick the colour.
   */
  presenceId: string;
  /** Your details for templates (state/profile.ts). Personal data: never sent to peers. */
  profile: Profile;
};
export type ExportDestinationId = 'download' | 'drive';
export type SettingKey = keyof Settings;

export const defaultSettings = (): Settings => ({
  editorTheme: 'system',
  previewTheme: 'system',
  layoutMode: 'split',
  splitRatio: 0.5,
  keybinds: { rules: [], disabled: [] },
  tourSeen: false,
  exportDestination: 'download',
  displayName: '',
  presenceId: '',
  profile: emptyProfile(),
});

/** Groups that Reset can act on one at a time. */
export const settingSections = {
  appearance: ['editorTheme', 'previewTheme'],
  layout: ['layoutMode', 'splitRatio'],
  keybinds: ['keybinds'],
  tour: ['tourSeen'],
  export: ['exportDestination'],
  profile: ['profile'],
} as const satisfies Record<string, readonly SettingKey[]>;
export type SettingSection = keyof typeof settingSections;

const isTheme = (value: unknown): value is ThemeMode => value === 'dark' || value === 'light' || value === 'system';

/** Turn whatever was stored into a valid value for the key, or undefined when it can't be. */
const sanitizers: { [K in SettingKey]: (value: unknown) => Settings[K] | undefined } = {
  editorTheme: (value) => (isTheme(value) ? value : undefined),
  previewTheme: (value) => (isTheme(value) ? value : undefined),
  layoutMode: (value) => (value === 'split' || value === 'editor-only' || value === 'preview-only' ? value : undefined),
  splitRatio: (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0.2, Math.min(0.8, value)) : undefined),
  keybinds: (value) => sanitizeKeybinds(value),
  tourSeen: (value) => (typeof value === 'boolean' ? value : undefined),
  exportDestination: (value) => (value === 'download' || value === 'drive' ? value : undefined),
  displayName: (value) => (value === '' ? '' : cleanDisplayName(value)),
  presenceId: (value) => (value === '' || isPresenceId(value) ? value : undefined),
  profile: sanitizeProfile,
};

const PRESENCE_ID_PATTERN = /^[0-9a-f]{16}$/;
/** A presence id is exactly 16 lowercase hex characters. Peers drop presence with anything else. */
export const isPresenceId = (value: unknown): value is string => typeof value === 'string' && PRESENCE_ID_PATTERN.test(value);

/** A new random presence id: 8 random bytes as hex. */
export function newPresenceId(fill: (bytes: Uint8Array<ArrayBuffer>) => unknown = (bytes) => crypto.getRandomValues(bytes)): string {
  const bytes = new Uint8Array(8);
  fill(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Longest display name, in characters. Peers drop presence messages with a longer one. */
export const MAX_DISPLAY_NAME_LENGTH = 40;
// Control characters, line and paragraph separators, and bidi overrides that could flip text around a name.
const NAME_JUNK = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/** Tidy a display name: no control or bidi characters, single spaces, trimmed and capped. Undefined when nothing's left. */
export function cleanDisplayName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = [...value.replace(NAME_JUNK, '').replace(/\s+/g, ' ').trim()].slice(0, MAX_DISPLAY_NAME_LENGTH).join('').trim();
  return name || undefined;
}

/** Keep only well-formed keybind rules. Whether a command still exists is checked where it's applied. */
export function sanitizeKeybinds(value: unknown): KeybindSettings | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Partial<Record<keyof KeybindSettings, unknown>>;
  if (!Array.isArray(raw.rules) || !Array.isArray(raw.disabled)) return undefined;
  const rules = raw.rules
    .filter((rule): rule is KeybindRule => typeof rule?.id === 'string' && typeof rule.keybind === 'string')
    .map((rule) => ({ id: rule.id, keybind: rule.keybind, ...(rule.off ? { off: true } : {}) }));
  const disabled = raw.disabled.filter((key): key is string => typeof key === 'string');
  return { rules, disabled };
}

const settingKeys = Object.keys(sanitizers) as SettingKey[];
const isSettingKey = (key: string): key is SettingKey => Object.prototype.hasOwnProperty.call(sanitizers, key);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = <T>(value: T): T => (typeof value === 'object' && value !== null ? (JSON.parse(JSON.stringify(value)) as T) : value);

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type StoredSettings = { version: number; values: Record<string, unknown>; updatedAt: Record<string, number> };

/** Read the settings blob, or the old scattered keys when there's no blob yet. */
function load(store: KeyValueStore | undefined): { stored: StoredSettings | null; migrated: boolean } {
  try {
    const raw = store?.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredSettings>;
      if (parsed && typeof parsed === 'object' && parsed.values && typeof parsed.values === 'object') {
        return {
          stored: {
            version: typeof parsed.version === 'number' ? parsed.version : SETTINGS_VERSION,
            values: parsed.values,
            updatedAt: parsed.updatedAt && typeof parsed.updatedAt === 'object' ? parsed.updatedAt : {},
          },
          migrated: false,
        };
      }
    }
  } catch {
    // Junk or blocked storage: try the old keys, then fall back to defaults.
  }
  const legacy = readLegacySettings(store);
  return { stored: legacy, migrated: legacy !== null };
}

/** Version 0: settings spread over the keybinds key, the tour-seen key and the app session blob. */
export function readLegacySettings(store: KeyValueStore | undefined): StoredSettings | null {
  const values: Record<string, unknown> = {};
  const read = (key: string) => {
    try {
      return store?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const parse = (raw: string | null): unknown => {
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const session = parse(read(LEGACY_SESSION_KEY)) as { editorTheme?: unknown; previewTheme?: unknown } | null;
  if (session && isTheme(session.editorTheme)) values.editorTheme = session.editorTheme;
  if (session && isTheme(session.previewTheme)) values.previewTheme = session.previewTheme;
  const keybinds = sanitizeKeybinds(parse(read(LEGACY_KEYBINDS_KEY)));
  if (keybinds) values.keybinds = keybinds;
  if (read(LEGACY_TOUR_SEEN_KEY) === '1') values.tourSeen = true;
  if (!Object.keys(values).length) return null;
  const now = Date.now();
  return { version: SETTINGS_VERSION, values, updatedAt: Object.fromEntries(Object.keys(values).map((key) => [key, now])) };
}

/** Where a change came from: this tab, another tab (the storage event), or an imported file. */
export type SettingsChangeSource = 'local' | 'other-tab' | 'import' | 'reset';
export type SettingsListener = (changed: SettingKey[], source: SettingsChangeSource) => void;

export type ImportResult = { ok: true; applied: SettingKey[]; skipped: string[] } | { ok: false; error: string };

type SettingsStoreOptions = {
  /** Defaults to window.localStorage. Pass null for a store that only lives in memory. */
  storage?: KeyValueStore | null;
  /** Where to listen for the `storage` event from other tabs. Defaults to window. */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  now?: () => number;
};

function defaultStorage(): KeyValueStore | undefined {
  // Some browsers throw just for touching localStorage when site data is blocked.
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Make the settings store. Every read and write is guarded, so blocked or full storage only
 * means settings last until the tab closes.
 */
export function createSettingsStore(options: SettingsStoreOptions = {}) {
  const storage = options.storage === null ? undefined : (options.storage ?? defaultStorage());
  const target = options.target === null ? undefined : (options.target ?? (typeof window === 'undefined' ? undefined : window));
  const now = options.now ?? Date.now;
  const listeners = new Set<SettingsListener>();

  let values = defaultSettings();
  let updatedAt: Partial<Record<SettingKey, number>> = {};
  // Values from a newer build that this one doesn't know. They're written back untouched.
  let unknown: Record<string, unknown> = {};
  let persistent = true;

  const adopt = (stored: StoredSettings | null) => {
    const next = defaultSettings();
    const times: Partial<Record<SettingKey, number>> = {};
    const extra: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(stored?.values ?? {})) {
      if (!isSettingKey(key)) {
        extra[key] = raw;
        continue;
      }
      const value = sanitizers[key](raw);
      if (value === undefined) continue;
      (next as Record<SettingKey, unknown>)[key] = value;
      const time = stored?.updatedAt[key];
      if (typeof time === 'number') times[key] = time;
    }
    return { next, times, extra };
  };

  const write = (): boolean => {
    if (!storage) return false;
    const blob: StoredSettings = { version: SETTINGS_VERSION, values: { ...unknown, ...values }, updatedAt: updatedAt as Record<string, number> };
    try {
      storage.setItem(SETTINGS_KEY, JSON.stringify(blob));
      persistent = true;
      return true;
    } catch (error) {
      if (persistent) console.warn('Could not save settings to browser storage', error);
      persistent = false;
      return false;
    }
  };

  const emit = (changed: SettingKey[], source: SettingsChangeSource) => {
    if (!changed.length) return;
    for (const listener of [...listeners]) {
      try {
        listener(changed, source);
      } catch (error) {
        console.error('A settings listener failed', error);
      }
    }
  };

  // First load, moving old keys over when this browser has no settings blob yet.
  {
    const { stored, migrated } = load(storage);
    const { next, times, extra } = adopt(stored);
    values = next;
    updatedAt = times;
    unknown = extra;
    if (!storage) persistent = false;
    if (migrated && write()) {
      // The standalone keys are now in the blob. The session blob keeps its old theme fields
      // until the host's next save drops them.
      for (const key of [LEGACY_KEYBINDS_KEY, LEGACY_TOUR_SEEN_KEY]) {
        try {
          storage?.removeItem(key);
        } catch {
          // Leaving a stale key is harmless: the blob wins from now on.
        }
      }
    }
  }

  /** Put several values in at once. Only real changes are saved and announced. */
  const apply = (patch: Partial<Settings>, source: SettingsChangeSource, time = now()): SettingKey[] => {
    const changed: SettingKey[] = [];
    for (const key of Object.keys(patch) as SettingKey[]) {
      if (!isSettingKey(key)) continue;
      const value = sanitizers[key](patch[key]);
      if (value === undefined || same(values[key], value)) continue;
      (values as Record<SettingKey, unknown>)[key] = value;
      updatedAt[key] = time;
      changed.push(key);
    }
    if (changed.length) {
      write();
      emit(changed, source);
    }
    return changed;
  };

  // Another tab saved settings: take its copy and tell the page what changed.
  const onStorage = (event: Event) => {
    const { key } = event as StorageEvent;
    if (key !== SETTINGS_KEY && key !== null) return;
    const { next, times, extra } = adopt(load(storage).stored);
    const changed = settingKeys.filter((name) => !same(values[name], next[name]));
    values = next;
    updatedAt = times;
    unknown = extra;
    emit(changed, 'other-tab');
  };
  target?.addEventListener('storage', onStorage);

  return {
    get<K extends SettingKey>(key: K): Settings[K] {
      return clone(values[key]);
    },
    all(): Settings {
      return clone(values);
    },
    /** When each setting last changed here, for a future per-key merge. */
    updatedAt(): Partial<Record<SettingKey, number>> {
      return { ...updatedAt };
    },
    set<K extends SettingKey>(key: K, value: Settings[K]): boolean {
      return apply({ [key]: value } as Partial<Settings>, 'local').length > 0;
    },
    update(patch: Partial<Settings>) {
      return apply(patch, 'local');
    },
    /** Put settings back to their defaults: everything, or just the given sections. */
    reset(sections?: SettingSection[]) {
      const keys: readonly SettingKey[] = sections ? sections.flatMap((section) => settingSections[section]) : settingKeys;
      const defaults = defaultSettings();
      return apply(Object.fromEntries(keys.map((key) => [key, defaults[key]])) as Partial<Settings>, 'reset');
    },
    /** False when storage is blocked or full, so settings only last until the tab closes. */
    isPersistent: () => persistent,
    subscribe(listener: SettingsListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** The settings as a JSON file someone can keep or load in another browser. */
    exportJson(): string {
      return JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: SETTINGS_VERSION, exportedAt: new Date(now()).toISOString(), settings: values }, null, 2);
    },
    /** Load an exported settings file. Values that don't fit the schema are skipped, not guessed at. */
    importJson(text: string): ImportResult {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, error: 'That file is not valid JSON.' };
      }
      const file = parsed as { format?: unknown; version?: unknown; settings?: unknown } | null;
      if (!file || typeof file !== 'object' || file.format !== SETTINGS_FILE_FORMAT || typeof file.version !== 'number' || !file.settings || typeof file.settings !== 'object') {
        return { ok: false, error: 'That file is not a settings file from this editor.' };
      }
      if (file.version > SETTINGS_VERSION) {
        return { ok: false, error: 'That settings file is from a newer version of the editor. Update this page and try again.' };
      }
      const patch: Partial<Settings> = {};
      const skipped: string[] = [];
      for (const [key, raw] of Object.entries(file.settings as Record<string, unknown>)) {
        const value = isSettingKey(key) ? sanitizers[key](raw) : undefined;
        if (value === undefined) skipped.push(key);
        else (patch as Record<SettingKey, unknown>)[key as SettingKey] = value;
      }
      const applied = apply(patch, 'import');
      return { ok: true, applied, skipped };
    },
    dispose() {
      target?.removeEventListener('storage', onStorage);
      listeners.clear();
    },
  };
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;
