// A folder on this computer as a project, in the desktop app only (issue #178, docs/desktop.md,
// "Storage: local folders"). The folder holds the project's files as they are, the same layout as
// the .zip export (#73): no metadata file, so other editors, git and the zip all agree on it.
//
// File access goes through Tauri's fs plugin. Its capability (desktop/src-tauri/capabilities)
// allows no path at all on its own: a folder only becomes reachable when the person picks it in the
// native dialog, which adds it to the fs scope, and the persisted-scope plugin keeps that across
// restarts. This module loads lazily, behind isDesktopShell(), so the website never downloads it.
import type { ProjectListing, ProjectSummary, StorageProvider, StoredEntry, WriteOptions, WriteResult } from './types';
import { StorageError } from '../errors';
import { ConflictError } from '../conflicts';
import { MAX_FILE_BYTES } from '../../project/paths';

/** The file system calls this needs, so tests can pass a fake. Paths are absolute. */
export type FolderFs = {
  pickFolder(title: string): Promise<string | null>;
  readDir(path: string): Promise<{ name: string; isDirectory: boolean; isFile: boolean }[]>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** null when nothing is there. */
  stat(path: string): Promise<{ size: number; mtime: number | null; isDirectory: boolean } | null>;
  /** Calls back with the absolute paths that changed, a little after they did. */
  watch(path: string, onChange: (paths: string[]) => void): Promise<() => void>;
};

/** A project folder holds at most this many files, so picking a home folder by mistake fails fast. */
export const MAX_FOLDER_FILES = 5000;

/**
 * Left out when a folder opens: hidden files and folders (.git, .vscode), and what a TeX build
 * leaves behind. They stay on disk, and saving never touches them, since the project doesn't
 * know them.
 */
const BUILD_OUTPUT = /\.(aux|log|out|toc|lof|lot|fls|fdb_latexmk|synctex|synctex\.gz|synctex\(busy\)|bcf|run\.xml|blg|nav|snm|vrb|xdv)$/i;
export const skipped = (name: string) => name.startsWith('.') || name === 'node_modules' || BUILD_OUTPUT.test(name);

const encoder = new TextEncoder();

/** The main file and display name the person chose, kept in this app, not in the folder. */
type FolderMemory = { name?: string; mainPath?: string | null };
const MEMORY_KEY = 'latex_editor_folder_projects';

function readMemory(): Record<string, FolderMemory> {
  try {
    const parsed = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, FolderMemory>) : {};
  } catch {
    return {};
  }
}

function remember(root: string, change: FolderMemory) {
  try {
    const all = readMemory();
    all[root] = { ...all[root], ...change };
    localStorage.setItem(MEMORY_KEY, JSON.stringify(all));
  } catch {
    // Only the main file guess and the name are lost, and opening the folder guesses them again.
  }
}

/** The folder's own name, from an absolute path on any OS. */
export function folderName(root: string): string {
  return root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || root;
}

/** Join a project path ("figures/a.png") onto the folder, with the separator the folder uses. */
export function joinRoot(root: string, path: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const base = root.replace(/[\\/]+$/, '');
  return path ? `${base}${sep}${path.split('/').join(sep)}` : base;
}

/** The project path of an absolute path inside the folder, or null when it's outside. */
export function relativeTo(root: string, absolute: string): string | null {
  const norm = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '');
  const base = norm(root);
  const full = norm(absolute);
  if (!full.startsWith(`${base}/`)) return null;
  return full.slice(base.length + 1);
}

/** A file's version: its modified time and size. A change made outside the app changes it. */
const versionOf = (info: { size: number; mtime: number | null }) => `${info.mtime ?? 0}-${info.size}`;

