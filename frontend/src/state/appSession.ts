import type { SavedManifest } from '../storage/projectSaver';

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
  // Stable id for the open document, so a linked Drive file survives a rename.
  documentId?: string;
  // The host's Yjs doc, so a reload resumes the same doc its guests have instead of starting a new one.
  yjs?: PersistedYjsState;
  // The stored project we save to, its open file, and what the last save wrote.
  projectId?: string;
  activeFileId?: string;
  manifest?: SavedManifest;
};

// The state is a base64 encoded Yjs update.
export type PersistedYjsState = { docId: string; state: string };

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
      documentId: typeof parsed.documentId === 'string' && parsed.documentId ? parsed.documentId : undefined,
      yjs:
        parsed.yjs && typeof parsed.yjs.docId === 'string' && typeof parsed.yjs.state === 'string'
          ? { docId: parsed.yjs.docId, state: parsed.yjs.state }
          : undefined,
      projectId: typeof parsed.projectId === 'string' && parsed.projectId ? parsed.projectId : undefined,
      activeFileId: typeof parsed.activeFileId === 'string' && parsed.activeFileId ? parsed.activeFileId : undefined,
      manifest: isManifest(parsed.manifest) ? parsed.manifest : undefined,
    };
  } catch {
    return null;
  }
}

function isManifest(value: unknown): value is SavedManifest {
  const manifest = value as Partial<SavedManifest> | null | undefined;
  return (
    !!manifest &&
    typeof manifest.projectId === 'string' &&
    typeof manifest.name === 'string' &&
    !!manifest.files &&
    typeof manifest.files === 'object'
  );
}

export type WriteAppSessionPayload = Omit<AppSessionState, 'updatedAt' | 'editorTheme' | 'previewTheme'> & {
  editorTheme?: ThemeMode;
  previewTheme?: ThemeMode;
};

/** Make a new id for a document. Falls back to a random string where crypto.randomUUID is missing. */
export function createDocumentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function writeAppSessionState(state: WriteAppSessionPayload): boolean {
  const payload: AppSessionState = {
    ...state,
    editorTheme: state.editorTheme ?? 'system',
    previewTheme: state.previewTheme ?? 'system',
    updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    return true;
  } catch (error) {
    // The Yjs state is the biggest part, so if storage is full try again without it to keep the text safe.
    if (payload.yjs) {
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ ...payload, yjs: undefined }));
        return true;
      } catch {
        // Fall through to the warning below.
      }
    }
    // This runs on every keystroke, so a full or blocked storage must never throw into the editor.
    console.warn('Could not save the app session to browser storage', error);
    return false;
  }
}

export function encodeYjsState(state: Uint8Array): string {
  // Build the binary string in chunks, since spreading a big array into fromCharCode can overflow the stack.
  let binary = '';
  for (let i = 0; i < state.length; i += 0x8000) {
    binary += String.fromCharCode(...state.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function decodeYjsState(encoded: string): Uint8Array | null {
  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
