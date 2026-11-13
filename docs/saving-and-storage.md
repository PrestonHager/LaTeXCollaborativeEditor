# Saving and storage

The host saves the whole project, either to this browser or to Google Drive.
Guests don't save, the host does it for them.
For working with files inside a project, see [Projects and files](projects.md).

## Autosave and Save Now

When you're the host, the app autosaves your project.

- A project isn't saved until it has a name. Click the title at the top left, or use **Save Now**, and it asks for one.
- After an edit, the save happens once you've stopped typing for 4 seconds. It also checks every minute.
- Saves only write what changed: edited files, new files, moves, renames, and deletes.
- **Save Now** (File menu or shortcut) saves right away instead of waiting for autosave.
- **View > Pause Saving** (also in **Settings**) stops autosave and **Save Now** until you turn it off, so you can experiment without writing anything back.
  The autosave line says **Saving paused** while it's on, and the palette shows **Resume Saving**.
  Edits you make while paused are saved as soon as you resume.
  If you try to leave the page with unsaved edits, the browser asks you to confirm first.
  Saving to Google Drive or switching to another project still saves the current one, so you don't lose those edits.
  The setting is remembered after a reload.
- If a save fails, it tries again a few times before showing **Save Error** in the autosave pill.
- A file a guest uploads gets saved once its bytes reach the host.
- If you try to close the tab before the last save is done, or while a file is waiting on the [conflict dialog](#when-a-file-changed-somewhere-else), the browser asks if you want to leave.

**File > Save Now** (**Ctrl+S**) saves right away.

**View > Disable Save Now** (also in Settings) turns off the Save Now command and **Ctrl+S**.
It doesn't stop autosave.
The pill says "Save Now Disabled" while it's on.

The autosave pill tells you what's going on: **Saving pending**, **Saving**, **Saved to this browser**, **Saved to Google Drive**, or **Save Error: ...**.
The full list is in [Status and error messages](messages.md#autosave-pill).

Guests see the host's storage in the pill instead, like "Saved on host Google Drive".

## Local storage (browser)

By default, projects are saved in this browser's storage (IndexedDB) for this site.

- **File > Open Local Project** (**Ctrl+O**) lists your saved projects, newest first. Click one to open it.
- **File > Clear Local Projects** deletes every project saved in this browser. It asks first, since this can't be undone. The same button is in Settings.
- If browser storage is full or blocked (some private browsing modes), the autosave pill says so. See [Storage full](troubleshooting.md#storage-full).
- Documents saved by older versions of the app get moved into one-file projects the first time you open the new version.

Local data is per browser and per site.
It doesn't follow you to another browser or device, and clearing site data deletes it.
Download a `.zip` now and then if browser storage is your only copy.

## Download and upload a .zip

- **File > Download Project .zip** (**Ctrl+Shift+S**) saves the whole project to your computer.
- **File > Download Current File** saves just the open file.
- **File > Upload .zip as New Project** makes a new project from a `.zip`, like one from Overleaf.

More in [Projects and files](projects.md#downloading).

## Google Drive

Drive only works if the site was set up with Google keys.
If it wasn't, you'll see **Drive config missing** or **Drive: API key missing**.

![The File menu with the Drive commands](assets/screenshots/file-menu-light.png#only-light)
![The File menu with the Drive commands](assets/screenshots/file-menu-dark.png#only-dark)

The File menu has these Drive commands, all host-only:

- **Connect Google Drive**: sign in to Google, then autosave goes to Drive. If the project has no name yet, the pill says "Drive: Connected (name the project to save)".
- **Save to Google Drive**: asks for a name if needed, signs in if needed, and saves right away.
- **Open from Google Drive** (**Ctrl+Shift+O**): pick a project folder, or an old single `.tex` file.
- **Move to Drive Folder**: pick a Drive folder to move the project folder into. Only works once the project is saved in Drive.
- **Rename Project**: renames the project. The next save renames the Drive folder too.
- **Disconnect Google Drive**: signs out and revokes the app's Drive token. Your edits keep saving in this browser as a new local project.

How a project looks in Drive:

- A project is a Drive folder, and each file is a real Drive file inside it, with subfolders kept as they are.
- Files you delete in the app go to the Drive trash.
- Moving a project from this browser to Drive saves a new copy there. The old copy in the browser stays.
- An old single `.tex` file from before projects keeps saving to that file. When you add a second file, the app makes a project folder next to it and moves the file in.

What the app can see:

- The app asks only for the `drive.file` permission. It can see files it made and files you pick, nothing else.
- If you add a file to the project folder in Drive itself, the app won't see it. Upload it from the editor instead.

Sign-in:

- Sign-in opens a Google popup. If your browser blocks it, see [Popups blocked](troubleshooting.md#popups-blocked).
- Sign-ins last about an hour. The app tries to renew quietly. If that fails, it saves to this browser and shows a notice, so nothing is lost. Use **Connect Google Drive** to switch back.
- The sign-in only lasts for the current tab. Reloading the tab keeps you signed in, but a new tab or a restarted browser asks you to connect again, and saves go to this browser until you do.
- To see who's signed in, open **Settings** or hover over the save status in the header.

When a save fails:

- If your Google Drive is full, the status line says "Google Drive is full" and the app stops retrying.
  Free up space in Drive, or download a .zip so you don't lose work.
- If Google is limiting requests, the app waits a moment and tries again on its own.
- A save writes your files first and renames the project folder last.
  If a save fails partway, whatever finished stays saved, and the next save picks up the rest.

More: [Drive sign-in](troubleshooting.md#drive-sign-in).

### When a file changed somewhere else

The app remembers each file's Drive version from the last time it loaded or saved it.
Before it overwrites a file, it asks Drive for that file's current version.
If someone changed the file in the meantime (in the Drive web UI, on another device, or in another tab), the app doesn't overwrite it.

- Saving stops for that one file. Other files keep saving as usual.
- A dialog asks what you want to do:
  - **Keep mine** overwrites the Drive file with your copy.
  - **Take theirs** loads the Drive copy into the editor, replacing your copy of that file.
  - **Save mine as a copy** keeps your copy as a new file next to it, like `main (my copy).tex`, then loads the Drive copy into the original.
- The dialog has no close button, since a skipped answer would leave the file unsaved.
- Until you pick, the autosave line says saving is paused, and closing the tab warns you.
- Renaming or moving a file in Drive doesn't count as a change, only its content does.
- If you reload before picking, the app asks again on the next save.

## New project

**File > New Project** (**Ctrl+N**) starts a fresh project with a starter `main.tex`, after you confirm.
The project you were on stays saved where it was.
New projects save to wherever you were saving before, browser or Drive.
If you're sharing, the new project replaces the old one for everyone in the room.

## Related topics

- [Projects and files](projects.md)
- [Getting started](getting-started.md)
- [Sharing and collaboration](collaboration.md)
