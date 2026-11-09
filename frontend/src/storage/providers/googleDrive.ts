import type { StorageProvider } from './types';
import { StorageError } from '../errors';
import { loadScript } from './scriptLoader';

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};
type GoogleTokenError = { type?: string; message?: string };
type DriveFileRef = { id: string; name: string };
type StoredToken = { accessToken: string; expiresAt: number };
type TokenResult = { ok: true } | { ok: false; reason: string };

declare global {
  interface Window {
    google?: any;
  }
}

const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
// Treat the token as expired a minute early so a save doesn't race the expiry.
const TOKEN_EXPIRY_SLACK_MS = 60_000;

export class GoogleDriveProvider implements StorageProvider {
  readonly label = 'Google Drive';
  private accessToken = '';
  private tokenExpiresAt = 0;
  private fileRef: DriveFileRef | null = this.readStoredFileRef();
  // Bump this every time the linked file changes, so a slow save can tell it's stale.
  private fileRefGeneration = 0;
  private currentStatus = 'Autosave Off';
  private static readonly storageKey = 'drive_active_file_ref';
  private static readonly tokenStorageKey = 'drive_access_token';

  constructor() {
    this.readStoredAccessToken();
  }

  status() { return this.currentStatus; }
  getAccessToken() { return this.accessToken; }
  getCurrentFileRef() { return this.fileRef; }

  /** Check for a live token without opening any sign-in popup. */
  hasUsableToken(): boolean {
    return this.accessToken.length > 0 && this.tokenExpiresAt - TOKEN_EXPIRY_SLACK_MS > Date.now();
  }

  /**
   * Forget the currently linked Drive file, so the next save creates a new one.
   * Call this whenever the editor switches to a different document.
   */
  detachFile() {
    this.linkFile(null);
  }

