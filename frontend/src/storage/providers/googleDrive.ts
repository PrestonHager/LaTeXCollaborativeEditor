import type { StorageProvider } from './types';

type GoogleTokenResponse = { access_token: string };

declare global {
  interface Window {
    google?: any;
  }
}

export class GoogleDriveProvider implements StorageProvider {
  private accessToken = '';
  private fileId: string | null = localStorage.getItem('drive_file_id');
  private currentStatus = 'Autosave Off';

  status() { return this.currentStatus; }

  async connect(): Promise<boolean> {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      this.currentStatus = 'Drive config missing';
      return false;
    }
    await this.ensureScript('https://accounts.google.com/gsi/client');
    return new Promise((resolve) => {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (resp: GoogleTokenResponse) => {
          this.accessToken = resp.access_token;
          this.currentStatus = 'Drive Connected';
          resolve(true);
        },
      });
      tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  }

  async save(content: string, fileName: string): Promise<void> {
    if (!this.accessToken) throw new Error('Google Drive not connected');
    if (!this.fileId) this.fileId = await this.createFile(fileName, content);
    await this.updateFile(this.fileId, content);
  }

  async saveAs(content: string, _oldFileName: string, newFileName: string): Promise<void> {
    // Google Drive "move by name" is provider-specific. MVP behavior is to create/update under new name.
    this.fileId = null;
    await this.save(content, newFileName);
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
    if (!res.ok) throw new Error('Failed to create Drive file');
    const json = await res.json();
    localStorage.setItem('drive_file_id', json.id);
    return json.id;
  }

  private async updateFile(fileId: string, content: string): Promise<void> {
    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'text/plain' },
      body: content,
    });
    if (!res.ok) throw new Error('Failed to update Drive file');
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
}
