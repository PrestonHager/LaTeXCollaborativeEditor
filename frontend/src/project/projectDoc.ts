import * as Y from 'yjs';
import { basename, dirname, guessMainFile, isInside, isSafePath, normalizePath, replacePrefix, uniquePath } from './paths';

export type EntryKind = 'text' | 'binary' | 'folder';

/** One file or folder in the project. Binary files only carry a content hash, the bytes travel separately. */
export type ProjectEntry = { id: string; path: string; kind: EntryKind; hash?: string; size?: number };

/** A whole project as plain data, for loading from storage or a zip. */
export type ProjectContent = {
  name: string;
  mainPath?: string | null;
  files: { path: string; kind: EntryKind; text?: string; hash?: string; size?: number }[];
};

type StoredEntry = Omit<ProjectEntry, 'id'>;

// Single-document rooms kept their text under this name, so the migrated main file reuses it.
export const LEGACY_TEXT_ID = 'doc';
// File ops use their own origin, so the editor's undo stack never picks them up.
export const PROJECT_ORIGIN = 'project';
/** Longest project name we show, in characters. */
export const MAX_PROJECT_NAME_LENGTH = 200;
const ENTRY_KINDS: readonly unknown[] = ['text', 'binary', 'folder'];

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The shared project inside a Yjs doc.
 * - `files` maps a stable file id to its path and kind, so a rename is one write to one key.
 * - Each text file has its own top-level Y.Text named `file:<id>`.
 * - `meta` holds the project name and the main file id.
 */
