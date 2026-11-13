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

export type WriteOptions = {
  /**
   * The file version from our last load or save. If storage has a different one now, writeFile
   * throws a ConflictError instead of overwriting.
   */
  expectedVersion?: string;
  /** Overwrite even if the file changed, after the person picked "keep mine". */
  force?: boolean;
};

/** What a write left behind. Providers that don't track versions can leave it out. */
export type WriteResult = { version?: string } | void;

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
  writeFile(projectId: string, path: string, data: string | Uint8Array, options?: WriteOptions): Promise<WriteResult>;
  /** The version of a file as of the last load or save, if the provider tracks them. */
  fileVersion?(projectId: string, path: string): string | undefined;
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
