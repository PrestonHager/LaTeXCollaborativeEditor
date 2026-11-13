import { bindSettings, importSettingsFile, resetSettings, settingsFileName } from './settingsBinding';
import { createSettingsStore, SETTINGS_FILE_FORMAT } from '../state/settings';
import type { ThemeMode } from '../state/appSession';

const memoryStore = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};

function setup() {
  const storage = memoryStore();
  const tabEvents = new EventTarget();
  const settings = createSettingsStore({ storage, target: tabEvents });
  settings.update({ editorTheme: 'dark', layoutMode: 'editor-only', splitRatio: 0.3, keybinds: { rules: [{ id: 'file.newFile', keybind: 'Alt+N' }, { id: 'gone' as never, keybind: 'Alt+G' }], disabled: [] } });
  const target = new EventTarget();
  // A theme controller that fires the same events the real one does.
  const themeState = {
    editorTheme: 'system' as ThemeMode,
    previewTheme: 'system' as ThemeMode,
    applyEditorTheme: vi.fn((theme: ThemeMode) => {
      themeState.editorTheme = theme;
      target.dispatchEvent(new Event('editorthemechange'));
    }),
    applyPreviewTheme: vi.fn((theme: ThemeMode) => {
      themeState.previewTheme = theme;
      target.dispatchEvent(new Event('previewthemechange'));
    }),
  };
  const layout = { restore: vi.fn() };
  const keymap = { setSettings: vi.fn() };
  const onApplied = vi.fn();
  bindSettings({ settings, themeState, layout, keymap, isCommand: (id) => id !== 'gone', onApplied, target: target as unknown as Window });
  return { storage, tabEvents, settings, themeState, layout, keymap, onApplied, target };
}

describe('bindSettings', () => {
  it('puts the saved settings on screen, leaving out keybinds for missing commands', () => {
    const { themeState, layout, keymap } = setup();
    expect(themeState.editorTheme).toBe('dark');
    expect(themeState.previewTheme).toBe('system');
    expect(layout.restore).toHaveBeenCalledWith({ mode: 'editor-only', splitRatio: 0.3 });
    expect(keymap.setSettings).toHaveBeenCalledWith({ rules: [{ id: 'file.newFile', keybind: 'Alt+N' }], disabled: [] });
  });

  it('saves theme changes made anywhere on the page', () => {
    const { settings, themeState, onApplied } = setup();
    themeState.applyPreviewTheme('light');
    expect(settings.get('previewTheme')).toBe('light');
    // A local change is already on screen, so it isn't applied again.
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('applies changes from another tab, an import or a reset', () => {
    const { storage, tabEvents, settings, themeState, keymap, layout, onApplied } = setup();
    createSettingsStore({ storage, target: null }).set('previewTheme', 'dark');
    tabEvents.dispatchEvent(Object.assign(new Event('storage'), { key: 'latex-editor.settings' }));
    expect(themeState.previewTheme).toBe('dark');
    expect(onApplied).toHaveBeenLastCalledWith(['previewTheme'], 'other-tab');

    keymap.setSettings.mockClear();
    layout.restore.mockClear();
    settings.reset();
    expect(themeState.editorTheme).toBe('system');
    expect(keymap.setSettings).toHaveBeenCalledWith({ rules: [], disabled: [] });
    expect(layout.restore).toHaveBeenCalledWith({ mode: 'split', splitRatio: 0.5 });
    expect(onApplied).toHaveBeenLastCalledWith(expect.arrayContaining(['editorTheme', 'keybinds', 'layoutMode']), 'reset');
  });
});

describe('settings dialog helpers', () => {
  it('resets a section or everything and says what happened', () => {
    const settings = createSettingsStore({ storage: memoryStore(), target: null });
    settings.update({ editorTheme: 'dark', tourSeen: true });
    expect(resetSettings(settings, 'layout')).toMatch(/already at their defaults/);
    expect(resetSettings(settings, 'tour')).toMatch(/tour will show again/);
    expect(resetSettings(settings, 'all')).toMatch(/All settings/);
    expect(settings.get('editorTheme')).toBe('system');
  });

  it('imports a file and reports what it applied and skipped', async () => {
    const settings = createSettingsStore({ storage: memoryStore(), target: null });
    const file = (text: string, size = text.length) => ({ text: async () => text, size });
    const good = JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: 1, settings: { editorTheme: 'dark', fontSize: 3 } });
    expect(await importSettingsFile(settings, file(good))).toBe('Imported 1 setting(s). Skipped 1 unknown or invalid setting(s): fontSize.');
    expect(await importSettingsFile(settings, file(good))).toMatch(/^Nothing changed/);
    expect(await importSettingsFile(settings, file('nope'))).toMatch(/not valid JSON/);
    expect(await importSettingsFile(settings, file('{}', 5_000_000))).toMatch(/too big/);
  });

  it('names the export file after the date', () => {
    expect(settingsFileName(new Date(Date.UTC(2026, 10, 13, 12)))).toBe('latex-editor-settings-2026-11-13.json');
    expect(settingsFileName()).toMatch(/^latex-editor-settings-\d{4}-\d{2}-\d{2}\.json$/);
  });
});
