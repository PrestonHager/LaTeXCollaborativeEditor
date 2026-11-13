// Uploading an export to Google Drive. main.ts loads this file with import() the first time
// someone exports to Drive, so it stays out of the initial bundle.
import { StorageError } from '../storage/errors';
import { EXPORTS_PROPERTY, FOLDER_MIME } from '../storage/providers/googleDrive';
import { mimeType } from '../project/paths';
import { throwIfAborted, type ExportFile } from './types';
import type { ExportDestination, SaveRun, SavedExport } from './registry';

/** The parts of the Drive provider an upload needs. driveFetch refreshes the token and words errors. */
export type DriveApi = {
  driveFetch(url: string, init: RequestInit, action: string): Promise<Response>;
  getAccessToken(): string;
};

/**
 * Where the export goes: a folder the person picked, or the `exports` folder in the open
 * project's Drive folder (made on first use). With no project folder, it's the top of My Drive.
 */
export type DriveTarget = { folderId: string; folderName: string } | { exportsIn: string | null; name: string };

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

// Drive shows these as the right kind of file. Anything else goes by the project's own table.
const DRIVE_TYPES: Record<string, string> = { html: 'text/html', tex: 'text/x-tex', zip: 'application/zip', pdf: 'application/pdf' };

/** The MIME type Drive should store an export as, without a charset. */
export function driveMimeType(file: ExportFile): string {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  const fromBlob = file.data.type.split(';')[0].trim();
  return DRIVE_TYPES[ext] ?? (fromBlob && fromBlob !== 'application/octet-stream' ? fromBlob : mimeType(file.name));
}

/** A Drive error response as a sentence for the dialog. */
export function uploadError(status: number, body: string): StorageError {
  let reason = '';
  let detail = '';
  try {
    const json = JSON.parse(body) as { error?: { message?: string; errors?: { reason?: string }[] } };
    reason = json.error?.errors?.[0]?.reason ?? '';
    detail = json.error?.message ?? '';
  } catch {
    // Not JSON, so there's no detail to add.
  }
  if (status === 401) return new StorageError('Drive: Your Google sign-in expired. Press Export again to sign in.', { retryable: false, status });
  if (reason === 'storageQuotaExceeded') return new StorageError('Drive: Google Drive is full. Free up space in Drive, or pick Download.', { retryable: false, status });
  if (status === 404) return new StorageError("Drive: The folder wasn't found, or this app can't see it. Choose another folder.", { retryable: false, status });
  if (status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
    return new StorageError('Drive: Google is limiting requests. Try again in a minute.', { status });
  }
  if (status === 403) return new StorageError(`Drive: Permission denied while uploading${detail ? ` (${detail})` : ''}.`, { retryable: false, status });
  return new StorageError(`Drive: The upload failed (HTTP ${status}${detail ? `: ${detail}` : ''}).`, { retryable: status >= 500, status });
}

/**
 * The id of the project's exports folder, made on first use. It's tagged so the app never
 * loads it as part of the project (see GoogleDriveProvider.openProject).
 */
export async function findOrCreateExportsFolder(api: DriveApi, projectFolderId: string, name: string): Promise<string> {
  const q = `'${projectFolderId}' in parents and mimeType='${FOLDER_MIME}' and appProperties has { key='${EXPORTS_PROPERTY}' and value='1' } and trashed=false`;
  const list = await api.driveFetch(`${DRIVE_API}?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' })}`, {}, 'find the exports folder');
  const found = ((await list.json()) as { files?: { id: string }[] }).files?.[0];
  if (found?.id) return found.id;
  const res = await api.driveFetch(
    `${DRIVE_API}?fields=id`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [projectFolderId], appProperties: { [EXPORTS_PROPERTY]: '1' } }),
    },
    'create the exports folder',
  );
  const made = (await res.json()) as { id?: string };
  if (!made?.id) throw new StorageError('Drive: Made the exports folder, but Google did not return its id.');
  return made.id;
}

export type UploadedFile = { id: string; name: string; webViewLink?: string };

/**
 * Upload one file with a multipart request. It uses XMLHttpRequest, not fetch, because only
 * XHR reports upload progress. Cancel aborts the request.
 */
export function uploadWithProgress(
  file: ExportFile,
  folderId: string | null,
  token: string,
  run: SaveRun,
  makeXhr: () => XMLHttpRequest = () => new XMLHttpRequest(),
): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    throwIfAborted(run.signal);
    const type = driveMimeType(file);
    const form = new FormData();
    const metadata = { name: file.name, mimeType: type, ...(folderId ? { parents: [folderId] } : {}) };
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([file.data], { type }));

    const xhr = makeXhr();
    const abort = () => xhr.abort();
    const done = () => run.signal.removeEventListener('abort', abort);
    xhr.open('POST', `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,name,webViewLink`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total) {
        const fraction = event.loaded / event.total;
        run.onProgress(fraction, `Uploading to Google Drive... ${Math.round(fraction * 100)}%`);
      }
    };
    xhr.onload = () => {
      done();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(uploadError(xhr.status, String(xhr.responseText ?? '')));
        return;
      }
      try {
        const json = JSON.parse(xhr.responseText) as Partial<UploadedFile>;
        if (!json.id) throw new Error('no id');
        resolve({ id: json.id, name: json.name ?? file.name, webViewLink: json.webViewLink });
      } catch {
        reject(new StorageError('Drive: Uploaded the file, but Google sent back an answer we could not read.'));
      }
    };
    xhr.onerror = () => {
      done();
      reject(new StorageError('Drive: Could not upload. Check your connection and try again.'));
    };
    xhr.onabort = () => {
      done();
      reject(new DOMException('Export canceled', 'AbortError'));
    };
    run.signal.addEventListener('abort', abort, { once: true });
    run.onProgress(0, 'Uploading to Google Drive...');
    xhr.send(form);
  });
}

/** A link to open a Drive file, for when Google leaves webViewLink out. */
export const driveFileUrl = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;

/** The export destination for Google Drive. The folder is looked up (or made) once, on the first save. */
export function createDriveDestination(api: DriveApi, target: DriveTarget, makeXhr?: () => XMLHttpRequest): ExportDestination {
  let folder: Promise<string | null> | null = null;
  const folderLabel = 'folderId' in target ? target.folderName : target.exportsIn ? target.name : 'My Drive';
  const resolveFolder = async (): Promise<string | null> => {
    if ('folderId' in target) {
      // A cheap check that the picked folder is still there. It also refreshes the token if it needs it.
      await api.driveFetch(`${DRIVE_API}/${encodeURIComponent(target.folderId)}?fields=id`, {}, 'open the folder you picked');
      return target.folderId;
    }
    return target.exportsIn ? findOrCreateExportsFolder(api, target.exportsIn, target.name) : null;
  };
  return {
    id: 'drive',
    label: 'Google Drive',
    async save(file, run): Promise<SavedExport> {
      run.onProgress(0, 'Finding the Drive folder...');
      if (!folder) {
        folder = resolveFolder();
        // Look again next time if this failed.
        folder.catch(() => (folder = null));
      }
      const folderId = await folder;
      throwIfAborted(run.signal);
      const uploaded = await uploadWithProgress(file, folderId, api.getAccessToken(), run, makeXhr);
      return { name: uploaded.name, url: uploaded.webViewLink ?? driveFileUrl(uploaded.id) };
    },
    doneMessage: (saved) => `Saved ${saved.map((file) => file.name).join(', ')} to Google Drive (${folderLabel})`,
  };
}
