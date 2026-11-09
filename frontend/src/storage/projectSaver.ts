import type { StorageProvider } from './providers/types';
import type { ProjectDoc } from '../project/projectDoc';
import type { BlobStore } from '../project/blobStore';
import { isInside, replacePrefix } from '../project/paths';
import { ConflictError, type FileConflict } from './conflicts';

/**
 * What we last wrote to storage, so the next save only sends what changed.
 * version is the storage's own file version from that load or save, if it has one.
 */
export type SavedManifest = {
  projectId: string;
  name: string;
  mainPath: string | null;
  files: Record<string, { path: string; kind: 'text' | 'binary' | 'folder'; rev: string; version?: string }>;
};

export type SaveResult = {
  manifest: SavedManifest;
  /** Binary files we couldn't write yet because their bytes haven't arrived from a peer. */
  pending: number;
  /** Files we didn't write because they changed in storage since we last saw them. */
  conflicts: FileConflict[];
};

/** A quick fingerprint of some text, so we can tell if a file changed since the last save. */
export function textRev(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return `${hash.toString(16)}-${text.length}`;
}

const depth = (path: string) => path.split('/').length;

/**
 * Write the project to storage, step by step. First deletes, then moves, then new folders, then
 * changed files, then the name and main file. Every finished step is passed to onStep, so a save
 * that fails halfway still remembers what made it.
 */
export async function saveProject(options: {
  provider: StorageProvider;
  project: ProjectDoc;
  blobs: BlobStore;
  manifest: SavedManifest | null;
  projectId: string | null;
  onStep?: (manifest: SavedManifest) => void;
  /** File ids waiting on a conflict choice. We skip them so nothing gets overwritten meanwhile. */
  held?: ReadonlySet<string>;
  /** File ids the person chose to overwrite even though they changed in storage. */
  overwrite?: ReadonlySet<string>;
}): Promise<SaveResult> {
  const { provider, project, blobs } = options;
  const name = project.getName() || 'Untitled';
  let manifest: SavedManifest;
  if (options.projectId && options.manifest?.projectId === options.projectId) {
    manifest = structuredClone(options.manifest);
  } else if (options.projectId) {
    // We know the project but not what's in it, like after an upgrade. Write everything, delete nothing.
    manifest = { projectId: options.projectId, name, mainPath: null, files: {} };
  } else {
    const created = await provider.createProject(name);
    manifest = { projectId: created.id, name, mainPath: null, files: {} };
  }
  const step = () => options.onStep?.(structuredClone(manifest));
  step();

  const current = project.entries();
  const currentById = new Map(current.map((entry) => [entry.id, entry]));

  // First, delete what's gone. A folder delete takes its contents along, so skip those after.
  const removed = Object.entries(manifest.files)
    .filter(([id]) => !currentById.has(id))
    .sort(([, a], [, b]) => depth(a.path) - depth(b.path));
  for (const [id, saved] of removed) {
    if (!manifest.files[id]) continue;
    await provider.remove(manifest.projectId, saved.path);
    for (const [otherId, other] of Object.entries(manifest.files)) {
      if (other.path === saved.path || isInside(other.path, saved.path)) {
        if (!currentById.has(otherId)) delete manifest.files[otherId];
      }
    }
    delete manifest.files[id];
    step();
  }

  // Now move and rename, shallow first, so a folder move carries its files before we look at them.
  const moved = current
    .filter((entry) => manifest.files[entry.id] && manifest.files[entry.id].path !== entry.path)
    .sort((a, b) => depth(manifest.files[a.id].path) - depth(manifest.files[b.id].path));
  for (const entry of moved) {
    const from = manifest.files[entry.id].path;
    if (from === entry.path) continue;
    await provider.move(manifest.projectId, from, entry.path);
    for (const saved of Object.values(manifest.files)) saved.path = replacePrefix(saved.path, from, entry.path);
    if (manifest.mainPath) manifest.mainPath = replacePrefix(manifest.mainPath, from, entry.path);
    step();
  }

  // Write one file, checking it against the version we last saw. A conflict holds just that file.
  const conflicts: FileConflict[] = [];
  const write = async (id: string, path: string, data: string | Uint8Array): Promise<{ version?: string } | null> => {
    const check = { expectedVersion: manifest.files[id]?.version, force: options.overwrite?.has(id) };
    try {
      return (await provider.writeFile(manifest.projectId, path, data, check)) ?? {};
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      conflicts.push({ id, path, remoteVersion: error.remoteVersion });
      return null;
    }
  };

  // Then make empty folders and write files that are new or changed.
  let pending = 0;
  for (const entry of current) {
    const saved = manifest.files[entry.id];
    if (entry.kind === 'folder') {
      if (saved) continue;
      await provider.createFolder(manifest.projectId, entry.path);
      manifest.files[entry.id] = { path: entry.path, kind: 'folder', rev: '' };
      step();
      continue;
    }
    if (options.held?.has(entry.id)) continue;
    if (entry.kind === 'text') {
      const text = project.getText(entry.id).toString();
      const rev = textRev(text);
      if (saved?.rev === rev) continue;
      const written = await write(entry.id, entry.path, text);
      if (!written) continue;
      manifest.files[entry.id] = { path: entry.path, kind: 'text', rev, version: written.version };
      step();
      continue;
    }
    const rev = entry.hash ?? '';
    if (saved?.rev === rev) continue;
    const bytes = rev ? await blobs.get(rev) : undefined;
    if (!bytes) {
      pending += 1;
      continue;
    }
    const written = await write(entry.id, entry.path, bytes);
    if (!written) continue;
    manifest.files[entry.id] = { path: entry.path, kind: 'binary', rev, version: written.version };
    step();
  }

  // Finally, the project name and main file.
  if (manifest.name !== name) {
    await provider.renameProject(manifest.projectId, name);
    manifest.name = name;
    step();
  }
  const mainId = project.getMainFileId();
  const mainPath = mainId ? (currentById.get(mainId)?.path ?? null) : null;
  if (manifest.mainPath !== mainPath) {
    await provider.setMainFile(manifest.projectId, mainPath);
    manifest.mainPath = mainPath;
    step();
  }

  // Some providers change the id while saving, like Drive making a folder for an old single file.
  const canonical = provider.currentProjectId?.(manifest.projectId);
  if (canonical && canonical !== manifest.projectId) {
    manifest.projectId = canonical;
    step();
  }
  return { manifest, pending, conflicts };
}

/**
 * Build the manifest for a project we just loaded from storage, so the first save only writes edits.
 * Pass versionOf to keep each file's storage version from the load.
 */
export function manifestFromProject(projectId: string, project: ProjectDoc, versionOf?: (path: string) => string | undefined): SavedManifest {
  const files: SavedManifest['files'] = {};
  for (const entry of project.entries()) {
    const rev = entry.kind === 'text' ? textRev(project.getText(entry.id).toString()) : entry.kind === 'binary' ? (entry.hash ?? '') : '';
    files[entry.id] = { path: entry.path, kind: entry.kind, rev };
    const version = entry.kind === 'folder' ? undefined : versionOf?.(entry.path);
    if (version) files[entry.id].version = version;
  }
  const mainId = project.getMainFileId();
  return {
    projectId,
    name: project.getName(),
    mainPath: mainId ? (project.get(mainId)?.path ?? null) : null,
    files,
  };
}
