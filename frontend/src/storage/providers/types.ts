export type ProjectSummary = { id: string; name: string; updatedAt?: number };

/** A file or folder as storage sees it. Paths are relative to the project root and use "/". */
export type StoredEntry = { path: string; kind: 'file' | 'folder' };

export type ProjectListing = {
  id: string;
  name: string;
  /** The main file, if storage remembers one. */
  mainPath?: string | null;
  entries: StoredEntry[];
};

/**
 * Where projects get saved. A project is a folder of files, so a new provider (Dropbox, a local
 * folder, and so on) only has to map these calls onto its own folders.
 * Folders a file needs are made by writeFile, so createFolder is only for empty ones.
 */
export interface StorageProvider {
  /** Short name shown in status messages, like "Google Drive". */
  readonly label: string;
  connect(): Promise<boolean>;
  status(): string;
  listProjects(): Promise<ProjectSummary[]>;
  createProject(name: string): Promise<ProjectSummary>;
  openProject(projectId: string): Promise<ProjectListing>;
  readFile(projectId: string, path: string): Promise<Uint8Array>;
  writeFile(projectId: string, path: string, data: string | Uint8Array): Promise<void>;
  createFolder(projectId: string, path: string): Promise<void>;
  /** Rename or move a file or folder. Moving a folder takes everything in it along. */
  move(projectId: string, from: string, to: string): Promise<void>;
  /** Delete a file or folder. Providers with a trash should use it. */
  remove(projectId: string, path: string): Promise<void>;
  renameProject(projectId: string, name: string): Promise<void>;
  setMainFile(projectId: string, path: string | null): Promise<void>;
  /**
   * The id to use from now on. A provider can change a project's id while saving,
   * like Drive turning an old single file into a project folder.
   */
  currentProjectId?(projectId: string): string;
}
