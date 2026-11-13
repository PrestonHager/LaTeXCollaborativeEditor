// Templates and the profile in Google Drive (#74). Loaded with the template picker, not with the page.
//
// Layout in My Drive, all made by this app (so the drive.file scope can see it):
//   Templates/                      folder tagged latexTemplates=1
//     <template name>/              folder tagged latexTemplate=1, one per template
//       template.json, main.tex, ...
//     profile.json                  file tagged latexProfile=1, only while a profile is saved
// Template folders aren't tagged as projects, so File > Open from Google Drive's project list skips
// them, and opening the Templates folder itself as a project is refused (googleDrive.ts).
import { StorageError } from '../storage/errors';
import { FOLDER_MIME, TEMPLATES_FOLDER_PROPERTY, TEMPLATE_PROPERTY } from '../storage/providers/googleDrive';
import type { ProjectSummary } from '../storage/providers/types';

export const PROFILE_PROPERTY = 'latexProfile';
export const TEMPLATES_FOLDER_NAME = 'Templates';
const PROFILE_FILE_NAME = 'profile.json';

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

/** What these calls need from the Drive provider. driveFetch refreshes the token and words errors. */
export type DriveFetch = { driveFetch(url: string, init: RequestInit, action: string): Promise<Response> };

type Item = { id: string; name: string; modifiedTime?: string };

const tagged = (key: string) => `appProperties has { key='${key}' and value='1' } and trashed=false`;

export function createDriveTemplates(api: DriveFetch) {
  let folder: Promise<string> | null = null;

  async function list(q: string, action: string): Promise<Item[]> {
    const items: Item[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ q, fields: 'nextPageToken,files(id,name,modifiedTime)', pageSize: '1000' });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await api.driveFetch(`${DRIVE_API}?${params}`, {}, action);
      const json = (await res.json()) as { files?: Item[]; nextPageToken?: string };
      items.push(...(json.files ?? []));
      pageToken = json.nextPageToken;
    } while (pageToken);
    return items;
  }

  async function createFolder(name: string, parent: string | null, properties: Record<string, string>, action: string): Promise<Item> {
    const res = await api.driveFetch(
      `${DRIVE_API}?fields=id,name`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}), appProperties: properties }),
      },
      action,
    );
    const made = (await res.json()) as Partial<Item>;
    if (!made?.id) throw new StorageError('Drive: Made a folder, but Google did not return its id.');
    return { id: made.id, name: made.name ?? name };
  }

  /** The Templates folder, found by its tag or made on first use. */
  function templatesFolder(): Promise<string> {
    folder ??= (async () => {
      const found = await list(`mimeType='${FOLDER_MIME}' and ${tagged(TEMPLATES_FOLDER_PROPERTY)}`, 'find the Templates folder');
      if (found[0]) return found[0].id;
      return (await createFolder(TEMPLATES_FOLDER_NAME, null, { [TEMPLATES_FOLDER_PROPERTY]: '1' }, 'create the Templates folder')).id;
    })();
    // Look again next time if this failed.
    folder.catch(() => (folder = null));
    return folder;
  }

  async function profileFiles(): Promise<Item[]> {
    return list(`mimeType!='${FOLDER_MIME}' and ${tagged(PROFILE_PROPERTY)}`, 'find your saved profile');
  }

  return {
    async listTemplates(): Promise<ProjectSummary[]> {
      const items = await list(`mimeType='${FOLDER_MIME}' and ${tagged(TEMPLATE_PROPERTY)}`, 'list your templates');
      return items
        .map((item) => ({ id: item.id, name: item.name, updatedAt: item.modifiedTime ? Date.parse(item.modifiedTime) : undefined }))
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    },

    /** A new, empty template folder in Templates. Its files are written with the provider's writeFile. */
    async createTemplate(name: string): Promise<ProjectSummary> {
      const made = await createFolder(name, await templatesFolder(), { [TEMPLATE_PROPERTY]: '1' }, 'create the template folder');
      return { id: made.id, name: made.name };
    },

    /** Move a template folder to the Drive trash, like deleted project files. */
    async deleteTemplate(id: string): Promise<void> {
      await api.driveFetch(
        `${DRIVE_API}/${encodeURIComponent(id)}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) },
        'delete the template',
      );
    },

    /** The saved profile file's text, or null when there isn't one. */
    async readProfile(): Promise<string | null> {
      const [file] = await profileFiles();
      if (!file) return null;
      const res = await api.driveFetch(`${DRIVE_API}/${encodeURIComponent(file.id)}?alt=media`, {}, 'read your saved profile');
      return res.text();
    },

    /** Save the profile file, replacing the one that's there. */
    async writeProfile(text: string): Promise<void> {
      const [file] = await profileFiles();
      const body = new Blob([text], { type: 'application/json' });
      if (file) {
        await api.driveFetch(
          `${DRIVE_UPLOAD_API}/${encodeURIComponent(file.id)}?uploadType=media`,
          { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body },
          'save your profile',
        );
        return;
      }
      const form = new FormData();
      const metadata = { name: PROFILE_FILE_NAME, mimeType: 'application/json', parents: [await templatesFolder()], appProperties: { [PROFILE_PROPERTY]: '1' } };
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', body);
      await api.driveFetch(`${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id`, { method: 'POST', body: form }, 'save your profile');
    },

    /**
     * Delete every saved profile file for good, not to the trash: clearing the profile should leave
     * no copy behind. Returns how many it deleted.
     */
    async deleteProfile(): Promise<number> {
      const files = await profileFiles();
      for (const file of files) await api.driveFetch(`${DRIVE_API}/${encodeURIComponent(file.id)}`, { method: 'DELETE' }, 'delete your saved profile');
      return files.length;
    },
  };
}

export type DriveTemplates = ReturnType<typeof createDriveTemplates>;
