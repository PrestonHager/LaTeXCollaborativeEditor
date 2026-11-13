import type { ProjectListing, ProjectSummary, StorageProvider, WriteOptions } from '../storage/providers/types';
import { isInside, replacePrefix } from '../project/paths';
import { ConflictError } from '../storage/conflicts';

type MemoryProject = { name: string; mainPath: string | null; files: Map<string, Uint8Array | null>; versions: Map<string, number> };

/** A storage provider kept in memory, so tests can check exactly what a save wrote. */
export class MemoryProvider implements StorageProvider {
  readonly label = 'memory';
  readonly projects = new Map<string, MemoryProject>();
  readonly calls: string[] = [];
  private nextId = 0;

  async connect() {
    return true;
  }

  status() {
    return 'ok';
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return [...this.projects].map(([id, project]) => ({ id, name: project.name }));
  }

  async createProject(name: string): Promise<ProjectSummary> {
    const id = `p${(this.nextId += 1)}`;
    this.projects.set(id, { name, mainPath: null, files: new Map(), versions: new Map() });
    this.calls.push(`create ${name}`);
    return { id, name };
  }

  async openProject(projectId: string): Promise<ProjectListing> {
    const project = this.get(projectId);
    return {
      id: projectId,
      name: project.name,
      mainPath: project.mainPath,
      entries: [...project.files].map(([path, data]) => ({ path, kind: data ? 'file' : 'folder' })),
    };
  }

  async readFile(projectId: string, path: string) {
    const data = this.get(projectId).files.get(path);
    if (!data) throw new Error(`missing ${path}`);
    return data;
  }

  async writeFile(projectId: string, path: string, data: string | Uint8Array, options: WriteOptions = {}) {
    const project = this.get(projectId);
    // Act like Drive: refuse to overwrite a file that changed since the version the caller saw.
    const current = project.versions.get(path);
    if (current !== undefined && options.expectedVersion !== undefined && !options.force && options.expectedVersion !== String(current)) {
      this.calls.push(`conflict ${path}`);
      throw new ConflictError(path, String(current));
    }
    project.files.set(path, typeof data === 'string' ? new TextEncoder().encode(data) : data);
    project.versions.set(path, (current ?? 0) + 1);
    this.calls.push(`write ${path}`);
    return { version: String(current === undefined ? 1 : current + 1) };
  }

  fileVersion(projectId: string, path: string) {
    const version = this.get(projectId).versions.get(path);
    return version === undefined ? undefined : String(version);
  }

  /** Pretend someone changed a file outside the app, like in the Drive web UI. */
  editElsewhere(projectId: string, path: string, text: string) {
    const project = this.get(projectId);
    project.files.set(path, new TextEncoder().encode(text));
    project.versions.set(path, (project.versions.get(path) ?? 0) + 1);
  }

  async createFolder(projectId: string, path: string) {
    this.get(projectId).files.set(path, null);
    this.calls.push(`folder ${path}`);
  }

  async move(projectId: string, from: string, to: string) {
    const { files, versions } = this.get(projectId);
    for (const [path, data] of [...files]) {
      if (path !== from && !isInside(path, from)) continue;
      const version = versions.get(path);
      files.delete(path);
      versions.delete(path);
      files.set(replacePrefix(path, from, to), data);
      if (version !== undefined) versions.set(replacePrefix(path, from, to), version);
    }
    this.calls.push(`move ${from} ${to}`);
  }

  /** What remove() trashed, by token, like the Drive trash. Paths are relative to what was removed. */
  readonly trash = new Map<string, { projectId: string; items: [string, Uint8Array | null, number | undefined][] }>();
  /** Set to false to act like a provider without a trash (or after the trash is emptied). */
  restorable = true;

  async remove(projectId: string, path: string) {
    const { files, versions } = this.get(projectId);
    const items: [string, Uint8Array | null, number | undefined][] = [];
    for (const [key, data] of [...files]) {
      if (key !== path && !isInside(key, path)) continue;
      items.push([key.slice(path.length), data, versions.get(key)]);
      files.delete(key);
      versions.delete(key);
    }
    this.calls.push(`remove ${path}`);
    if (!items.length) return;
    const token = `t${(this.nextId += 1)}`;
    this.trash.set(token, { projectId, items });
    return token;
  }

  async restore(projectId: string, path: string, token: string) {
    const trashed = this.trash.get(token);
    const { files, versions } = this.get(projectId);
    if (!this.restorable || !trashed || trashed.projectId !== projectId || files.has(path)) return false;
    this.trash.delete(token);
    for (const [relative, data, version] of trashed.items) {
      files.set(path + relative, data);
      if (version !== undefined) versions.set(path + relative, version);
    }
    this.calls.push(`restore ${path}`);
    return true;
  }

  async renameProject(projectId: string, name: string) {
    this.get(projectId).name = name;
    this.calls.push(`rename ${name}`);
  }

  async setMainFile(projectId: string, path: string | null) {
    this.get(projectId).mainPath = path;
    this.calls.push(`main ${path}`);
  }

  text(projectId: string, path: string) {
    return new TextDecoder().decode(this.get(projectId).files.get(path)!);
  }

  private get(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`no project ${projectId}`);
    return project;
  }
}
