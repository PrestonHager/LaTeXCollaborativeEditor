// The small part of the Google Drive provider that the initial load needs (issue #231): the
// constants other modules tag Drive files with, and reading the token and the old single-file link
// back from storage. The provider itself (googleDrive.ts) is a lazy chunk behind lazyGoogleDrive.ts,
// so these live here to keep a static import from pulling it into the initial load.

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
// The exports folder the Export dialog makes inside a project folder. openProject skips it, so
// exports never become project files.
export const EXPORTS_PROPERTY = 'latexExports';
// The Templates folder (#74) at the top of My Drive, and each template folder in it. Templates aren't
// tagged as projects, so they stay out of the project list; see templates/driveTemplates.ts.
export const TEMPLATES_FOLDER_PROPERTY = 'latexTemplates';
export const TEMPLATE_PROPERTY = 'latexTemplate';
// Old single-file projects use ids like "file:<drive file id>".
export const LEGACY_PREFIX = 'file:';
const LEGACY_FILE_KEY = 'drive_active_file_ref';
// Treat the token as expired a minute early so a save doesn't race the expiry.
export const TOKEN_EXPIRY_SLACK_MS = 60_000;
// NOTE: the token lives in sessionStorage, so it survives a reload but not a new tab or a closed browser.
export const TOKEN_STORAGE_KEY = 'drive_session_token';
// Old builds kept the token here, where any script on the page could read it.
const OLD_TOKEN_KEY = 'drive_access_token';

export type StoredToken = { accessToken: string; expiresAt: number; account?: string };
// The single Drive file an old session was saving to, from before projects.
type DriveFileRef = { id: string; name: string; documentId?: string };

/** The token this tab kept from before a reload, or null. One that is about to expire is dropped. */
export function readStoredToken(now = Date.now()): StoredToken | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredToken;
    if (!parsed?.accessToken || !parsed?.expiresAt) return null;
    if (parsed.expiresAt <= now + TOKEN_EXPIRY_SLACK_MS) {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    // Corrupt cache, just start signed out.
    return null;
  }
}

/** Drop a token an old build left in localStorage. */
export function removeOldToken() {
  try {
    localStorage.removeItem(OLD_TOKEN_KEY);
  } catch {
    // Nothing to do if storage is locked down.
  }
}

/**
 * The project id for the Drive file an old session was saving to, if it belongs to documentId.
 * Sessions from before document ids only match by file name.
 */
export function legacyProjectId(documentId: string | undefined, fileName: string): string | null {
  let ref: DriveFileRef | null = null;
  try {
    const raw = localStorage.getItem(LEGACY_FILE_KEY);
    ref = raw ? (JSON.parse(raw) as DriveFileRef) : null;
  } catch {
    ref = null;
  }
  if (!ref?.id || !ref.name) return null;
  const matches = ref.documentId ? ref.documentId === documentId : ref.name === fileName;
  return matches ? `${LEGACY_PREFIX}${ref.id}` : null;
}

/** Forget the old single-file link, once the session has moved on to projects. */
export function forgetLegacyFile() {
  try {
    localStorage.removeItem(LEGACY_FILE_KEY);
  } catch {
    // Nothing to do if storage is locked down.
  }
}
