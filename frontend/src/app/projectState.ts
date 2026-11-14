import { createDocumentId, type AppSessionState, type ProviderMode } from '../state/appSession';
import type { FileConflict } from '../storage/conflicts';
import type { SavedManifest } from '../storage/projectSaver';
import type { StorageProvider } from '../storage/providers/types';

/** The bits of the Drive provider this needs, so tests can pass a fake. */
export type DriveLike = StorageProvider & {
  hasUsableToken(): boolean;
  /** Connected on an earlier visit and not logged out (#201), so a silent sign-in is worth a try. */
  wasConnected?(): boolean;
  legacyProjectId(documentId: string | undefined, fileName: string): string | null;
};

export const toTexName = (name: string) => (name.endsWith('.tex') ? name : `${name}.tex`);

/**
 * Where the open project saves: the provider, the stored project id (the Drive folder when on
 * Drive), what the last save wrote, the files held by conflicts, and whether saving is paused.
 */
export class ProjectState {
  activeProvider: StorageProvider;
  // The stored project we save to, or null until the first save makes one.
  projectId: string | null = null;
  // What the last save wrote, so the next one only sends changes.
  manifest: SavedManifest | null = null;
  // Files that changed in storage under us, by file id. Saves skip them until the person picks a copy.
  readonly conflicts = new Map<string, FileConflict>();
  // Files the person chose to overwrite anyway.
  readonly overwrite = new Set<string>();
  // Only used to match an old single-file Drive link from before projects.
  documentId = createDocumentId();
  savingPaused = false;
  readonly driveProvider: DriveLike;
  // The Drive project the last session saved to, while a silent sign-in runs on load (#201). Saves go
  // nowhere meanwhile: main.ts turns autosave on after resumeDrive.
  private pendingDrive: { projectId: string | null; manifest: SavedManifest | null } | null = null;

  constructor(localProvider: StorageProvider, driveProvider: DriveLike) {
    this.activeProvider = localProvider;
    this.driveProvider = driveProvider;
  }

  isDrive() {
    return this.activeProvider === this.driveProvider;
  }

  getProviderMode(): ProviderMode {
    return this.isDrive() ? 'drive' : 'local';
  }

  // Tell guests where the host is actually saving, instead of always saying local storage.
  currentStorageLabel() {
    return this.isDrive() ? 'Saved on host Google Drive' : 'Saved on host local storage';
  }

  /** Pick up a saved session. Returns a status message when it was on Drive. */
  restore(restored: AppSessionState): string | null {
    let driveRestoreMessage: string | null = null;
    if (restored.documentId) this.documentId = restored.documentId;
    // The saved flag kept its old name, so false there means saving is paused.
    this.savingPaused = !restored.saveNowEnabled;
    this.projectId = restored.projectId ?? null;
    this.manifest = restored.manifest ?? null;
    if (restored.providerMode === 'drive') {
      // Only reuse Drive when the cached token is still good. Calling connect() here would open
      // a sign-in popup on page load, which browsers block, and saves would silently fail.
      if (this.driveProvider.hasUsableToken()) {
        this.activeProvider = this.driveProvider;
        driveRestoreMessage = 'Drive: Session restored';
        // Sessions from before projects saved to one Drive file, so keep saving there.
        if (!this.projectId) this.projectId = this.driveProvider.legacyProjectId(restored.documentId, toTexName(restored.documentName));
      } else if (this.driveProvider.wasConnected?.()) {
        // Drive was connected on an earlier visit, so main.ts tries a silent sign-in and then calls
        // resumeDrive. Only if that fails is the person asked to connect.
        this.pendingDrive = {
          projectId: this.projectId ?? this.driveProvider.legacyProjectId(restored.documentId, toTexName(restored.documentName)),
          manifest: this.manifest,
        };
        this.projectId = null;
        this.manifest = null;
      } else {
        // Nothing remembers Drive (never connected here, or logged out), so ask.
        driveRestoreMessage = 'Drive needs you to reconnect; saving locally. Use File > Connect Google Drive.';
        this.projectId = null;
        this.manifest = null;
      }
    }
    return driveRestoreMessage;
  }

  /** Whether a silent Drive sign-in should run before saving starts. */
  awaitingDrive() {
    return this.pendingDrive !== null;
  }

  /**
   * Finish what restore started once the silent sign-in is done. Signed in: saving goes back to the
   * Drive project, unless the person has moved on. Not: it stays in this browser, and the message
   * says the sign-in expired (not that anything broke).
   */
  resumeDrive(signedIn: boolean): string | null {
    const pending = this.pendingDrive;
    this.pendingDrive = null;
    if (!pending) return null;
    if (!signedIn) return 'Google Drive sign-in expired, so edits save in this browser. Use File > Connect Google Drive to sign in again.';
    if (this.isDrive() || this.projectId !== null) return null;
    this.activeProvider = this.driveProvider;
    this.projectId = pending.projectId;
    this.manifest = pending.manifest;
    return 'Drive: Session restored';
  }

  /** Point saves at a provider and project. Pass a manifest when the project was just loaded from it. */
  use(provider: StorageProvider, id: string | null, loaded: SavedManifest | null = null) {
    this.activeProvider = provider;
    this.projectId = id;
    this.manifest = loaded;
    this.pendingDrive = null;
    this.conflicts.clear();
    this.overwrite.clear();
  }

  /** Keep what a save wrote, unless the project moved to another provider while it ran. */
  recordSave(provider: StorageProvider, saved: SavedManifest): boolean {
    if (provider !== this.activeProvider) return false;
    this.manifest = saved;
    this.projectId = saved.projectId;
    return true;
  }

  /** The fields of the app session this owns. */
  sessionFields() {
    // While the silent sign-in runs, keep the Drive project, so a tab closed meanwhile still finds it.
    const pending = this.pendingDrive;
    return {
      documentId: this.documentId,
      providerMode: pending ? 'drive' : this.getProviderMode(),
      saveNowEnabled: !this.savingPaused,
      projectId: (pending ? pending.projectId : this.projectId) ?? undefined,
      manifest: (pending ? pending.manifest : this.manifest) ?? undefined,
    };
  }
}
