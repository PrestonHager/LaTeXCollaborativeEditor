# Saving and storage

## Projects

Everything you open, save, and share is a **project**: a folder with a main `.tex` file and any other files it uses, like images, `.bib` files, chapters, and custom `.sty` or `.cls` files.

- The **Files** panel on the left shows the project's file tree.
- Click a text file to edit it. Images and PDFs open in a viewer instead.
- Use the buttons at the top of the panel (or the **File** menu) to add a file, add a folder, or upload files.
- Hover a file to rename or move it (type a path with `/` to move it into a folder), delete it, or make it the main file.
- Drag a file onto a folder to move it there.
- Drop files from your computer onto the panel to upload them. Drop them on a folder to upload into that folder.
- Uploads can be up to 10 MB each.
- The **main file** is the one the preview starts from. It's the `.tex` file with `\documentclass` unless you pick another one.
- Click the project name at the top left to rename the project.

## Autosave and “Save Now”

When you are the **host** and not only a guest in someone else’s room, the app can **autosave** the project through the active storage provider.

- The **autosave** line in the header tells you whether autosaving is active and often names the provider (for example local storage or Google Drive).
- A new project isn't saved until it has a name. Saving asks for one if it needs it.
- Saves only write what changed: edited files, new files, moves, renames, and deletes.
- **Save Now** (File menu or shortcut) saves right away instead of waiting for autosave.
- **View > Pause Saving** (also in **Settings**) stops autosave and **Save Now** until you turn it off, so you can experiment without writing anything back.
  The autosave line says **Saving paused** while it's on, and the palette shows **Resume Saving**.
  Edits you make while paused are saved as soon as you resume.
  If you try to leave the page with unsaved edits, the browser asks you to confirm first.
  Saving to Google Drive or switching to another project still saves the current one, so you don't lose those edits.
  The setting is remembered after a reload.
- A file a guest just uploaded gets saved once its bytes reach the host.

Guests in a `?room=…` session see the host’s storage context in the status area. They can add and edit files in the shared project, but they don't save it themselves.

## Local storage (browser)

The app keeps projects in the browser's IndexedDB for this site.

- **Open Local Project** lists your saved projects, newest first, and opens the one you pick.
- **Clear Local Projects** removes every project saved in this browser. It asks you to confirm first, since this can't be undone.
- If browser storage is full or blocked (some private browsing modes), the autosave line says so. Download a .zip so you don't lose work.
- Documents saved by older versions of the app get moved into one-file projects the first time you open the new version.

Local data is **per browser, per site**. Clearing site data in the browser or using another device will not carry those files over.

## Download and upload a .zip

- **Download Project .zip** saves the whole project to your computer.
- **Download Current File** saves just the open file.
- **Upload .zip as New Project** makes a new project from a .zip, like one downloaded from Overleaf. If everything in the zip sits in one folder, that folder becomes the project root.

## Google Drive

If the deployment includes Google Picker credentials, you can:

1. **Connect Google Drive** — sign in and establish a session with Drive.
2. **Open from Google Drive** — pick a project folder, or an old single `.tex` file.
3. **Save to Google Drive** — saves the project as a Drive folder. Each file is a real Drive file inside it, with subfolders kept as they are.
4. **Move to Drive Folder** / **Rename Project** — move the project folder somewhere else in Drive, or rename it.
5. **Disconnect Google Drive** — sign out and revoke the app's access token.
   Your edits keep saving in this browser as a new local project.

If **Connect** or **Open** fails, check the status message in the header (for example missing API key on that deployment).

- **Connect** opens a Google sign-in popup. If your browser blocks it, the status line tells you; allow popups for the site and try again.
- Google sign-ins last about an hour. When the session expires, saves stop and the status line asks you to use **Connect Google Drive** again. After a page reload with an expired session, the app saves to this browser until you reconnect.
- If your Google Drive is full, the status line says "Google Drive is full" and the app stops retrying.
  Free up space in Drive, or download a .zip so you don't lose work.
- If Google is limiting requests, the app waits a moment and tries again on its own.
- A save writes your files first and renames the project folder last.
  If a save fails partway, whatever finished stays saved, and the next save picks up the rest.
- The sign-in only lasts for the current tab.
  Reloading the tab keeps you signed in, but a new tab or a restarted browser asks you to connect again, and saves go to this browser until you do.
- To see who's signed in, open **Settings** or hover over the save status in the header.
- Moving a project between this browser and Drive saves a new copy there. The old copy stays where it was.
- The app can only see files it made or that you picked. If you add a file to the project folder in Drive itself, the app won't see it yet. Upload it from the editor instead.
- Opening an old single `.tex` file keeps saving to that file. Once you add a second file, the app makes a project folder next to the file and moves the file into it.

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

**New Project** starts a fresh project with a starter `main.tex`, after you confirm. The project you were on stays saved where it was.

## Related topics

- [Getting started](getting-started.md)  
- [Collaboration](collaboration.md)  
