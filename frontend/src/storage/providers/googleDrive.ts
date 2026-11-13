import type { ProjectListing, ProjectSummary, StorageProvider, WriteOptions, WriteResult } from './types';
import { StorageError } from '../errors';
import { ConflictError } from '../conflicts';
import { loadScript } from './scriptLoader';
import { basename, dirname, isInside, joinPath, mimeType, replacePrefix } from '../../project/paths';

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};
type GoogleTokenError = { type?: string; message?: string };
// The single Drive file an old session was saving to, from before projects.
type DriveFileRef = { id: string; name: string; documentId?: string };
type StoredToken = { accessToken: string; expiresAt: number; account?: string };
type TokenResult = { ok: true } | { ok: false; reason: string };
type DriveItem = { id: string; name: string; mimeType?: string; parents?: string[]; appProperties?: Record<string, string>; modifiedTime?: string; version?: string; md5Checksum?: string };

/**
 * What we know about an open project's files: path to Drive id.
 * An old single-file project has no root folder yet, just the file and the folder it sits in.
 */
type IndexItem = { id: string; folder: boolean; version?: string };
type ProjectIndex = {
  rootId: string;
  // A file's version is from our last load or save of it, see versionToken.
  paths: Map<string, IndexItem>;
  legacy?: { fileId: string; parentId: string | null; name: string };
};

declare global {
  interface Window {
    google?: any;
  }
}

const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
// The about endpoint tells us who's signed in, and works with the drive.file scope we already have.
const DRIVE_ABOUT_API = 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
// What we ask Drive for to tell if a file changed under us.
const VERSION_FIELDS = 'version,md5Checksum';
// Project folders are tagged so "list projects" can find them without seeing the rest of Drive.
const PROJECT_PROPERTY = 'latexProject';
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
const TOKEN_EXPIRY_SLACK_MS = 60_000;
// Give up on a silent refresh after this long, so a stuck popup can't stall autosave forever.
const TOKEN_REFRESH_TIMEOUT_MS = 20_000;
// Drive error reasons that mean "slow down and try again".
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);
// Don't hold up a disconnect for long if Google never answers the revoke call.
const TOKEN_REVOKE_TIMEOUT_MS = 5_000;
// Old builds kept the token here, where any script on the page could read it.
const OLD_TOKEN_KEY = 'drive_access_token';

/**
 * Projects in Google Drive. A project is a Drive folder and every project file is a real
 * Drive file in it, with subfolders kept as they are.
 * NOTE: the drive.file scope only lets us see files this app made or the person picked.
 * Files added to the folder from Drive itself stay hidden until they're picked, see app/driveAddFiles.ts.
 */
export class GoogleDriveProvider implements StorageProvider {
  readonly label = 'Google Drive';
  // NOTE: we keep an expired token around until a refresh fails, it marks that we were signed in.
  private accessToken = '';
  private tokenExpiresAt = 0;
  private currentStatus = 'Autosave Off';
  private refreshing: Promise<boolean> | null = null;
  private sessionLostHandler: (() => void) | null = null;
  // The signed-in Google account, once we've looked it up.
  private account: string | null = null;
  // Goes up on every sign-out, so a token request that was already running can't sign us back in.
  private signOuts = 0;
  private readonly indexes = new Map<string, ProjectIndex>();
  // Old single-file project ids that have since become real folders.
  private readonly aliases = new Map<string, string>();
  // What remove() put in the Drive trash this visit, by Drive id, so an undone delete untrashes the
  // same file instead of making a copy. Paths inside a trashed folder are kept relative to it.
  private readonly trashed = new Map<string, { projectId: string; parentId?: string; item: IndexItem; inside: [string, IndexItem][] }>();
  // NOTE: the token lives in sessionStorage, so it survives a reload but not a new tab or a closed browser.
  private static readonly tokenStorageKey = 'drive_session_token';

