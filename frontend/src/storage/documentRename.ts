export const toTexName = (name: string) => (name.endsWith('.tex') ? name : `${name}.tex`);

export type TitleRenameDeps = {
  currentName: string;
  // Say why storage can't be renamed right now, or null when it can.
  storageBlocker: () => string | null;
  // Rename in storage and call onRenamed once it worked. Resolve to false on failure.
  renameInStorage: (oldFileName: string, newFileName: string, onRenamed: () => void) => Promise<boolean>;
  // Set the title, tell peers and persist the session.
  commitName: (name: string) => void;
  markDirty: () => void;
  onStatus: (message: string) => void;
};

/**
 * Rename the open document, only changing the title once storage has the new name too.
 * Otherwise a failed rename leaves the title pointing at a file that doesn't exist, and the next save makes a duplicate.
 * Resolves to true if the document was renamed.
 */
export async function renameDocumentTitle(nextName: string, deps: TitleRenameDeps): Promise<boolean> {
  const next = nextName.trim();
  if (!next || next === deps.currentName) return false;

  // An untitled doc was never saved, so there's nothing to rename in storage yet.
  if (deps.currentName === 'Untitled') {
    deps.commitName(next);
    deps.markDirty();
    return true;
  }

  const blocker = deps.storageBlocker();
  if (blocker) {
    deps.onStatus(blocker);
    return false;
  }
  return deps.renameInStorage(toTexName(deps.currentName), toTexName(next), () => deps.commitName(next));
}
