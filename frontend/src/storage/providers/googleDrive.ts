import type { StorageProvider } from './types';

type GoogleTokenResponse = { access_token: string };
type DriveFileRef = { id: string; name: string };

declare global {
  interface Window {
    google?: any;
  }
}

export class GoogleDriveProvider implements StorageProvider {
  private accessToken = '';
  private fileRef: DriveFileRef | null = this.readStoredFileRef();
  private currentStatus = 'Autosave Off';
  private static readonly storageKey = 'drive_active_file_ref';

  status() { return this.currentStatus; }
  getAccessToken() { return this.accessToken; }
  getCurrentFileRef() { return this.fileRef; }

  async connect(): Promise<boolean> {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      this.currentStatus = 'Drive config missing';
      return false;
    }
    this.currentStatus = 'Drive: Connecting...';
    try {
      await this.ensureScript('https://accounts.google.com/gsi/client');
      return new Promise((resolve) => {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/drive.file',
          callback: (resp: GoogleTokenResponse) => {
            if (!resp?.access_token) {
              this.currentStatus = 'Drive: Authorization failed';
              resolve(false);
              return;
            }
            this.accessToken = resp.access_token;
            this.currentStatus = 'Drive: Connected';
            resolve(true);
          },
        });
        tokenClient.requestAccessToken({ prompt: 'consent' });
      });
    } catch {
      this.currentStatus = 'Drive: Connection failed';
      return false;
    }
  }

  async save(content: string, fileName: string): Promise<void> {
    if (!this.accessToken) throw new Error('Google Drive not connected');
    if (!this.fileRef) {
      const fileId = await this.createFile(fileName, content);
      this.fileRef = { id: fileId, name: fileName };
      this.persistFileRef(this.fileRef);
      return;
    }
    await this.updateFile(this.fileRef.id, content);
  }

  async saveAs(content: string, _oldFileName: string, newFileName: string): Promise<void> {
    this.fileRef = null;
    this.persistFileRef(null);
    await this.save(content, newFileName);
  }

  async openDocument(fileId: string): Promise<{ name: string; content: string }> {
    if (!this.accessToken) throw new Error('Google Drive not connected');
    const metadataRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!metadataRes.ok) throw new Error('Drive: Failed to load file metadata');
    const metadata = await metadataRes.json();

    const contentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!contentRes.ok) throw new Error('Drive: Failed to load file content');
    const content = await contentRes.text();
    this.fileRef = { id: metadata.id, name: metadata.name };
    this.persistFileRef(this.fileRef);
    return { name: metadata.name, content };
  }

  async renameFile(fileId: string, newName: string): Promise<void> {
    if (!this.accessToken) throw new Error('Google Drive not connected');
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) throw new Error('Drive: Failed to rename file');
    if (this.fileRef?.id === fileId) {
      this.fileRef = { ...this.fileRef, name: newName };
      this.persistFileRef(this.fileRef);
    }
  }

  async moveFile(fileId: string, targetFolderId: string): Promise<void> {
    if (!this.accessToken) throw new Error('Google Drive not connected');
    const detailsRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!detailsRes.ok) throw new Error('Drive: Failed to fetch parent folder');
    const details = await detailsRes.json();
    const removeParents = Array.isArray(details.parents) ? details.parents.join(',') : '';
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
    url.searchParams.set('addParents', targetFolderId);
    if (removeParents) {
      url.searchParams.set('removeParents', removeParents);
    }
    const moveRes = await fetch(url.toString(), {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!moveRes.ok) throw new Error('Drive: Failed to move file');
  }

  private async createFile(fileName: string, content: string): Promise<string> {
    const metadata = new Blob([JSON.stringify({ name: fileName, mimeType: 'text/x-tex' })], { type: 'application/json' });
    const data = new Blob([content], { type: 'text/plain' });
    const form = new FormData();
    form.append('metadata', metadata);
    form.append('file', data);

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: form,
    });
    if (!res.ok) throw new Error('Drive: Failed to create file');
    const json = await res.json();
    return json.id;
  }

  private async updateFile(fileId: string, content: string): Promise<void> {
    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'text/plain' },
      body: content,
    });
    if (!res.ok) throw new Error('Drive: Failed to update file');
  }

  private async ensureScript(src: string): Promise<void> {
    if (document.querySelector(`script[src="${src}"]`)) return;
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
      document.head.appendChild(script);
    });
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
    if (!fileRef) {
      localStorage.removeItem(GoogleDriveProvider.storageKey);
      return;
    }
    localStorage.setItem(GoogleDriveProvider.storageKey, JSON.stringify(fileRef));
  }
}