  /**
   * Sign in with Google Identity Services and get a Drive access token.
   * NOTE: this opens a popup, so it has to run from a user click or the browser will block it.
   */
  async connect(): Promise<boolean> {
    if (this.hasUsableToken()) {
      this.currentStatus = 'Drive: Connected';
      return true;
    }
    this.clearAccessToken();
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      this.currentStatus = 'Drive config missing';
      return false;
    }
    this.currentStatus = 'Drive: Connecting...';
    try {
      await loadScript(GIS_SCRIPT, 'Google sign-in');
      const oauth2 = window.google?.accounts?.oauth2;
      if (!oauth2?.initTokenClient) {
        throw new Error('Google sign-in script loaded but the OAuth client is missing');
      }
      const result = await this.requestAccessToken(oauth2, clientId);
      if (result.ok) {
        this.currentStatus = 'Drive: Connected';
        return true;
      }
      this.currentStatus = `Drive: ${result.reason}`;
      return false;
    } catch (error) {
      console.error('Google Drive connect failed', error);
      this.currentStatus = 'Drive: Connection failed';
      return false;
    }
  }

  async save(content: string, fileName: string): Promise<void> {
    this.requireToken();
    if (!this.fileRef) {
      const generation = this.fileRefGeneration;
      const fileId = await this.createFile(fileName, content);
      // Only link the new file if nothing was opened or detached while we were creating it.
      if (generation === this.fileRefGeneration) {
        this.linkFile({ id: fileId, name: fileName });
      }
      return;
    }
    await this.updateFile(this.fileRef.id, content);
  }

  /**
   * Rename the linked Drive file then write the latest content.
   * Before, this dropped the link and created a brand new file, which left duplicates in Drive.
   */
  async saveAs(content: string, _oldFileName: string, newFileName: string): Promise<void> {
    this.requireToken();
    if (!this.fileRef) {
      await this.save(content, newFileName);
      return;
    }
    // Hold on to the file we started with, since the link can change during the rename.
    const fileId = this.fileRef.id;
    const generation = this.fileRefGeneration;
    await this.renameFile(fileId, newFileName);
    if (generation !== this.fileRefGeneration) return;
    await this.updateFile(fileId, content);
  }

  async openDocument(fileId: string): Promise<{ name: string; content: string }> {
    this.requireToken();
    const metadataRes = await this.driveFetch(`${DRIVE_API}/${fileId}?fields=id,name`, {}, 'load file details');
    const metadata = await metadataRes.json();

    const contentRes = await this.driveFetch(`${DRIVE_API}/${fileId}?alt=media`, {}, 'load file content');
    const content = await contentRes.text();
    this.linkFile({ id: metadata.id, name: metadata.name });
    return { name: metadata.name, content };
  }

  async renameFile(fileId: string, newName: string): Promise<void> {
    this.requireToken();
    await this.driveFetch(
      `${DRIVE_API}/${fileId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      },
      'rename file',
    );
    if (this.fileRef?.id === fileId) {
      this.fileRef = { ...this.fileRef, name: newName };
      this.persistFileRef(this.fileRef);
    }
  }

  async moveFile(fileId: string, targetFolderId: string): Promise<void> {
    this.requireToken();
    const detailsRes = await this.driveFetch(`${DRIVE_API}/${fileId}?fields=parents`, {}, 'look up the current folder');
    const details = await detailsRes.json();
    const removeParents = Array.isArray(details.parents) ? details.parents.join(',') : '';
    const url = new URL(`${DRIVE_API}/${fileId}`);
    url.searchParams.set('addParents', targetFolderId);
    if (removeParents) {
      url.searchParams.set('removeParents', removeParents);
    }
    await this.driveFetch(url.toString(), { method: 'PATCH' }, 'move file');
  }

  private async createFile(fileName: string, content: string): Promise<string> {
    const metadata = new Blob([JSON.stringify({ name: fileName, mimeType: 'text/x-tex' })], { type: 'application/json' });
    const data = new Blob([content], { type: 'text/plain' });
    const form = new FormData();
    form.append('metadata', metadata);
    form.append('file', data);

    const res = await this.driveFetch(`${DRIVE_UPLOAD_API}?uploadType=multipart`, { method: 'POST', body: form }, 'create file');
    const json = await res.json();
    if (!json?.id) throw new StorageError('Drive: Created a file but Google did not return its id');
    return json.id;
  }

  private async updateFile(fileId: string, content: string): Promise<void> {
    await this.driveFetch(
      `${DRIVE_UPLOAD_API}/${fileId}?uploadType=media`,
      { method: 'PATCH', headers: { 'Content-Type': 'text/plain' }, body: content },
      'save file',
    );
  }

  /**
   * Call the Drive API with our token and turn failures into readable errors.
   * A 401 means the token died, so we clear it and tell the user to reconnect.
   */
  private async driveFetch(url: string, init: RequestInit, action: string): Promise<Response> {
    const headers = { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${this.accessToken}` };
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers });
    } catch (error) {
      throw new StorageError(`Drive: Could not ${action}. Check your connection and try again.`, { cause: error });
    }
    if (res.ok) return res;

    const detail = await readGoogleErrorMessage(res);
    if (res.status === 401) {
      this.clearAccessToken();
      this.currentStatus = 'Drive: Session expired';
      throw new StorageError('Drive: Session expired. Use File > Connect Google Drive to sign in again.', {
        retryable: false,
        status: 401,
      });
    }
    if (res.status === 404) {
      // NOTE: with the drive.file scope we only see files this app created or the user picked.
      throw new StorageError(
        `Drive: Could not ${action}. The file was not found or this app does not have access to it.`,
        { retryable: false, status: 404 },
      );
    }
    if (res.status === 403) {
      throw new StorageError(`Drive: Permission denied while trying to ${action}${detail ? ` (${detail})` : ''}.`, {
        retryable: /rate|quota/i.test(detail),
        status: 403,
      });
    }
    throw new StorageError(`Drive: Could not ${action} (HTTP ${res.status}${detail ? `: ${detail}` : ''}).`, {
      retryable: res.status >= 500 || res.status === 429,
      status: res.status,
    });
  }

  private requireToken() {
    if (!this.hasUsableToken()) {
      this.clearAccessToken();
      throw new StorageError('Drive: Not connected. Use File > Connect Google Drive first.', { retryable: false });
    }
  }

  /** Point at a different Drive file (or none) and mark any save in flight as stale. */
  private linkFile(fileRef: DriveFileRef | null) {
    this.fileRef = fileRef;
    this.fileRefGeneration += 1;
    this.persistFileRef(fileRef);
  }

  private readStoredFileRef(): DriveFileRef | null {
    try {
      const raw = localStorage.getItem(GoogleDriveProvider.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as DriveFileRef;
      if (!parsed?.id || !parsed?.name) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private persistFileRef(fileRef: DriveFileRef | null) {
    try {
      if (!fileRef) {
        localStorage.removeItem(GoogleDriveProvider.storageKey);
        return;
      }
      localStorage.setItem(GoogleDriveProvider.storageKey, JSON.stringify(fileRef));
    } catch (error) {
      // Losing the file link only matters after a reload, so don't fail the save over it.
      console.warn('Could not remember the open Drive file', error);
    }
  }

  /**
   * Ask Google for a token. We only make one request: GIS shows the consent screen on its own
   * when needed, and a second popup after an await gets blocked since it's no longer a user click.
   */
  private requestAccessToken(oauth2: any, clientId: string): Promise<TokenResult> {
    return new Promise((resolve) => {
      const tokenClient = oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (resp: GoogleTokenResponse) => {
          if (!resp?.access_token || resp.error) {
            resolve({ ok: false, reason: describeTokenError(resp?.error, resp?.error_description) });
            return;
          }
          const expiresAt = Date.now() + (resp.expires_in ?? 3600) * 1000;
          this.setAccessToken(resp.access_token, expiresAt);
          resolve({ ok: true });
        },
        // Without this the promise never settles when the popup is closed or blocked.
        error_callback: (err: GoogleTokenError) => {
          resolve({ ok: false, reason: describeTokenError(err?.type, err?.message) });
        },
      });
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  private setAccessToken(accessToken: string, expiresAt: number) {
    this.accessToken = accessToken;
    this.tokenExpiresAt = expiresAt;
    try {
      const stored: StoredToken = { accessToken, expiresAt };
      localStorage.setItem(GoogleDriveProvider.tokenStorageKey, JSON.stringify(stored));
    } catch (error) {
      console.warn('Could not cache the Drive token; you will need to reconnect after reload', error);
    }
  }

  private clearAccessToken() {
    this.accessToken = '';
    this.tokenExpiresAt = 0;
    try {
      localStorage.removeItem(GoogleDriveProvider.tokenStorageKey);
    } catch {
      // Nothing else to do if storage is locked down.
    }
  }

  private readStoredAccessToken() {
    try {
      const raw = localStorage.getItem(GoogleDriveProvider.tokenStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredToken;
      if (!parsed?.accessToken || !parsed?.expiresAt) return;
      if (parsed.expiresAt <= Date.now() + TOKEN_EXPIRY_SLACK_MS) {
        localStorage.removeItem(GoogleDriveProvider.tokenStorageKey);
        return;
      }
      this.accessToken = parsed.accessToken;
      this.tokenExpiresAt = parsed.expiresAt;
    } catch {
      // Corrupt cache, just start signed out.
    }
  }
}

/** Map GIS error codes to something a person can act on. */
function describeTokenError(code?: string, message?: string): string {
  switch (code) {
    case 'popup_failed_to_open':
      return 'Sign-in popup was blocked. Allow popups for this site and try again.';
    case 'popup_closed':
      return 'Sign-in was canceled.';
    case 'access_denied':
      return 'Access was denied. Grant Drive access to save files.';
    case undefined:
    case '':
      return 'Authorization failed';
    default:
      return `Authorization failed (${message || code})`;
  }
}

/** Pull Google's error message out of a failed response, if there is one. */
async function readGoogleErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return typeof body?.error?.message === 'string' ? body.error.message : '';
  } catch {
    return '';
  }
}
