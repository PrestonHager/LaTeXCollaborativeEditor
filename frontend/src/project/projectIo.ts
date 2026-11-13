import type { StorageProvider } from '../storage/providers/types';
import type { BlobStore } from './blobStore';
import type { ProjectContent, ProjectDoc } from './projectDoc';
import { createZip, readZip, type ZipEntry } from './zip';
import { guessMainFile, isTextPath, normalizePath } from './paths';

export const STARTER_TEX = '\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n\n\\end{document}\n';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** A brand new project with one starter main.tex. */
export function starterProject(name: string, text = STARTER_TEX): ProjectContent {
  return { name, mainPath: 'main.tex', files: [{ path: 'main.tex', kind: 'text', text }] };
}

/** Turn loose files (from storage or a zip) into project content, keeping binary bytes in the blob store. */
export async function contentFromFiles(
  name: string,
  files: { path: string; data: Uint8Array }[],
  folders: string[],
  blobs: BlobStore,
  mainPath?: string | null,
): Promise<ProjectContent> {
  const content: ProjectContent = { name, files: [] };
  for (const folder of folders) {
    const path = normalizePath(folder);
    if (path) content.files.push({ path, kind: 'folder' });
  }
  for (const file of files) {
    const path = normalizePath(file.path);
    if (!path) continue;
    if (isTextPath(path)) {
      content.files.push({ path, kind: 'text', text: decoder.decode(file.data) });
    } else {
      const hash = await blobs.put(file.data);
      content.files.push({ path, kind: 'binary', hash, size: file.data.length });
    }
  }
  const textFiles = content.files.filter((file) => file.kind === 'text');
  content.mainPath = mainPath && textFiles.some((file) => file.path === mainPath) ? mainPath : guessMainFile(textFiles);
  return content;
}

/** Read every file of a stored project. */
export async function loadProject(provider: StorageProvider, projectId: string, blobs: BlobStore): Promise<ProjectContent> {
  const listing = await provider.openProject(projectId);
  const files: { path: string; data: Uint8Array }[] = [];
  for (const entry of listing.entries) {
    if (entry.kind === 'file') files.push({ path: entry.path, data: await provider.readFile(listing.id, entry.path) });
  }
  const folders = listing.entries.filter((entry) => entry.kind === 'folder').map((entry) => entry.path);
  return contentFromFiles(listing.name, files, folders, blobs, listing.mainPath);
}

/** Make a project from an uploaded .zip, named after the zip file. */
export async function projectFromZip(fileName: string, bytes: Uint8Array, blobs: BlobStore): Promise<ProjectContent> {
  const zip = await readZip(bytes);
  if (!zip.files.length) throw new Error('That .zip has no files in it.');
  return contentFromFiles(fileName.replace(/\.zip$/i, '') || 'Imported project', zip.files, zip.folders, blobs);
}

/**
 * Zip the whole project. Binary files we don't have yet (still coming from a peer) are left
 * out, and their paths are returned so the caller can say so. Empty folders are kept as
 * directory entries, so the folder tree comes back the same when the zip is imported.
 */
export async function projectToZip(
  project: Pick<ProjectDoc, 'entries' | 'getText' | 'folderPaths'>,
  blobs: Pick<BlobStore, 'get'>,
): Promise<{ zip: Uint8Array; skipped: string[] }> {
  const entries: ZipEntry[] = [];
  const skipped: string[] = [];
  for (const entry of project.entries()) {
    if (entry.kind === 'text') {
      entries.push({ path: entry.path, data: encoder.encode(project.getText(entry.id).toString()) });
    } else if (entry.kind === 'binary') {
      const bytes = entry.hash ? await blobs.get(entry.hash) : undefined;
      if (bytes) entries.push({ path: entry.path, data: bytes });
      else skipped.push(entry.path);
    }
  }
  return { zip: await createZip(entries, project.folderPaths()), skipped };
}
