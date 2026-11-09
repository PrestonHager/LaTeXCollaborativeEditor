import type { ProjectListing, ProjectSummary, StorageProvider } from './types';
import { StorageError, isQuotaError } from '../errors';
import { FILES_STORE, PROJECTS_STORE, requestToPromise, withTransaction } from '../idb';
import { isInside, normalizePath, replacePrefix } from '../../project/paths';

// Where single documents lived before projects. They get moved into IndexedDB on first use.
export const LEGACY_STORAGE_KEY = 'latex_editor_docs';

type ProjectRow = { id: string; name: string; mainPath: string | null; updatedAt: number; legacyFileName?: string };
type FileRow = { projectId: string; path: string; kind: 'file' | 'folder'; data?: Uint8Array };

const encoder = new TextEncoder();

function newProjectId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Turn IndexedDB failures into messages a person can act on. */
function wrapError(error: unknown, action: string): StorageError {
  if (error instanceof StorageError) return error;
  if (isQuotaError(error)) {
    return new StorageError('Browser storage is full. Download a .zip copy, then delete old local projects.', {
      retryable: false,
      cause: error,
    });
  }
  return new StorageError(`Could not ${action} in browser storage. Private browsing or site settings may be blocking it.`, {
    retryable: false,
    cause: error,
  });
}