  constructor() {
    removeOldToken();
    this.readStoredAccessToken();
  }

  status() { return this.currentStatus; }
  getAccessToken() { return this.accessToken; }

  /** Check for a live token without opening any sign-in popup. */
  hasUsableToken(): boolean {
    return this.accessToken.length > 0 && this.tokenExpiresAt - TOKEN_EXPIRY_SLACK_MS > Date.now();
  }

  /** Check if we're signed in, even if the token needs a refresh before the next call. */
  isSignedIn(): boolean {
    return this.accessToken.length > 0;
  }

  /** Run this when the token expired and a silent refresh couldn't get a new one. */
  onSessionLost(handler: () => void) {
    this.sessionLostHandler = handler;
  }

  /**
   * The project id for the Drive file an old session was saving to, if it belongs to documentId.
   * Sessions from before document ids only match by file name.
   */
  legacyProjectId(documentId: string | undefined, fileName: string): string | null {
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
  forgetLegacyFile() {
    try {
      localStorage.removeItem(LEGACY_FILE_KEY);
    } catch {
      // Nothing to do if storage is locked down.
    }
  }

  /** The email (or name) of the signed-in Google account, if we know it. */
  accountLabel(): string | null {
    return this.isSignedIn() ? this.account : null;
  }

  /**
   * Look up who's signed in with the Drive about endpoint.
   * This is best effort, so a failure just leaves the account unknown.
   */
  async loadAccount(): Promise<string | null> {
    if (!this.hasUsableToken()) return null;
    if (this.account) return this.account;
    const token = this.accessToken;
    try {
      const res = await fetch(DRIVE_ABOUT_API, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const json = (await res.json()) as { user?: { emailAddress?: string; displayName?: string } };
      const account = json?.user?.emailAddress || json?.user?.displayName || null;
      // Skip it if we signed out while the lookup was running.
      if (!account || this.accessToken !== token) return null;
      this.account = account;
      this.writeStoredToken();
      return account;
    } catch (error) {
      console.warn('Could not look up the Drive account', error);
      return null;
    }
  }

  /**
   * Sign out of Drive. First we forget the token and what we know about Drive files,
   * then we ask Google to revoke the token so it stops working everywhere.
   */
  async disconnect(): Promise<void> {
    const token = this.accessToken;
    this.signOuts += 1;
    this.clearAccessToken();
    this.indexes.clear();
    this.aliases.clear();
    this.forgetLegacyFile();
    this.currentStatus = 'Drive: Disconnected';
    if (!token) return;
    try {
      await loadScript(GIS_SCRIPT, 'Google sign-in');
      const oauth2 = window.google?.accounts?.oauth2;
      if (!oauth2?.revoke) throw new Error('Google sign-in script loaded but revoke is missing');
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        new Promise<void>((resolve) => oauth2.revoke(token, () => resolve())),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, TOKEN_REVOKE_TIMEOUT_MS);
        }),
      ]);
      clearTimeout(timer);
    } catch (error) {
      // The token is gone from this page either way, and it runs out within the hour.
      console.warn('Could not revoke the Drive token', error);
    }
  }

  currentProjectId(projectId: string): string {
    return this.aliases.get(projectId) ?? projectId;
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

  async listProjects(): Promise<ProjectSummary[]> {
    this.requireToken();
    const q = `mimeType='${FOLDER_MIME}' and appProperties has { key='${PROJECT_PROPERTY}' and value='1' } and trashed=false`;
    const items = await this.listAll(q, 'id,name,modifiedTime', 'list projects');
    return items
      .map((item) => ({ id: item.id, name: item.name, updatedAt: item.modifiedTime ? Date.parse(item.modifiedTime) : undefined }))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  async createProject(name: string): Promise<ProjectSummary> {
    this.requireToken();
    const folder = await this.createFolderItem(name, null, { [PROJECT_PROPERTY]: '1' });
    this.indexes.set(folder.id, { rootId: folder.id, paths: new Map() });
    this.currentStatus = `Drive: Created project folder ${name}`;
    return { id: folder.id, name };
  }

  async openProject(projectId: string): Promise<ProjectListing> {
    this.requireToken();
    const id = this.currentProjectId(projectId);
    if (id.startsWith(LEGACY_PREFIX)) return this.openLegacyFile(id);

    const res = await this.driveFetch(`${DRIVE_API}/${id}?fields=id,name,mimeType,appProperties`, {}, 'open the project folder');
    const folder = (await res.json()) as DriveItem;
    if (folder.mimeType !== FOLDER_MIME) throw new StorageError('Drive: That is not a folder.', { retryable: false });
    if (folder.appProperties?.[TEMPLATES_FOLDER_PROPERTY] === '1') {
      throw new StorageError('Drive: That is your Templates folder. Use File > New Project to start from a template.', { retryable: false });
    }

    // Walk the folder tree one level at a time.
    const index: ProjectIndex = { rootId: folder.id, paths: new Map() };
    const entries: ProjectListing['entries'] = [];
    let level: { id: string; path: string }[] = [{ id: folder.id, path: '' }];
    while (level.length) {
      const next: typeof level = [];
      for (const dir of level) {
        const children = await this.listAll(`'${dir.id}' in parents and trashed=false`, `id,name,mimeType,appProperties,${VERSION_FIELDS}`, 'list project files');
        for (const child of children) {
          const path = dir.path ? `${dir.path}/${child.name}` : child.name;
          if (child.mimeType === FOLDER_MIME && child.appProperties?.[EXPORTS_PROPERTY] === '1') continue;
          if (child.mimeType === FOLDER_MIME) {
            index.paths.set(path, { id: child.id, folder: true });
            entries.push({ path, kind: 'folder' });
            next.push({ id: child.id, path });
          } else if (!child.mimeType?.startsWith('application/vnd.google-apps.')) {
            // Skip Google Docs and Sheets, since they have no file bytes to download.
            index.paths.set(path, { id: child.id, folder: false, version: versionToken(child) });
            entries.push({ path, kind: 'file' });
          }
        }
      }
      level = next;
    }
    this.indexes.set(projectId, index);
    this.indexes.set(id, index);
    this.currentStatus = `Drive: Opened ${folder.name}`;
    return { id, name: folder.name, mainPath: folder.appProperties?.mainFile ?? null, entries: entries.sort((a, b) => a.path.localeCompare(b.path)) };
  }

  async readFile(projectId: string, path: string): Promise<Uint8Array> {
    const index = await this.ensureIndex(projectId);
    const item = index.paths.get(path);
    if (!item || item.folder) throw new StorageError(`Drive: ${path} was not found in this project.`, { retryable: false });
    const res = await this.driveFetch(`${DRIVE_API}/${item.id}?alt=media`, {}, `load ${path}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** The Drive version we last saw for a file, so a later save can check it. */
  fileVersion(projectId: string, path: string): string | undefined {
    return this.indexes.get(projectId)?.paths.get(path)?.version;
  }

  async writeFile(projectId: string, path: string, data: string | Uint8Array, options: WriteOptions = {}): Promise<WriteResult> {
    let index = await this.ensureIndex(projectId);
    if (index.legacy && path !== index.legacy.name) index = await this.upgradeLegacy(projectId, index);
    const body = new Blob([data as BlobPart], { type: mimeType(path) });
    const existing = index.paths.get(path);
    if (existing && !existing.folder) {
      // First, check the file hasn't changed in Drive since we last saw it. It's one small metadata call.
      const expected = options.expectedVersion ?? existing.version;
      if (expected && !options.force) {
        const check = await this.driveFetch(`${DRIVE_API}/${existing.id}?fields=${VERSION_FIELDS}`, {}, `check ${path}`);
        const remote = versionToken(await readJson(check));
        if (!sameContent(expected, remote)) throw new ConflictError(path, remote);
      }
      // Now overwrite it, and keep the new version for next time.
      const res = await this.driveFetch(
        `${DRIVE_UPLOAD_API}/${existing.id}?uploadType=media&fields=${VERSION_FIELDS}`,
        { method: 'PATCH', headers: { 'Content-Type': mimeType(path) }, body },
        `save ${path}`,
      );
      existing.version = versionToken(await readJson(res));
      return { version: existing.version };
    }
    const parentId = await this.ensureFolder(index, dirname(path));
    const metadata = new Blob([JSON.stringify({ name: basename(path), parents: [parentId] })], { type: 'application/json' });
    const form = new FormData();
    form.append('metadata', metadata);
    form.append('file', body);
    const res = await this.driveFetch(
      `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,${VERSION_FIELDS}`,
      { method: 'POST', body: form },
      `create ${path}`,
    );
    const json = (await res.json()) as Partial<DriveItem>;
    if (!json?.id) throw new StorageError('Drive: Created a file but Google did not return its id');
    const version = versionToken(json);
    index.paths.set(path, { id: json.id, folder: false, version });
    return { version };
  }

  async createFolder(projectId: string, path: string): Promise<void> {
    let index = await this.ensureIndex(projectId);
    if (index.legacy) index = await this.upgradeLegacy(projectId, index);
    await this.ensureFolder(index, path);
  }

  async move(projectId: string, from: string, to: string): Promise<void> {
    let index = await this.ensureIndex(projectId);
    if (index.legacy) index = await this.upgradeLegacy(projectId, index);
    const item = index.paths.get(from);
    if (!item) throw new StorageError(`Drive: ${from} was not found in this project.`, { retryable: false });
    const oldParent = this.folderId(index, dirname(from));
    const newParent = await this.ensureFolder(index, dirname(to));
    const url = new URL(`${DRIVE_API}/${item.id}`);
    if (oldParent !== newParent) {
      url.searchParams.set('addParents', newParent);
      url.searchParams.set('removeParents', oldParent);
    }
    await this.driveFetch(
      url.toString(),
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: basename(to) }) },
      `move ${from}`,
    );
    // Now fix up our paths, including everything inside a moved folder.
    for (const [path, value] of [...index.paths]) {
      if (path !== from && !isInside(path, from)) continue;
      index.paths.delete(path);
      index.paths.set(replacePrefix(path, from, to), value);
    }
  }

  async remove(projectId: string, path: string): Promise<string | void> {
    let index = await this.ensureIndex(projectId);
    if (index.legacy) index = await this.upgradeLegacy(projectId, index);
    const item = index.paths.get(path);
    const parentId = dirname(path) ? index.paths.get(dirname(path))?.id : index.rootId;
    if (item) {
      // Move it to the Drive trash instead of deleting it for good.
      await this.driveFetch(
        `${DRIVE_API}/${item.id}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) },
        `delete ${path}`,
      );
    }
    const inside: [string, IndexItem][] = [];
    for (const [key, value] of [...index.paths]) {
      if (key !== path && !isInside(key, path)) continue;
      if (key !== path) inside.push([key.slice(path.length + 1), value]);
      index.paths.delete(key);
    }
    if (!item) return;
    this.trashed.set(item.id, { projectId, parentId, item, inside });
    return item.id;
  }

  /** Untrash what remove() trashed, at path. Drive brings a folder's contents back with it. */
  async restore(projectId: string, path: string, token: string): Promise<boolean> {
    const record = this.trashed.get(token);
    if (!record || record.projectId !== projectId) return false;
    let index = await this.ensureIndex(projectId);
    if (index.legacy) index = await this.upgradeLegacy(projectId, index);
    // Something else is at that path now, so the caller writes a new file instead.
    if (index.paths.has(path)) return false;
    const parentId = await this.ensureFolder(index, dirname(path));
    const url = new URL(`${DRIVE_API}/${token}`);
    url.searchParams.set('fields', VERSION_FIELDS);
    if (parentId !== record.parentId) {
      if (!record.parentId) return false;
      url.searchParams.set('addParents', parentId);
      url.searchParams.set('removeParents', record.parentId);
    }
    let res: Response;
    try {
      res = await this.driveFetch(
        url.toString(),
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: false, name: basename(path) }) },
        `restore ${path}`,
      );
    } catch (error) {
      // Deleted for good, like after emptying the trash.
      if (error instanceof StorageError && error.status === 404) {
        this.trashed.delete(token);
        return false;
      }
      throw error;
    }
    const version = record.item.folder ? undefined : versionToken(await readJson(res));
    index.paths.set(path, { ...record.item, ...(version ? { version } : {}) });
    for (const [relative, value] of record.inside) index.paths.set(joinPath(path, relative), value);
    this.trashed.delete(token);
    return true;
  }

  async renameProject(projectId: string, name: string): Promise<void> {
    const index = await this.ensureIndex(projectId);
    // An old single file has no folder to rename yet. Its file name is a project file path instead.
    if (index.legacy) return;
    await this.patchMetadata(index.rootId, { name }, 'rename the project folder');
  }

  async setMainFile(projectId: string, path: string | null): Promise<void> {
    const index = await this.ensureIndex(projectId);
    if (index.legacy) return;
    await this.patchMetadata(index.rootId, { appProperties: { mainFile: path } }, 'set the main file');
  }

  /** Move the project folder into another Drive folder. */
  async moveProject(projectId: string, targetFolderId: string): Promise<void> {
    const index = await this.ensureIndex(projectId);
    const id = index.legacy ? index.legacy.fileId : index.rootId;
    const detailsRes = await this.driveFetch(`${DRIVE_API}/${id}?fields=parents`, {}, 'look up the current folder');
    const details = (await detailsRes.json()) as Partial<DriveItem>;
    const url = new URL(`${DRIVE_API}/${id}`);
    url.searchParams.set('addParents', targetFolderId);
    if (details.parents?.length) url.searchParams.set('removeParents', details.parents.join(','));
    await this.driveFetch(url.toString(), { method: 'PATCH' }, 'move the project');
    if (index.legacy) index.legacy.parentId = targetFolderId;
  }

  /**
   * The Drive id of the project's root folder, or null for an old single-file project that has
   * no folder yet.
   */
  async projectFolderId(projectId: string): Promise<string | null> {
    const index = await this.ensureIndex(projectId);
    return index.legacy ? null : index.rootId;
  }

  /** The project path of a Drive file or folder we can see, if it's in this project. */
  pathOfDriveId(projectId: string, driveId: string): string | undefined {
    const index = this.indexes.get(this.currentProjectId(projectId)) ?? this.indexes.get(projectId);
    if (!index) return undefined;
    for (const [path, item] of index.paths) {
      if (item.id === driveId) return path;
    }
    return undefined;
  }

  private async openLegacyFile(projectId: string): Promise<ProjectListing> {
    const fileId = projectId.slice(LEGACY_PREFIX.length);
    const res = await this.driveFetch(`${DRIVE_API}/${fileId}?fields=id,name,mimeType,parents,${VERSION_FIELDS}`, {}, 'load file details');
    const file = (await res.json()) as DriveItem;
    if (file.mimeType === FOLDER_MIME) return this.openProject(file.id);
    const index: ProjectIndex = {
      rootId: '',
      paths: new Map([[file.name, { id: file.id, folder: false, version: versionToken(file) }]]),
      legacy: { fileId: file.id, parentId: file.parents?.[0] ?? null, name: file.name },
    };
    this.indexes.set(projectId, index);
    this.currentStatus = `Drive: Opened ${file.name}`;
    return { id: projectId, name: file.name.replace(/\.tex$/, ''), mainPath: file.name, entries: [{ path: file.name, kind: 'file' }] };
  }

  /**
   * An old single-file project just got a second file, so give it a real project folder.
   * We make the folder next to the file, then move the file into it.
   */
  private async upgradeLegacy(projectId: string, index: ProjectIndex): Promise<ProjectIndex> {
    const legacy = index.legacy!;
    const folder = await this.createFolderItem(legacy.name.replace(/\.tex$/, ''), legacy.parentId, { [PROJECT_PROPERTY]: '1', mainFile: legacy.name });
    const url = new URL(`${DRIVE_API}/${legacy.fileId}`);
    url.searchParams.set('addParents', folder.id);
    if (legacy.parentId) url.searchParams.set('removeParents', legacy.parentId);
    await this.driveFetch(url.toString(), { method: 'PATCH' }, 'move the file into its project folder');
    const upgraded: ProjectIndex = { rootId: folder.id, paths: index.paths };
    this.indexes.set(projectId, upgraded);
    this.indexes.set(folder.id, upgraded);
    this.aliases.set(projectId, folder.id);
    this.forgetLegacyFile();
    this.currentStatus = `Drive: Moved ${legacy.name} into a new project folder`;
    return upgraded;
  }

  private async ensureIndex(projectId: string): Promise<ProjectIndex> {
    this.requireToken();
    const known = this.indexes.get(projectId);
    if (known) return known;
    await this.openProject(projectId);
    return this.indexes.get(projectId)!;
  }

  private folderId(index: ProjectIndex, dir: string): string {
    if (!dir) return index.rootId;
    const item = index.paths.get(dir);
    if (!item?.folder) throw new StorageError(`Drive: Folder ${dir} was not found in this project.`, { retryable: false });
    return item.id;
  }

  /** Get the Drive id of a project folder, making it and its parents when they're missing. */
  private async ensureFolder(index: ProjectIndex, dir: string): Promise<string> {
    if (!dir) return index.rootId;
    const known = index.paths.get(dir);
    if (known?.folder) return known.id;
    const parentId = await this.ensureFolder(index, dirname(dir));
    const folder = await this.createFolderItem(basename(dir), parentId);
    index.paths.set(dir, { id: folder.id, folder: true });
    return folder.id;
  }

  private async createFolderItem(name: string, parentId: string | null, appProperties?: Record<string, string>): Promise<DriveItem> {
    const res = await this.driveFetch(
      `${DRIVE_API}?fields=id,name`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}), ...(appProperties ? { appProperties } : {}) }),
      },
      `create folder ${name}`,
    );
    const json = (await res.json()) as DriveItem;
    if (!json?.id) throw new StorageError('Drive: Created a folder but Google did not return its id');
    return json;
  }

  private async patchMetadata(id: string, body: Record<string, unknown>, action: string) {
    await this.driveFetch(
      `${DRIVE_API}/${id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      action,
    );
  }

  /** Run a files.list query and follow every page. */
  private async listAll(q: string, fields: string, action: string): Promise<DriveItem[]> {
    const items: DriveItem[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(DRIVE_API);
      url.searchParams.set('q', q);
      url.searchParams.set('fields', `nextPageToken,files(${fields})`);
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const res = await this.driveFetch(url.toString(), {}, action);
      const json = (await res.json()) as { files?: DriveItem[]; nextPageToken?: string };
      items.push(...(json.files ?? []));
      pageToken = json.nextPageToken;
    } while (pageToken);
    return items;
  }

  /**
   * Call the Drive API with our token and turn failures into readable errors.
   * An expired token or a 401 gets one silent refresh, then we give up and ask the user to reconnect.
   * Public so the Drive export (export/driveUpload.ts) can use it too.
   */
  async driveFetch(url: string, init: RequestInit, action: string, isRetry = false): Promise<Response> {
    // First, swap out a token that's about to expire.
    if (!this.hasUsableToken() && !(await this.refreshAccessToken())) {
      throw sessionExpiredError();
    }
    const headers = { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${this.accessToken}` };
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers });
    } catch (error) {
      throw new StorageError(`Drive: Could not ${action}. Check your connection and try again.`, { cause: error });
    }
    if (res.ok) return res;

    const { message: detail, reason } = await readGoogleError(res);
    if (res.status === 401) {
      // Google can revoke a token early, so try once more with a fresh one.
      if (!isRetry) {
        this.tokenExpiresAt = 0;
        if (await this.refreshAccessToken()) return this.driveFetch(url, init, action, true);
      } else {
        this.endSession();
      }
      throw sessionExpiredError(401);
    }
    if (res.status === 404) {
      // NOTE: with the drive.file scope we only see files this app created or the user picked.
      throw new StorageError(
        `Drive: Could not ${action}. The file was not found or this app does not have access to it.`,
        { retryable: false, status: 404 },
      );
    }
    // Go by Google's error reason, not the message. "Storage quota exceeded" sounds like a rate limit but isn't.
    if (reason === 'storageQuotaExceeded') {
      throw new StorageError('Drive: Google Drive is full. Free up space in Drive, or download a .zip so you don\'t lose work.', {
        retryable: false,
        status: res.status,
      });
    }
    if (RATE_LIMIT_REASONS.has(reason) || res.status === 429) {
      throw new StorageError(`Drive: Google is limiting requests, so we could not ${action}. Try again in a minute.`, {
        retryable: true,
        status: res.status,
      });
    }
    if (res.status === 403) {
      throw new StorageError(`Drive: Permission denied while trying to ${action}${detail ? ` (${detail})` : ''}.`, {
        retryable: false,
        status: 403,
      });
    }
    throw new StorageError(`Drive: Could not ${action} (HTTP ${res.status}${detail ? `: ${detail}` : ''}).`, {
      retryable: res.status >= 500 || reason === 'backendError',
      status: res.status,
    });
  }

  // An expired token is fine here, driveFetch refreshes it before the request goes out.
  private requireToken() {
    if (!this.isSignedIn()) {
      throw new StorageError('Drive: Not connected. Use File > Connect Google Drive first.', { retryable: false });
    }
  }

  /** Get a new token without a popup. Concurrent callers share one attempt. */
  private refreshAccessToken(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = this.trySilentRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  /**
   * Ask GIS for a new token with prompt '' so it skips the consent screen.
   * This can still fail when the browser blocks the popup outside a click, so we end the session then.
   */
  private async trySilentRefresh(): Promise<boolean> {
    if (!this.isSignedIn()) return false;
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (clientId) {
      try {
        await loadScript(GIS_SCRIPT, 'Google sign-in');
        const oauth2 = window.google?.accounts?.oauth2;
        if (oauth2?.initTokenClient) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeout = new Promise<TokenResult>((resolve) => {
            timer = setTimeout(() => resolve({ ok: false, reason: 'Timed out' }), TOKEN_REFRESH_TIMEOUT_MS);
          });
          const result = await Promise.race([this.requestAccessToken(oauth2, clientId), timeout]);
          clearTimeout(timer);
          if (result.ok) {
            this.currentStatus = 'Drive: Connected';
            return true;
          }
        }
      } catch (error) {
        console.warn('Silent Drive token refresh failed', error);
      }
    }
    this.endSession();
    return false;
  }

  /** Forget the token and let the app know, so it can fall back to saving locally. */
  private endSession() {
    const wasSignedIn = this.isSignedIn();
    this.clearAccessToken();
    this.currentStatus = 'Drive: Session expired';
    if (wasSignedIn) this.sessionLostHandler?.();
  }

  /**
   * Ask Google for a token. We only make one request: GIS shows the consent screen on its own
   * when needed, and a second popup after an await gets blocked since it's no longer a user click.
   */
  private requestAccessToken(oauth2: any, clientId: string): Promise<TokenResult> {
    const signOuts = this.signOuts;
    return new Promise((resolve) => {
      const tokenClient = oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (resp: GoogleTokenResponse) => {
          if (signOuts !== this.signOuts) {
            resolve({ ok: false, reason: 'Disconnected' });
            return;
          }
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
    this.writeStoredToken();
  }

  private writeStoredToken() {
    try {
      const stored: StoredToken = { accessToken: this.accessToken, expiresAt: this.tokenExpiresAt };
      if (this.account) stored.account = this.account;
      sessionStorage.setItem(GoogleDriveProvider.tokenStorageKey, JSON.stringify(stored));
    } catch (error) {
      console.warn('Could not keep the Drive token for this tab; you will need to reconnect after reload', error);
    }
  }

  private clearAccessToken() {
    this.accessToken = '';
    this.tokenExpiresAt = 0;
    this.account = null;
    try {
      sessionStorage.removeItem(GoogleDriveProvider.tokenStorageKey);
    } catch {
      // Nothing else to do if storage is locked down.
    }
  }

  private readStoredAccessToken() {
    try {
      const raw = sessionStorage.getItem(GoogleDriveProvider.tokenStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredToken;
      if (!parsed?.accessToken || !parsed?.expiresAt) return;
      if (parsed.expiresAt <= Date.now() + TOKEN_EXPIRY_SLACK_MS) {
        sessionStorage.removeItem(GoogleDriveProvider.tokenStorageKey);
        return;
      }
      this.accessToken = parsed.accessToken;
      this.tokenExpiresAt = parsed.expiresAt;
      this.account = parsed.account ?? null;
    } catch {
      // Corrupt cache, just start signed out.
    }
  }
}

/** Drop a token an old build left in localStorage. */
function removeOldToken() {
  try {
    localStorage.removeItem(OLD_TOKEN_KEY);
  } catch {
    // Nothing to do if storage is locked down.
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

function sessionExpiredError(status?: number): StorageError {
  return new StorageError('Drive: Session expired. Use File > Connect Google Drive to sign in again.', {
    retryable: false,
    status,
  });
}

/**
 * Pack a file's Drive version and checksum into one string, or undefined if Drive sent neither.
 * NOTE: Drive bumps version on any change, even a rename, so the checksum tells us if the bytes changed.
 */
function versionToken(item: Partial<DriveItem> | undefined): string | undefined {
  if (!item?.version && !item?.md5Checksum) return undefined;
  return `${item.version ?? ''}:${item.md5Checksum ?? ''}`;
}

/** Check if Drive still has the content we last saw, by version first, then by checksum. */
function sameContent(expected: string, remote: string | undefined): boolean {
  if (!remote || expected === remote) return true;
  const expectedMd5 = expected.split(':')[1];
  return Boolean(expectedMd5) && expectedMd5 === remote.split(':')[1];
}

/** Read a JSON body, or nothing if there isn't one. */
async function readJson(res: Response): Promise<Partial<DriveItem> | undefined> {
  try {
    return (await res.json()) as Partial<DriveItem>;
  } catch {
    return undefined;
  }
}

/**
 * Pull Google's error message and reason out of a failed response, if there are any.
 * Drive puts the reason in error.errors[0].reason, newer APIs put it in error.details[].reason.
 */
async function readGoogleError(res: Response): Promise<{ message: string; reason: string }> {
  try {
    const error = (await res.json())?.error;
    const message = typeof error?.message === 'string' ? error.message : '';
    const reasons = [...(Array.isArray(error?.errors) ? error.errors : []), ...(Array.isArray(error?.details) ? error.details : [])]
      .map((item: { reason?: unknown }) => item?.reason)
      .filter((value: unknown): value is string => typeof value === 'string');
    return { message, reason: reasons[0] ?? '' };
  } catch {
    return { message: '', reason: '' };
  }
}
