// Google Drive storage, with the provider itself (googleDrive.ts: sign-in and the Drive API) as a
// lazy chunk (issue #231). Most people never use Drive, so it isn't in the initial load. This
// stand-in answers the questions the app asks at startup from what's in storage, and loads the real
// provider on the first call that talks to Google. main.ts preloads it when the browser is idle and
// when the pointer reaches the File menu, and right away when this tab is already signed in.
//
// If the chunk can't load (offline, or a deploy removed it), connect() returns false with a status
// that says so, and the other calls reject with a StorageError, which the callers already show.
import type { GoogleDriveProvider } from './googleDrive';
import type { ProjectListing, ProjectSummary, StorageProvider, WriteOptions, WriteResult } from './types';
import { StorageError } from '../errors';
import { lazyModule, OfflineError, type LazyModule } from '../../app/lazy';
import { forgetLegacyFile, legacyProjectId, readStoredToken, removeOldToken, TOKEN_EXPIRY_SLACK_MS, TOKEN_STORAGE_KEY } from './driveShared';

type Loader = () => Promise<{ GoogleDriveProvider: new () => GoogleDriveProvider }>;

const loadFailedMessage = (error: unknown) =>
  error instanceof OfflineError
    ? "Drive: You're offline. Google Drive will work once you're back online."
    : "Drive: Google Drive couldn't load. Check your connection, then reload the page.";

export class LazyGoogleDriveProvider implements StorageProvider {
  readonly label = 'Google Drive';
  private readonly provider: LazyModule<GoogleDriveProvider>;
  private sessionLostHandler: (() => void) | null = null;
  // Set when the real provider couldn't load, so status() can say why.
  private loadStatus: string | null = null;

  constructor(load: Loader = () => import('./googleDrive'), isOnline?: () => boolean) {
    removeOldToken();
    this.provider = lazyModule(
      () =>
        load().then(({ GoogleDriveProvider }) => {
          const provider = new GoogleDriveProvider();
          if (this.sessionLostHandler) provider.onSessionLost(this.sessionLostHandler);
          this.loadStatus = null;
          return provider;
        }),
      isOnline,
    );
  }

  /** Start loading the real provider without waiting. */
  preload() {
    this.provider.preload();
  }

  /** The real provider, or a StorageError saying why it didn't load. */
  private async get(): Promise<GoogleDriveProvider> {
    try {
      return await this.provider.get();
    } catch (error) {
      this.loadStatus = loadFailedMessage(error);
      throw new StorageError(this.loadStatus, { cause: error });
    }
  }

  private loaded() {
    return this.provider.current();
  }

  status() {
    return this.loaded()?.status() ?? this.loadStatus ?? 'Autosave Off';
  }

  getAccessToken() {
    const provider = this.loaded();
    return provider ? provider.getAccessToken() : (readStoredToken()?.accessToken ?? '');
  }

  hasUsableToken(): boolean {
    const provider = this.loaded();
    if (provider) return provider.hasUsableToken();
    const stored = readStoredToken();
    return Boolean(stored && stored.expiresAt - TOKEN_EXPIRY_SLACK_MS > Date.now());
  }

  isSignedIn(): boolean {
    return this.loaded()?.isSignedIn() ?? Boolean(readStoredToken());
  }

  onSessionLost(handler: () => void) {
    this.sessionLostHandler = handler;
    this.loaded()?.onSessionLost(handler);
  }

  legacyProjectId(documentId: string | undefined, fileName: string): string | null {
    return legacyProjectId(documentId, fileName);
  }

  forgetLegacyFile() {
    forgetLegacyFile();
  }

  accountLabel(): string | null {
    const provider = this.loaded();
    return provider ? provider.accountLabel() : (readStoredToken()?.account ?? null);
  }

  async loadAccount(): Promise<string | null> {
    if (!this.hasUsableToken()) return null;
    try {
      return await (await this.get()).loadAccount();
    } catch {
      // Best effort, like the provider's own lookup.
      return null;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.loaded() && !readStoredToken()) {
      // Never signed in this tab, so there's nothing to revoke.
      forgetLegacyFile();
      this.loadStatus = 'Drive: Disconnected';
      return;
    }
    try {
      await (await this.get()).disconnect();
    } catch {
      // Without the provider the token can't be revoked, but this tab still forgets it.
      try {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      } catch {
        // Nothing else to do if storage is locked down.
      }
      forgetLegacyFile();
      this.loadStatus = 'Drive: Disconnected';
    }
  }

  currentProjectId(projectId: string): string {
    return this.loaded()?.currentProjectId(projectId) ?? projectId;
  }

  async connect(): Promise<boolean> {
    try {
      return await (await this.get()).connect();
    } catch {
      return false;
    }
  }

  fileVersion(projectId: string, path: string): string | undefined {
    return this.loaded()?.fileVersion(projectId, path);
  }

  pathOfDriveId(projectId: string, driveId: string): string | undefined {
    return this.loaded()?.pathOfDriveId(projectId, driveId);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return (await this.get()).listProjects();
  }

  async createProject(name: string): Promise<ProjectSummary> {
    return (await this.get()).createProject(name);
  }

  async openProject(projectId: string): Promise<ProjectListing> {
    return (await this.get()).openProject(projectId);
  }

  async readFile(projectId: string, path: string): Promise<Uint8Array> {
    return (await this.get()).readFile(projectId, path);
  }

  async writeFile(projectId: string, path: string, data: string | Uint8Array, options?: WriteOptions): Promise<WriteResult> {
    return (await this.get()).writeFile(projectId, path, data, options);
  }

  async createFolder(projectId: string, path: string): Promise<void> {
    return (await this.get()).createFolder(projectId, path);
  }

  async move(projectId: string, from: string, to: string): Promise<void> {
    return (await this.get()).move(projectId, from, to);
  }

  async remove(projectId: string, path: string): Promise<string | void> {
    return (await this.get()).remove(projectId, path);
  }

  async restore(projectId: string, path: string, token: string): Promise<boolean> {
    return (await this.get()).restore(projectId, path, token);
  }

  async renameProject(projectId: string, name: string): Promise<void> {
    return (await this.get()).renameProject(projectId, name);
  }

  async setMainFile(projectId: string, path: string | null): Promise<void> {
    return (await this.get()).setMainFile(projectId, path);
  }

  async moveProject(projectId: string, targetFolderId: string): Promise<void> {
    return (await this.get()).moveProject(projectId, targetFolderId);
  }

  async projectFolderId(projectId: string): Promise<string | null> {
    return (await this.get()).projectFolderId(projectId);
  }

  async driveFetch(url: string, init: RequestInit, action: string): Promise<Response> {
    return (await this.get()).driveFetch(url, init, action);
  }
}
