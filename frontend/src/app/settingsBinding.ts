import { keepKnownCommands, type Keymap } from './keymap';
import type { Layout } from './layout';
import type { ThemeController } from './theme';
import type { SettingKey, SettingsChangeSource, SettingsStore } from '../state/settings';
import type { ResetScope } from '../ui/settingsDialog';

type BindOptions = {
  settings: SettingsStore;
  themeState: Pick<ThemeController, 'editorTheme' | 'previewTheme' | 'applyEditorTheme' | 'applyPreviewTheme'>;
  layout: Pick<Layout, 'restore'>;
  keymap: Pick<Keymap, 'setSettings'>;
  isCommand: (id: string) => boolean;
  /** Called after settings changed somewhere else (another tab, an import, a reset), once they're applied. */
  onApplied?: (changed: SettingKey[], source: SettingsChangeSource) => void;
  target?: Pick<Window, 'addEventListener'>;
};

/**
 * Put the saved settings into the page, save changes the page makes, and apply changes that
 * come from another tab, an imported file or a reset.
 */
export function bindSettings({ settings, themeState, layout, keymap, isCommand, onApplied, target = window }: BindOptions) {
  const applyKeys = (keys: readonly SettingKey[]) => {
    if (keys.includes('editorTheme')) themeState.applyEditorTheme(settings.get('editorTheme'));
    if (keys.includes('previewTheme')) themeState.applyPreviewTheme(settings.get('previewTheme'));
    if (keys.includes('layoutMode') || keys.includes('splitRatio')) layout.restore({ mode: settings.get('layoutMode'), splitRatio: settings.get('splitRatio') });
    if (keys.includes('keybinds')) keymap.setSettings(keepKnownCommands(settings.get('keybinds'), isCommand));
  };
  applyKeys(['editorTheme', 'previewTheme', 'layoutMode', 'keybinds']);

  // Theme commands live in several places, and each fires one of these, so save from here.
  target.addEventListener('editorthemechange', () => settings.set('editorTheme', themeState.editorTheme));
  target.addEventListener('previewthemechange', () => settings.set('previewTheme', themeState.previewTheme));

  settings.subscribe((changed, source) => {
    // A change made in this tab is already on screen.
    if (source === 'local') return;
    applyKeys(changed);
    onApplied?.(changed, source);
  });
}

const resetMessages: Record<ResetScope, string> = {
  all: 'All settings are back to their defaults.',
  appearance: 'Themes are back to their defaults.',
  layout: 'Layout is back to its default.',
  keybinds: 'Keyboard shortcuts are back to their defaults.',
  tour: 'The tour will show again next time you open the editor.',
  export: 'Exports go back to Download.',
};

/** Reset settings for the dialog, and say what happened. */
export function resetSettings(settings: SettingsStore, scope: ResetScope): string {
  const changed = settings.reset(scope === 'all' ? undefined : [scope]);
  return changed.length ? resetMessages[scope] : 'Those settings were already at their defaults.';
}

/** Read an imported file and say what happened, for the dialog's status line. */
export async function importSettingsFile(settings: SettingsStore, file: Pick<File, 'text' | 'size'>): Promise<string> {
  // A settings file is a few KB. Anything huge is the wrong file.
  if (file.size > 1_000_000) return 'That file is too big to be a settings file.';
  const result = settings.importJson(await file.text());
  if (!result.ok) return result.error;
  const skipped = result.skipped.length ? ` Skipped ${result.skipped.length} unknown or invalid setting(s): ${result.skipped.join(', ')}.` : '';
  if (!result.applied.length) return `Nothing changed: those settings match yours.${skipped}`;
  return `Imported ${result.applied.length} setting(s).${skipped}`;
}

/** File name for an exported settings file, like latex-editor-settings-2026-11-13.json. */
export const settingsFileName = (date = new Date()) => `latex-editor-settings-${date.toISOString().slice(0, 10)}.json`;
