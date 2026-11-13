import type { PickerSelection } from '../storage/providers/googlePicker';
import type { ProjectListing, StorageProvider } from '../storage/providers/types';
import type { ProjectDoc } from '../project/projectDoc';
import type { BlobStore } from '../project/blobStore';
import { textRev, type SavedManifest } from '../storage/projectSaver';
import { describeError } from '../storage/errors';
import { isTextPath } from '../project/paths';

/**
 * "Add Files from Drive". The app only has the drive.file scope, so it can't see files someone put
 * in the project folder from Drive itself. Picking them in the Google Picker grants access, then we
 * list the folder again and bring in whatever showed up, at the same path it has in Drive.
 */

/** The bits of the Drive provider this needs, so tests can pass a fake. */
export type DriveFilesProvider = Pick<StorageProvider, 'openProject' | 'readFile' | 'fileVersion'> & {
  projectFolderId(projectId: string): Promise<string | null>;
  pathOfDriveId(projectId: string, driveId: string): string | undefined;
};

export type MergeResult = {
  /** Paths we added to the project. */
  added: string[];
  /** Paths the project already had a file at that storage didn't know about. We kept the project's copy. */
  kept: string[];
  failed: { path: string; message: string }[];
};

const decoder = new TextDecoder();

/**
 * Add every file and folder in the listing that the project doesn't have yet, and record them in
 * the manifest so the next save doesn't write them straight back.
 * Paths the manifest knows about are left alone, since those were deleted or moved here and the
 * save just hasn't caught up.
 */
export async function mergeNewDriveFiles(options: {
  provider: Pick<StorageProvider, 'readFile' | 'fileVersion'>;
  projectId: string;
  listing: ProjectListing;
  project: ProjectDoc;
  blobs: Pick<BlobStore, 'put'>;
  manifest: SavedManifest | null;
}): Promise<MergeResult> {
  const { provider, projectId, listing, project, blobs, manifest } = options;
  const known = new Set(Object.values(manifest?.files ?? {}).map((file) => file.path));
  const result: MergeResult = { added: [], kept: [], failed: [] };
  // Shallow first, so a folder is there before the files in it.
  const entries = [...listing.entries].sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
  for (const entry of entries) {
    if (known.has(entry.path)) continue;
    if (project.findByPath(entry.path)) {
      if (entry.kind === 'file') result.kept.push(entry.path);
      continue;
    }
    try {
      if (entry.kind === 'folder') {
        const id = project.createFolder(entry.path);
        if (manifest) manifest.files[id] = { path: entry.path, kind: 'folder', rev: '' };
        continue;
      }
      const data = await provider.readFile(projectId, entry.path);
      const version = provider.fileVersion?.(projectId, entry.path);
      let id: string;
      let rev: string;
      let kind: 'text' | 'binary';
      if (isTextPath(entry.path)) {
        const text = decoder.decode(data);
        id = project.createTextFile(entry.path, text);
        rev = textRev(text);
        kind = 'text';
      } else {
        rev = await blobs.put(data);
        id = project.putBinaryFile(entry.path, rev, data.length);
        kind = 'binary';
      }
      if (manifest) manifest.files[id] = { path: entry.path, kind, rev, ...(version ? { version } : {}) };
      result.added.push(entry.path);
    } catch (error) {
      result.failed.push({ path: entry.path, message: describeError(error) });
    }
  }
  return result;
}

/** Turn a merge into one line for the notice, and say if it's worth flagging as a problem. */
export function describeAddResult(result: MergeResult, notFound: string[]): { message: string; isError: boolean } {
  const parts: string[] = [];
  parts.push(result.added.length ? `Added ${result.added.length} file(s) from Drive: ${result.added.join(', ')}.` : 'No new files to add from Drive.');
  if (result.kept.length) parts.push(`Kept the project's own copy of ${result.kept.join(', ')}.`);
  if (notFound.length) {
    parts.push(`Could not add ${notFound.join(', ')}: pick files inside this project's folder, and pick a subfolder too if it was made in Drive. Google Docs and Sheets can't be added.`);
  }
  if (result.failed.length) parts.push(`Failed: ${result.failed.map((item) => `${item.path} (${item.message})`).join('; ')}.`);
  return { message: parts.join(' '), isError: notFound.length > 0 || result.failed.length > 0 };
}