/** Read the old localStorage docs, skipping anything that isn't a string. */
function readLegacyDocs(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

/** Projects saved in this browser, in IndexedDB. */
export class LocalAppStorageProvider implements StorageProvider {
  readonly label = 'this browser';
  private currentStatus = 'Local storage ready';
  private migration: Promise<void> | null = null;

  async connect(): Promise<boolean> {
    await this.migrateLegacyDocs();
    this.currentStatus = 'Local storage connected';
    return true;
  }

  status(): string {
    return this.currentStatus;
  }

  /**
   * Move every single document from localStorage into its own one-file project.
   * The old key is only removed once all of them are written.
   */
  migrateLegacyDocs(): Promise<void> {
    if (!this.migration) {
      this.migration = (async () => {
        const docs = readLegacyDocs();
        const names = Object.keys(docs);
        if (!names.length) return;
        await withTransaction([PROJECTS_STORE, FILES_STORE], 'readwrite', (tx) => {
          for (const fileName of names) {
            const id = newProjectId();
            const path = normalizePath(fileName) ?? 'main.tex';
            const row: ProjectRow = {
              id,
              name: fileName.replace(/\.tex$/, ''),
              mainPath: path,
              updatedAt: Date.now(),
              legacyFileName: fileName,
            };
            tx.objectStore(PROJECTS_STORE).put(row);
            tx.objectStore(FILES_STORE).put({ projectId: id, path, kind: 'file', data: encoder.encode(docs[fileName]) } satisfies FileRow);
          }
        });
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      })().catch((error) => {
        this.migration = null;
        throw wrapError(error, 'move old documents into projects');
      });
    }
    return this.migration;
  }

  /** Find the project an old single document was moved into, by its old file name. */
  async findLegacyProject(fileName: string): Promise<string | null> {
    await this.migrateLegacyDocs();
    const projects = await this.allProjects();
    return projects.find((project) => project.legacyFileName === fileName)?.id ?? null;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    await this.migrateLegacyDocs();
    const projects = await this.allProjects();
    return projects
      .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  async createProject(name: string): Promise<ProjectSummary> {
    const row: ProjectRow = { id: newProjectId(), name, mainPath: null, updatedAt: Date.now() };
    try {
      await withTransaction([PROJECTS_STORE], 'readwrite', (tx) => {
        tx.objectStore(PROJECTS_STORE).put(row);
      });
    } catch (error) {
      throw wrapError(error, 'create the project');
    }
    this.currentStatus = `Created local project: ${name}`;
    return { id: row.id, name, updatedAt: row.updatedAt };
  }

  async openProject(projectId: string): Promise<ProjectListing> {
    try {
      return await withTransaction([PROJECTS_STORE, FILES_STORE], 'readonly', async (tx) => {
        const project = await requestToPromise(tx.objectStore(PROJECTS_STORE).get(projectId) as IDBRequest<ProjectRow | undefined>);
        if (!project) throw new StorageError('That local project no longer exists.', { retryable: false });
        const files = await requestToPromise(
          tx.objectStore(FILES_STORE).index('byProject').getAll(projectId) as IDBRequest<FileRow[]>,
        );
        return {
          id: project.id,
          name: project.name,
          mainPath: project.mainPath,
          entries: files.map((file) => ({ path: file.path, kind: file.kind })).sort((a, b) => a.path.localeCompare(b.path)),
        };
      });
    } catch (error) {
      throw wrapError(error, 'open the project');
    }
  }

  async readFile(projectId: string, path: string): Promise<Uint8Array> {
    const row = await withTransaction([FILES_STORE], 'readonly', (tx) =>
      requestToPromise(tx.objectStore(FILES_STORE).get([projectId, path]) as IDBRequest<FileRow | undefined>),
    ).catch((error) => {
      throw wrapError(error, 'read a file');
    });
    if (!row || row.kind !== 'file') throw new StorageError(`${path} was not found in this project.`, { retryable: false });
    return new Uint8Array(row.data ?? new Uint8Array());
  }

  async writeFile(projectId: string, path: string, data: string | Uint8Array): Promise<void> {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    await this.update(projectId, 'save a file', (files) => {
      files.put({ projectId, path, kind: 'file', data: bytes } satisfies FileRow);
    });
    this.currentStatus = `Saved locally: ${path}`;
  }

  async createFolder(projectId: string, path: string): Promise<void> {
    await this.update(projectId, 'create a folder', (files) => {
      files.put({ projectId, path, kind: 'folder' } satisfies FileRow);
    });
  }

  async move(projectId: string, from: string, to: string): Promise<void> {
    await this.update(projectId, 'move a file', async (files, project) => {
      const rows = await requestToPromise(files.index('byProject').getAll(projectId) as IDBRequest<FileRow[]>);
      for (const row of rows) {
        if (row.path !== from && !isInside(row.path, from)) continue;
        files.delete([projectId, row.path]);
        files.put({ ...row, path: replacePrefix(row.path, from, to) });
      }
      if (project.mainPath) project.mainPath = replacePrefix(project.mainPath, from, to);
    });
  }

  async remove(projectId: string, path: string): Promise<void> {
    await this.update(projectId, 'delete a file', async (files) => {
      const rows = await requestToPromise(files.index('byProject').getAll(projectId) as IDBRequest<FileRow[]>);
      for (const row of rows) {
        if (row.path === path || isInside(row.path, path)) files.delete([projectId, row.path]);
      }
    });
  }

  async renameProject(projectId: string, name: string): Promise<void> {
    await this.update(projectId, 'rename the project', (_files, project) => {
      project.name = name;
    });
    this.currentStatus = `Renamed locally: ${name}`;
  }

  async setMainFile(projectId: string, path: string | null): Promise<void> {
    await this.update(projectId, 'set the main file', (_files, project) => {
      project.mainPath = path;
    });
  }

  /** Delete every local project. */
  async clear(): Promise<void> {
    try {
      await withTransaction([PROJECTS_STORE, FILES_STORE], 'readwrite', (tx) => {
        tx.objectStore(PROJECTS_STORE).clear();
        tx.objectStore(FILES_STORE).clear();
      });
    } catch (error) {
      throw wrapError(error, 'clear local projects');
    }
    this.currentStatus = 'Local projects cleared';
  }

  private allProjects(): Promise<ProjectRow[]> {
    return withTransaction([PROJECTS_STORE], 'readonly', (tx) =>
      requestToPromise(tx.objectStore(PROJECTS_STORE).getAll() as IDBRequest<ProjectRow[]>),
    ).catch((error) => {
      throw wrapError(error, 'list projects');
    });
  }

  /** Change files in one transaction and bump the project's updatedAt with it. */
  private async update(
    projectId: string,
    action: string,
    work: (files: IDBObjectStore, project: ProjectRow) => void | Promise<void>,
  ): Promise<void> {
    try {
      await withTransaction([PROJECTS_STORE, FILES_STORE], 'readwrite', async (tx) => {
        const projects = tx.objectStore(PROJECTS_STORE);
        const project = await requestToPromise(projects.get(projectId) as IDBRequest<ProjectRow | undefined>);
        if (!project) throw new StorageError('That local project no longer exists.', { retryable: false });
        await work(tx.objectStore(FILES_STORE), project);
        project.updatedAt = Date.now();
        projects.put(project);
      });
    } catch (error) {
      throw wrapError(error, action);
    }
  }
}
