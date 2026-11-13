// Texts about "Add Files from Drive" that the page needs before that command runs. The command
// itself is in driveAddFiles.ts, which loads on first use.

/** Why the command is or isn't available, for the upload dialog. */
export function addFromDriveNote(state: { isClient: boolean; isDrive: boolean }): string {
  if (state.isClient) return 'Only the host can add files from their Google Drive.';
  if (!state.isDrive) return 'Save the project to Google Drive first, then you can add files from its Drive folder.';
  return 'Files put in the project folder from Drive itself stay hidden until you pick them.';
}

/**
 * How the conflict dialog words a picked Drive file that meets a project file of the same name.
 * "Keep mine" overwrites Drive's copy, "Use Drive's copy" replaces the project's.
 */
export const DRIVE_PICK_CONFLICT = {
  title: 'Same file name in Drive',
  reason: "is also in the project's Drive folder, with different content, and this copy was never saved there.",
  theirs: "Use Drive's copy",
};

/** Said after "Not found in the project" in the preview diagnostics while the project is on Drive. */
export const DRIVE_MISSING_HINT = "If they're in the project's Drive folder, use File > Add Files from Drive so the app can see them.";