/** Why the command is or isn't available, for the upload dialog. */
export function addFromDriveNote(state: { isClient: boolean; isDrive: boolean }): string {
  if (state.isClient) return 'Only the host can add files from their Google Drive.';
  if (!state.isDrive) return 'Save the project to Google Drive first, then you can add files from its Drive folder.';
  return 'Files put in the project folder from Drive itself stay hidden until you pick them.';
}

export type AddFromDriveDeps = {
  isClient: boolean;
  projectState: { isDrive(): boolean; readonly projectId: string | null; readonly manifest: SavedManifest | null };
  provider: DriveFilesProvider;
  getProject(): ProjectDoc;
  blobs: Pick<BlobStore, 'put'>;
  autosave: { enqueue(task: () => Promise<void>): Promise<void> };
  ensureDrivePickerConfig(): boolean;
  ensureDriveConnected(): Promise<boolean>;
  /** Show the multi-select Picker in this Drive folder. */
  pickFiles(folderId: string): Promise<PickerSelection[] | null>;
  setStatus(message: string): void;
  showNotice(message: string, isError?: boolean): void;
};

/** The whole "Add Files from Drive" command: pick, list the folder again, and merge. */
export async function addFilesFromDrive(deps: AddFromDriveDeps): Promise<void> {
  const { projectState, provider, setStatus, showNotice } = deps;
  // Guests can't use the host's Drive, and the command menu already hides this from them.
  if (deps.isClient) return;
  if (!deps.ensureDrivePickerConfig()) return;
  if (!(await deps.ensureDriveConnected())) return;
  const projectId = projectState.projectId;
  if (!projectState.isDrive() || !projectId) {
    setStatus('Drive: Save the project to Drive first');
    return;
  }
  const folderId = await provider.projectFolderId(projectId);
  if (!folderId) {
    // An old single-file project gets its folder on the next save that adds a file.
    showNotice('This project is still a single Drive file. Add a file and save so it gets a project folder, then try again.', true);
    return;
  }

  setStatus('Drive: Opening picker...');
  let picked: PickerSelection[] | null;
  try {
    picked = await deps.pickFiles(folderId);
  } catch (error) {
    console.error('Google Picker failed', error);
    setStatus(`Drive: ${describeError(error)}`);
    return;
  }
  if (!picked?.length) {
    setStatus('Drive: Selection canceled');
    return;
  }

  const chosen = picked;
  setStatus('Drive: Adding files...');
  // Run in the save queue, so a save can't change the project or its Drive index halfway through.
  await deps.autosave.enqueue(async () => {
    if (!projectState.isDrive() || projectState.projectId !== projectId) {
      setStatus('Drive: The project changed, so nothing was added');
      return;
    }
    const listing = await provider.openProject(projectId);
    const result = await mergeNewDriveFiles({ provider, projectId, listing, project: deps.getProject(), blobs: deps.blobs, manifest: projectState.manifest });
    const notFound = chosen.filter((item) => provider.pathOfDriveId(projectId, item.id) === undefined).map((item) => item.name);
    const { message, isError } = describeAddResult(result, notFound);
    setStatus(result.added.length ? `Drive: Added ${result.added.length} file(s)` : 'Drive: No new files');
    showNotice(message, isError);
  });
}

/** Said after "Not found in the project" in the preview diagnostics while the project is on Drive. */
export const DRIVE_MISSING_HINT = "If they're in the project's Drive folder, use File > Add Files from Drive so the app can see them.";