export class ProjectDoc {
  readonly doc: Y.Doc;
  private readonly files: Y.Map<StoredEntry>;
  private readonly meta: Y.Map<string>;

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.files = doc.getMap<StoredEntry>('files');
    this.meta = doc.getMap<string>('meta');
  }

  getText(id: string): Y.Text {
    return this.doc.getText(id === LEGACY_TEXT_ID ? LEGACY_TEXT_ID : `file:${id}`);
  }

  /**
   * Every entry, sorted by path.
   * Two peers can make the same path at once, so later ids (by sort order) get a " (2)" style name.
   * Every peer picks the same names, since it only depends on the shared state.
   * Entries a peer wrote with a bad path or kind (like "../x" or "/etc/x") are skipped.
   */
  entries(): ProjectEntry[] {
    const raw = [...this.files.entries()]
      .filter(([, value]) => value && isSafePath(value.path) && ENTRY_KINDS.includes(value.kind))
      .map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => a.path.localeCompare(b.path) || a.id.localeCompare(b.id));
    const taken = new Set<string>();
    return raw
      .map((entry) => {
        const path = uniquePath(entry.path, taken);
        taken.add(path);
        return path === entry.path ? entry : { ...entry, path };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Every folder path, both the ones made on purpose and the ones implied by file paths. */
  folderPaths(): string[] {
    const folders = new Set<string>();
    for (const entry of this.entries()) {
      if (entry.kind === 'folder') folders.add(entry.path);
      for (let dir = dirname(entry.path); dir; dir = dirname(dir)) folders.add(dir);
    }
    return [...folders].sort();
  }

  get(id: string): ProjectEntry | undefined {
    return this.entries().find((entry) => entry.id === id);
  }

  findByPath(path: string): ProjectEntry | undefined {
    return this.entries().find((entry) => entry.path === path);
  }

  isEmpty() {
    return this.files.size === 0;
  }

  getName(): string {
    // A peer can write any name, so cut it down to size.
    const name = this.meta.get('name');
    return typeof name === 'string' ? name.slice(0, MAX_PROJECT_NAME_LENGTH) : '';
  }

  setName(name: string) {
    this.doc.transact(() => this.meta.set('name', name), PROJECT_ORIGIN);
  }

  /** The main file id: the one picked, or else a best guess from the .tex files. */
  getMainFileId(): string | null {
    const picked = this.meta.get('main');
    const entries = this.entries();
    if (picked && entries.some((entry) => entry.id === picked && entry.kind === 'text')) return picked;
    const files = entries.filter((entry) => entry.kind === 'text').map((entry) => ({ path: entry.path, text: this.getText(entry.id).toString(), id: entry.id }));
    const guess = guessMainFile(files);
    return files.find((file) => file.path === guess)?.id ?? null;
  }

  setMainFile(id: string) {
    this.doc.transact(() => this.meta.set('main', id), PROJECT_ORIGIN);
  }

  createTextFile(rawPath: string, content = ''): string {
    const path = this.freePath(rawPath);
    const id = newId();
    this.doc.transact(() => {
      this.files.set(id, { path, kind: 'text' });
      if (content) this.getText(id).insert(0, content);
    }, PROJECT_ORIGIN);
    return id;
  }

  /** Add a binary file, or point an existing binary file at new content. */
  putBinaryFile(rawPath: string, hash: string, size: number): string {
    const path = normalizePath(rawPath);
    if (!path) throw new Error('That file name is not allowed.');
    const existing = this.findByPath(path);
    if (existing && existing.kind === 'binary') {
      this.doc.transact(() => this.files.set(existing.id, { path, kind: 'binary', hash, size }), PROJECT_ORIGIN);
      return existing.id;
    }
    const free = this.freePath(path);
    const id = newId();
    this.doc.transact(() => this.files.set(id, { path: free, kind: 'binary', hash, size }), PROJECT_ORIGIN);
    return id;
  }

  createFolder(rawPath: string): string {
    const path = this.freePath(rawPath);
    const id = newId();
    this.doc.transact(() => this.files.set(id, { path, kind: 'folder' }), PROJECT_ORIGIN);
    return id;
  }

  /**
   * Rename or move a file or folder. Moving a folder moves everything in it.
   * Implicit folders (no entry of their own) can be moved by path with movePath.
   */
  move(id: string, rawPath: string) {
    const entry = this.get(id);
    if (!entry) throw new Error('That file no longer exists.');
    this.movePath(entry.path, rawPath);
  }

  movePath(from: string, rawPath: string) {
    const to = normalizePath(rawPath);
    if (!to) throw new Error('That name is not allowed.');
    if (to === from) return;
    if (isInside(to, from)) throw new Error('A folder cannot be moved inside itself.');
    if (this.hasPath(to)) throw new Error(`${to} already exists.`);
    const affected = this.entries().filter((entry) => entry.path === from || isInside(entry.path, from));
    if (!affected.length) throw new Error('That file no longer exists.');
    this.doc.transact(() => {
      for (const entry of affected) {
        const { id, ...value } = entry;
        this.files.set(id, { ...value, path: replacePrefix(entry.path, from, to) });
      }
    }, PROJECT_ORIGIN);
  }

  /** Delete a file, or a folder and everything in it. Works on implicit folders by path too. */
  removePath(path: string) {
    const affected = this.entries().filter((entry) => entry.path === path || isInside(entry.path, path));
    this.doc.transact(() => {
      for (const entry of affected) {
        this.files.delete(entry.id);
        // Clear the text so deleted files don't keep their content in every snapshot.
        if (entry.kind === 'text') {
          const text = this.getText(entry.id);
          if (text.length) text.delete(0, text.length);
        }
      }
    }, PROJECT_ORIGIN);
  }

  /** Swap the whole project for new content in one change, so peers follow along. */
  replaceAll(content: ProjectContent) {
    this.doc.transact(() => {
      for (const entry of this.entries()) {
        if (entry.kind === 'text') {
          const text = this.getText(entry.id);
          if (text.length) text.delete(0, text.length);
        }
      }
      this.files.clear();
      this.meta.clear();
      this.meta.set('name', content.name);
      const taken = new Set<string>();
      let mainId: string | null = null;
      for (const file of content.files) {
        const normalized = normalizePath(file.path);
        if (!normalized || taken.has(normalized)) continue;
        taken.add(normalized);
        const id = newId();
        if (file.kind === 'text') {
          this.files.set(id, { path: normalized, kind: 'text' });
          if (file.text) this.getText(id).insert(0, file.text);
          if (normalized === content.mainPath) mainId = id;
        } else if (file.kind === 'binary') {
          this.files.set(id, { path: normalized, kind: 'binary', hash: file.hash, size: file.size });
        } else {
          this.files.set(id, { path: normalized, kind: 'folder' });
        }
      }
      if (mainId) this.meta.set('main', mainId);
    }, PROJECT_ORIGIN);
  }

  /**
   * Turn a doc from before projects (one Y.Text called "doc") into a one-file project.
   * Only the host does this, so peers never make two copies.
   */
  migrateLegacy(fileName: string, projectName: string) {
    if (!this.isEmpty()) return false;
    const path = normalizePath(fileName) ?? 'main.tex';
    this.doc.transact(() => {
      this.files.set(LEGACY_TEXT_ID, { path, kind: 'text' });
      this.meta.set('main', LEGACY_TEXT_ID);
      if (!this.meta.get('name')) this.meta.set('name', projectName);
    }, PROJECT_ORIGIN);
    return true;
  }

  /** Text of every text file by path, for compiling and zipping. */
  textFiles(): Map<string, string> {
    const out = new Map<string, string>();
    for (const entry of this.entries()) {
      if (entry.kind === 'text') out.set(entry.path, this.getText(entry.id).toString());
    }
    return out;
  }

  /**
   * Run the callback on any change to the file tree or project info, local or remote.
   * It runs once the change is done, not inside it. Otherwise binding the editor to a new file
   * from here lets y-codemirror replay that same change on top, and the text shows up twice.
   */
  onTreeChange(callback: () => void) {
    let queued = false;
    const handler = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        callback();
      });
    };
    this.files.observe(handler);
    this.meta.observe(handler);
    return () => {
      this.files.unobserve(handler);
      this.meta.unobserve(handler);
    };
  }

  /** Check if a file or folder (even one only implied by a file in it) is already at this path. */
  hasPath(path: string): boolean {
    return Boolean(this.findByPath(path)) || this.folderPaths().includes(path);
  }

  private freePath(rawPath: string): string {
    const path = normalizePath(rawPath);
    if (!path) throw new Error('That file name is not allowed.');
    if (this.hasPath(path)) throw new Error(`${basename(path)} already exists here.`);
    return path;
  }
}

