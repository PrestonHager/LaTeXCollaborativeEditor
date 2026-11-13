// The Export dialog's "Save to" menu: Download and Google Drive. This file is in the initial
// bundle, so it stays small; the Drive upload itself is in driveUpload.ts, loaded on first use.
import type { DestinationChoice } from '../ui/exportDialog';
import { downloadDestination } from './registry';
import type { DriveApi, DriveTarget } from './driveUpload';

export function downloadChoice(download: (name: string, data: Blob, type: string) => void): DestinationChoice {
  return { id: 'download', label: 'Download', status: () => ({ ok: true }), prepare: () => downloadDestination(download) };
}

export type DriveFolderPick = { id: string; name: string };

export type DriveChoiceDeps = {
  api: DriveApi;
  /** A guest in someone else's room. Guests can't use the host's Drive. */
  isGuest(): boolean;
  /** False when the site has no Google client id. */
  configured(): boolean;
  /** Signed in with a token that works now, so Export won't need a popup. */
  signedIn(): boolean;
  /** Sign in if needed. It runs from a click, since it may open Google's popup. */
  signIn(): Promise<boolean>;
  /** The open project's Drive folder id, or null when the project isn't saved in Drive. */
  projectFolderId(): Promise<string | null>;
  /** Whether the open project is saved in Drive, for the folder label. */
  inDriveProject(): boolean;
  /** Changes when another project opens, so a folder picked for one doesn't carry over. */
  projectKey(): string;
  /** What to call the exports folder in the project folder. */
  exportsFolderName(): string;
  /** The Google Picker in folder mode. null or undefined when canceled or it failed (it says why itself). */
  pickFolder(): Promise<DriveFolderPick | null | undefined>;
  load?: () => Promise<typeof import('./driveUpload')>;
};

/**
 * Google Drive in the "Save to" menu. It shows for everyone, and says what it needs when it
 * can't run: sign-in, the host's Drive, or a format with a file to upload.
 * The default folder is `exports` in the project's Drive folder, so exports sit with the project
 * without becoming project files. A project that isn't in Drive saves to the top of My Drive.
 */
export function driveChoice(deps: DriveChoiceDeps): DestinationChoice {
  let picked: { key: string; folder: DriveFolderPick } | null = null;
  const pickedFolder = () => (picked && picked.key === deps.projectKey() ? picked.folder : null);
  const load = deps.load ?? (() => import('./driveUpload'));
  const signIn = async () => {
    if (!(await deps.signIn())) throw new Error("Google Drive sign-in didn't finish, so nothing was exported. Try again, or pick Download.");
  };
  return {
    id: 'drive',
    label: 'Google Drive',
    status(exporter) {
      if (deps.isGuest()) return { ok: false, tag: 'host only', reason: "Guests can't save to the host's Google Drive. Download the file instead." };
      if (!deps.configured()) return { ok: false, tag: 'not set up', reason: "Google Drive isn't set up on this site." };
      if (exporter?.printsOnly) {
        return {
          ok: false,
          tag: `not for ${exporter.label}`,
          reason: `${exporter.label} opens the print dialog, so there's no file to upload. Choose "Save as PDF" there, then add the file to Drive yourself.`,
        };
      }
      if (!deps.signedIn()) return { ok: true, tag: 'sign-in needed', note: 'Google asks you to sign in when you press Export.' };
      return { ok: true };
    },
    folder: {
      name: () => pickedFolder()?.name ?? (deps.inDriveProject() ? `${deps.exportsFolderName()} (in the project's folder)` : 'My Drive'),
      async choose() {
        await signIn();
        const folder = await deps.pickFolder();
        if (folder) picked = { key: deps.projectKey(), folder };
      },
    },
    async prepare() {
      // Sign-in comes first, while this is still the Export click.
      await signIn();
      const { createDriveDestination } = await load();
      const folder = pickedFolder();
      const target: DriveTarget = folder
        ? { folderId: folder.id, folderName: folder.name }
        : { exportsIn: await deps.projectFolderId(), name: deps.exportsFolderName() };
      return createDriveDestination(deps.api, target);
    },
  };
}
