import type { StorageProvider } from './providers/types';
import type { ProjectDoc } from '../project/projectDoc';
import type { BlobStore } from '../project/blobStore';
import { textRev, type SavedManifest } from './projectSaver';
import { copyPath, type FileConflict } from './conflicts';

type ManifestFile = SavedManifest['files'][string];
type ResolveOptions = { provider: StorageProvider; projectId: string; project: ProjectDoc; blobs: BlobStore; conflict: FileConflict };

/**
 * Replace our copy of a file with what storage has now.
 * Resolves to the manifest entry to keep, or null if the file is gone from the project.
 */
export async function takeTheirs({ provider, projectId, project, blobs, conflict }: ResolveOptions): Promise<ManifestFile | null> {
  const entry = project.get(conflict.id);
  if (!entry || entry.kind === 'folder') return null;
  const data = await provider.readFile(projectId, conflict.path);
  if (entry.kind === 'text') {
    // Swap the whole text in one change, so peers and undo see a single edit.
    const text = new TextDecoder().decode(data);
    const yText = project.getText(entry.id);
    yText.doc?.transact(() => {
      yText.delete(0, yText.length);
      yText.insert(0, text);
    });
    return { path: entry.path, kind: 'text', rev: textRev(text), version: conflict.remoteVersion };
  }
  const hash = await blobs.put(data);
  project.putBinaryFile(entry.path, hash, data.length);
  return { path: entry.path, kind: 'binary', rev: hash, version: conflict.remoteVersion };
}

/**
 * Keep our copy as a new file next to the original, then take theirs for the original.
 * The new file gets saved by the next autosave like any other new file.
 */
export async function keepMineAsCopy(options: ResolveOptions): Promise<ManifestFile | null> {
  const { project, conflict } = options;
  const entry = project.get(conflict.id);
  if (!entry || entry.kind === 'folder') return null;
  const taken = (path: string) => Boolean(project.findByPath(path)) || project.folderPaths().includes(path);
  const target = copyPath(entry.path, taken);
  if (entry.kind === 'text') project.createTextFile(target, project.getText(entry.id).toString());
  else if (entry.hash) project.putBinaryFile(target, entry.hash, entry.size ?? 0);
  return takeTheirs(options);
}
