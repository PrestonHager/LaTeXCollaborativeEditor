export type ProviderMode = 'local' | 'drive';
export type ThemeMode = 'dark' | 'light' | 'system';

export type AppSessionState = {
  documentName: string;
  content: string;
  providerMode: ProviderMode;
  saveNowEnabled: boolean;
  editorTheme: ThemeMode;
  previewTheme: ThemeMode;
  updatedAt: number;
};

const SESSION_KEY = 'latex_editor_app_session_v1';

export function readAppSessionState(): AppSessionState | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AppSessionState>;
    if (
      typeof parsed.documentName !== 'string' ||
      typeof parsed.content !== 'string' ||
      (parsed.providerMode !== 'local' && parsed.providerMode !== 'drive') ||
      typeof parsed.saveNowEnabled !== 'boolean'
    ) {
      return null;
    }
    const validTheme = (t: unknown): t is ThemeMode => t === 'dark' || t === 'light' || t === 'system';
    return {
      documentName: parsed.documentName,
      content: parsed.content,
      providerMode: parsed.providerMode,
      saveNowEnabled: parsed.saveNowEnabled,
      editorTheme: validTheme(parsed.editorTheme) ? parsed.editorTheme : 'system',
      previewTheme: validTheme(parsed.previewTheme) ? parsed.previewTheme : 'system',
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export type WriteAppSessionPayload = Omit<AppSessionState, 'updatedAt' | 'editorTheme' | 'previewTheme'> & {
  editorTheme?: ThemeMode;
  previewTheme?: ThemeMode;
};

export function writeAppSessionState(state: WriteAppSessionPayload) {
  const payload: AppSessionState = {
    ...state,
    editorTheme: state.editorTheme ?? 'system',
    previewTheme: state.previewTheme ?? 'system',
    updatedAt: Date.now(),
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
}
