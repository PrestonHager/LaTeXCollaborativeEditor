// Folders on this computer as projects, in the desktop app (issue #178, docs/desktop.md, "Storage:
// local folders"). A lazy chunk: main.ts imports it only behind isDesktopShell(), so the website
// never downloads it or the Tauri plugin bindings it pulls in.
//
// It adds the "Folder on this computer" entry to the provider registry, runs File > Open Project's
// folder choice and Save to a Folder, picks the last session's folder back up, and watches the open
// folder. A file changed outside the app (another editor, git pull) goes into the conflict flow:
// with no unsaved edits here it reloads quietly, otherwise the conflict dialog asks which copy to keep.
import type { ProjectState } from './projectState';
import type { ProjectDoc } from '../project/projectDoc';
import type { ProviderRegistry } from '../storage/providers/registry';
import type { StorageProvider } from '../storage/providers/types';
import type { FileConflict } from '../storage/conflicts';
import type { ConfirmOptions } from '../ui/dialogs';
import { textRev } from '../storage/projectSaver';
import { describeError } from '../storage/errors';
import { MAX_FILE_BYTES } from '../project/paths';
import { LocalFolderProvider, relativeTo, skipped, tauriFolderFs, type FolderFs } from '../storage/providers/localFolder';

export type FolderContext = {
  registry: ProviderRegistry;
  projectState: ProjectState;
  getProject(): ProjectDoc;
  useProvider(provider: StorageProvider, id: string | null): void;
  openStoredProject(provider: StorageProvider, id: string): Promise<void>;
  /** Hold a file and ask which copy to keep (main.ts holdConflict). */
  holdConflict(conflict: FileConflict): void;
  /** Load the folder's copy of a file without asking, for a file with no unsaved edits here. */
  takeTheirs(conflict: FileConflict): Promise<void>;
  confirmDialog(options: ConfirmOptions): Promise<boolean>;
  autosave: { enable(): void; markDirty(): void };
  setStatus(message: string): void;
  showNotice(message: string, isError?: boolean): void;
};

export type FolderCommands = {
  /** File > Open Project > Folder on this computer. The caller already asked about replacing the project. */
  open(): Promise<void>;
  /** Save to a Folder: from now on the open project saves to a folder the person picks. */
  saveTo(): Promise<void>;
  /** The provider, when the last session's folder is still there and reachable, for ProjectState.resumeFolder. */
  reopen(root: string): Promise<StorageProvider | null>;
};

export async function setUpFolders(ctx: FolderContext, fs?: FolderFs): Promise<FolderCommands> {
  const provider = new LocalFolderProvider(fs ?? (await tauriFolderFs()));
  const { projectState } = ctx;
  projectState.folderProvider = provider;
  ctx.registry.add({
    id: 'localFolder',
    name: 'Folder on this computer',
    icon: 'folder',
    capabilities: { binaryFiles: true, folders: true, history: false, maxFileBytes: MAX_FILE_BYTES },
    needsSignIn: false,
    provider,
    connectCommand: 'file.saveToFolder',
    actionLabel: 'Save to a Folder',
    configured: () => true,
    status: () => 'connected',
    account: () => null,
  });

  let watched: { root: string; stop: (() => void) | null } | null = null;
  // Say once per folder that files were added outside the app, not on every change.
  let toldAboutNewFiles = false;

  const isOpen = (root: string) => projectState.isFolder() && projectState.projectId === root;

  function stopWatching() {
    watched?.stop?.();
    watched = null;
  }

  async function watch(root: string) {
    if (watched?.root === root) return;
    stopWatching();
    toldAboutNewFiles = false;
    const current: NonNullable<typeof watched> = { root, stop: null };
    watched = current;
    try {
      const stop = await provider.watch(root, (paths) => void changed(root, paths).catch((error: unknown) => console.warn('Folder watch', error)));
      // The project moved on while the watch started.
      if (watched !== current) stop();
      else current.stop = stop;
    } catch (error) {
      // Saving still works, and conflicts still show up when a save finds a changed file.
      console.warn('Could not watch the project folder', error);
    }
  }

  /** Changes the watcher saw. Only files the project has matter; what this app wrote is skipped. */
  async function changed(root: string, paths: string[]) {
    if (!isOpen(root)) {
      // Still waiting for main.ts to resume the last session's folder: not a different project yet.
      if (projectState.awaitingFolder() === root) return;
      if (watched?.root === root) stopWatching();
      return;
    }
    const manifest = projectState.manifest;
    if (!manifest) return;
    const project = ctx.getProject();
    let added = false;
    for (const full of new Set(paths)) {
      const path = relativeTo(root, full);
      if (!path || path.split('/').some(skipped)) continue;
      const version = await provider.diskVersion(root, path);
      if (provider.isOwnChange(root, path, version)) continue;
      const saved = Object.entries(manifest.files).find(([, file]) => file.path === path);
      if (!saved) {
        if (version !== null && !project.findByPath(path)) added = true;
        continue;
      }
      const [id, file] = saved;
      // A file deleted outside the app is written back by the next save, since the project has it.
      if (file.kind === 'folder' || version === null || version === file.version || projectState.conflicts.has(id)) continue;
      const entry = project.get(id);
      const conflict: FileConflict = { id, path, remoteVersion: version };
      const unsaved =
        entry?.kind === 'text' ? textRev(project.getText(id).toString()) !== file.rev : entry?.kind === 'binary' ? entry.hash !== file.rev : true;
      if (unsaved) ctx.holdConflict(conflict);
      else await ctx.takeTheirs(conflict);
    }
    if (added && !toldAboutNewFiles) {
      toldAboutNewFiles = true;
      ctx.showNotice('Files were added to the project folder outside the app. Open the folder again to see them.');
    }
  }

  return {
    async open() {
      const picked = await provider.pickFolder();
      if (!picked) {
        ctx.setStatus('Folder: Selection canceled');
        return;
      }
      await ctx.openStoredProject(provider, picked.id);
      if (isOpen(picked.id)) void watch(picked.id);
    },

    async saveTo() {
      let picked;
      try {
        picked = await provider.pickFolder('Save the project to a folder');
        if (!picked) return;
        const count = await provider.countEntries(picked.id);
        const ok =
          count === 0 ||
          (await ctx.confirmDialog({
            title: 'Save into this folder?',
            message: `${picked.name} already has ${count} file(s) or folder(s). Files with the same names as the project's get replaced. The rest stay as they are.`,
            confirmLabel: 'Save here',
            focusCancel: true,
          }));
        if (!ok) return;
      } catch (error) {
        ctx.showNotice(describeError(error), true);
        return;
      }
      const project = ctx.getProject();
      // A folder project is named after its folder until the person renames it.
      if (!project.getName()) project.setName(picked.name);
      ctx.useProvider(provider, picked.id);
      ctx.autosave.enable();
      ctx.autosave.markDirty();
      ctx.setStatus(`Saving to ${picked.name}`);
      void watch(picked.id);
    },

    async reopen(root) {
      if (!(await provider.reachable(root))) return null;
      void watch(root);
      return provider;
    },
  };
}