/** Turn fs plugin errors into something a person can act on. */
function wrap(error: unknown, action: string): StorageError {
  if (error instanceof StorageError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  // The fs plugin refuses paths outside the folders picked in the dialog.
  const forbidden = /forbidden|not allowed|scope/i.test(detail);
  return new StorageError(
    forbidden
      ? `This app can no longer reach the project folder. Open it again with File > Open Project.`
      : `Could not ${action} in the project folder: ${detail}`,
    { retryable: !forbidden, cause: error },
  );
}

/**
 * Projects in folders on this computer. A project's id is the folder's absolute path. It never
 * leaves this device: guests only hear "computer folder" (ProjectState.currentStorageLabel).
 */
export class LocalFolderProvider implements StorageProvider {
  readonly label = 'the project folder';
  private readonly versions = new Map<string, string>();
  // Paths being written right now, so the watcher doesn't take our own writes for outside edits.
  private readonly writing = new Set<string>();

  private readonly fs: FolderFs;

  constructor(fs: FolderFs) {
    this.fs = fs;
  }

  async connect(): Promise<boolean> {
    return true;
  }

  status(): string {
    return 'Folder ready';
  }

  /** Ask for a folder in the system dialog. null when the person cancels. */
  async pickFolder(title = 'Open a project folder'): Promise<ProjectSummary | null> {
    const root = await this.fs.pickFolder(title);
    return root ? { id: root, name: readMemory()[root]?.name ?? folderName(root) } : null;
  }

  /** Folders open from the dialog, so there's no list to show. */
  async listProjects(): Promise<ProjectSummary[]> {
    return [];
  }

  async createProject(): Promise<ProjectSummary> {
    // saveProject only calls this without a project id, and folders always come from the dialog first.
    throw new StorageError('Pick a folder first, with Save to a Folder.', { retryable: false });
  }

  /** Whether the folder is still there and this app may still read it (after a restart, a move or a delete). */
  async reachable(root: string): Promise<boolean> {
    try {
      return Boolean((await this.fs.stat(root))?.isDirectory);
    } catch {
      return false;
    }
  }

  /** How many visible files and folders it holds, to warn before saving over them. */
  async countEntries(root: string): Promise<number> {
    try {
      return (await this.fs.readDir(root)).filter((entry) => !skipped(entry.name)).length;
    } catch (error) {
      throw wrap(error, 'list the files');
    }
  }

  async openProject(root: string): Promise<ProjectListing> {
    const entries: StoredEntry[] = [];
    const walk = async (dir: string) => {
      let items;
      try {
        items = await this.fs.readDir(joinRoot(root, dir));
      } catch (error) {
        throw wrap(error, 'list the files');
      }
      for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
        if (skipped(item.name)) continue;
        const path = dir ? `${dir}/${item.name}` : item.name;
        if (item.isDirectory) {
          entries.push({ path, kind: 'folder' });
          await walk(path);
        } else if (item.isFile) {
          entries.push({ path, kind: 'file' });
        }
        if (entries.length > MAX_FOLDER_FILES) {
          throw new StorageError(`That folder has more than ${MAX_FOLDER_FILES} files. Pick the folder that holds just the project.`, { retryable: false });
        }
      }
    };
    await walk('');
    const memory = readMemory()[root] ?? {};
    return { id: root, name: memory.name ?? folderName(root), mainPath: memory.mainPath ?? null, entries };
  }

  async readFile(root: string, path: string): Promise<Uint8Array> {
    const full = joinRoot(root, path);
    try {
      const info = await this.fs.stat(full);
      if (info && info.size > MAX_FILE_BYTES) {
        throw new StorageError(`${path} is too big to open (over ${Math.round(MAX_FILE_BYTES / 1024 ** 2)} MB).`, { retryable: false });
      }
      const data = await this.fs.readFile(full);
      if (info) this.versions.set(full, versionOf(info));
      return data;
    } catch (error) {
      throw wrap(error, `read ${path}`);
    }
  }

  fileVersion(root: string, path: string): string | undefined {
    return this.versions.get(joinRoot(root, path));
  }

  /** The version on disk now, or null when the file is gone. */
  async diskVersion(root: string, path: string): Promise<string | null> {
    try {
      const info = await this.fs.stat(joinRoot(root, path));
      return info && !info.isDirectory ? versionOf(info) : null;
    } catch {
      return null;
    }
  }

  /** Whether a version is one this app wrote or read, or a write is still running. */
  isOwnChange(root: string, path: string, version: string | null): boolean {
    const full = joinRoot(root, path);
    return this.writing.has(full) || (version !== null && this.versions.get(full) === version);
  }

  async writeFile(root: string, path: string, data: string | Uint8Array, options: WriteOptions = {}): Promise<WriteResult> {
    const full = joinRoot(root, path);
    this.writing.add(full);
    try {
      if (options.expectedVersion && !options.force) {
        const now = await this.fs.stat(full);
        // A file deleted outside the app is written again: the project still has it.
        if (now && versionOf(now) !== options.expectedVersion) throw new ConflictError(path, versionOf(now));
      }
      const slash = path.lastIndexOf('/');
      if (slash > 0) await this.fs.mkdir(joinRoot(root, path.slice(0, slash)));
      await this.fs.writeFile(full, typeof data === 'string' ? encoder.encode(data) : data);
      const info = await this.fs.stat(full);
      const version = info ? versionOf(info) : undefined;
      if (version) this.versions.set(full, version);
      return { version };
    } catch (error) {
      if (error instanceof ConflictError) throw error;
      throw wrap(error, `save ${path}`);
    } finally {
      this.writing.delete(full);
    }
  }

  async createFolder(root: string, path: string): Promise<void> {
    try {
      await this.fs.mkdir(joinRoot(root, path));
    } catch (error) {
      throw wrap(error, `make the folder ${path}`);
    }
  }

  async move(root: string, from: string, to: string): Promise<void> {
    try {
      const slash = to.lastIndexOf('/');
      if (slash > 0) await this.fs.mkdir(joinRoot(root, to.slice(0, slash)));
      await this.fs.rename(joinRoot(root, from), joinRoot(root, to));
    } catch (error) {
      throw wrap(error, `move ${from}`);
    }
    // Versions follow the files, so the watcher still knows them.
    const fromFull = joinRoot(root, from);
    const toFull = joinRoot(root, to);
    for (const [key, version] of [...this.versions]) {
      if (key === fromFull || key.startsWith(`${fromFull}/`) || key.startsWith(`${fromFull}\\`)) {
        this.versions.delete(key);
        this.versions.set(toFull + key.slice(fromFull.length), version);
      }
    }
  }

  /** Deletes for good: the fs plugin has no trash, so undo writes the files again (fileHistory.ts). */
  async remove(root: string, path: string): Promise<void> {
    try {
      await this.fs.remove(joinRoot(root, path));
    } catch (error) {
      // Already gone, like after a delete outside the app: that's what we wanted.
      if (!(await this.fs.stat(joinRoot(root, path)).catch(() => null))) return;
      throw wrap(error, `delete ${path}`);
    }
  }

  /** The project's name is the person's, kept in this app. The folder keeps its own name. */
  async renameProject(root: string, name: string): Promise<void> {
    remember(root, { name });
  }

  async setMainFile(root: string, path: string | null): Promise<void> {
    remember(root, { mainPath: path });
  }

  /** Watch the folder, and its subfolders, for changes. Resolves to a function that stops it. */
  watch(root: string, onChange: (paths: string[]) => void): Promise<() => void> {
    return this.fs.watch(root, onChange);
  }
}

/** The real file system, through Tauri's dialog and fs plugins. Loads with this chunk only. */
export async function tauriFolderFs(): Promise<FolderFs> {
  const [fs, dialog] = await Promise.all([import('@tauri-apps/plugin-fs'), import('@tauri-apps/plugin-dialog')]);
  return {
    // recursive: the dialog plugin adds the folder and everything under it to the fs scope.
    pickFolder: async (title) => {
      const picked = await dialog.open({ directory: true, recursive: true, multiple: false, title });
      return typeof picked === 'string' ? picked : null;
    },
    readDir: (path) => fs.readDir(path),
    readFile: (path) => fs.readFile(path),
    writeFile: (path, data) => fs.writeFile(path, data),
    mkdir: (path) => fs.mkdir(path, { recursive: true }),
    remove: (path) => fs.remove(path, { recursive: true }),
    rename: (from, to) => fs.rename(from, to),
    stat: async (path) => {
      if (!(await fs.exists(path))) return null;
      const info = await fs.stat(path);
      return { size: info.size, mtime: info.mtime ? info.mtime.getTime() : null, isDirectory: info.isDirectory };
    },
    watch: (path, onChange) => fs.watch(path, (event) => onChange(event.paths), { recursive: true, delayMs: 400 }),
  };
}
