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
- When you close or reload the tab, the app first writes the open project to this browser right away. So closing it a second after typing doesn't lose anything, and the next time you open the app it finishes the save.
- The browser only asks "Leave site?" when something really could be lost:
  - edits that haven't reached Google Drive yet;
  - edits made while saving is paused;
  - a save that failed;
  - a file waiting on the [conflict dialog](#when-a-file-changed-somewhere-else);
  - files still uploading or arriving from a peer;
  - or browser storage too full to hold the project.

### Updating to a new version

When a new version of the app is deployed, a small card in the bottom corner says **A new version of the app is available**.
It doesn't take focus, so you can keep typing.

- **Reload to update** saves first: the pending autosave runs right away, to this browser or Google Drive, then the page reloads. While saving is paused, it skips the save and keeps your edits in this browser instead.
- If the save fails, the page doesn't reload. The card says why and offers **Reload anyway**.
- **What's new** opens the new version's changelog. Sections you don't have yet say "New in the update", and the version you're on still says "You're on this version". If it can't be loaded, you see the changelog for your version and a link to the latest one on GitHub.
- **Later** hides the card until the next version.
- If you're sharing, guests are disconnected for a moment and rejoin on their own. A guest who reloads rejoins the room.
- The card also shows when a collaborator is on a newer version that this one can't fully talk to, or when part of the app can't load because a new version replaced it.

**File > Save Now** (**Ctrl+S**) saves right away.

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

## Your settings

Your settings are kept apart from your projects: the app and preview themes, the layout (split, editor only or preview only, and where the splitter sits), your keyboard shortcuts, and whether you've seen the tour.

- They're saved in this browser's `localStorage` under one key, `latex-editor.settings`, with a version number so later versions can move them forward.
- Guests save their own settings too. Settings are never sent to people in your room: a room only shares the project.
- Change a setting in one tab and your other open tabs of the app pick it up right away.
- **Settings > Export settings** downloads them as a `.json` file. **Import settings** loads one, in another browser or on another device. Anything in the file that isn't a known setting with a valid value is skipped, and the dialog says what it skipped.
- **Settings > Reset to defaults** resets all settings, or just one part: themes, layout, keyboard shortcuts, or the tour. It asks for a second click first.
- If browser storage is blocked, settings still work but only last until you close the tab. Settings says so, and you can export them to keep a copy.
- Settings saved by older versions (shortcuts, the tour flag, and themes kept with the open project) move over the first time you open this version, so nothing is lost.

Settings don't sync through Google Drive yet. To move them to another device, export them and import the file there.

## Download and upload a .zip

- **File > Download Project .zip** (**Ctrl+Shift+S**) saves the whole project to your computer.
- **File > Download Current File** saves just the open file.
- **File > Export…** has more formats, like PDF and a flattened `.tex`. See [Export](#export).
- **File > Upload .zip as New Project** makes a new project from a `.zip`, like one from Overleaf.

More in [Projects and files](projects.md#downloading).

## Export

**File > Export…** (**Ctrl+Shift+E**, or the toolbar button) saves the project in another format.
Guests can export too, since it only reads the project.

![The Export dialog with HTML picked](assets/screenshots/export-light.png#only-light)
![The Export dialog with HTML picked](assets/screenshots/export-dark.png#only-dark)

1. Pick a **Format**. The box under the menus says what you get. One that can't run right now says "(unavailable)" and why, like "The project has no main .tex file".
2. Pick where it goes in **Save to**: **Download** or **Google Drive**. The dialog remembers this for next time.
3. Set the format's options, if it has any.
4. Press **Export**. A bar shows how far along it is, and **Cancel export** stops it.

The formats:

| Format | What you get | Options |
| --- | --- | --- |
| **Project .zip** | Every file and folder, empty folders included. The same as **Download Project .zip**. | None |
| **PDF** (preview quality) | Opens the print dialog with the preview. Choose **Save as PDF** as the printer. | Paper size: A4 or US Letter |
| **HTML** (preview quality) | The preview as one `.html` file, with its images inside. | **Work offline**: put the styles and fonts in the file too (about 5 MB) |
| **Flattened .tex** | The main file with every `\input` and `\include` put in place, as one `.tex`. Journals and arXiv often ask for this. | **Remove comments**: leave out `%` comments |
| **Single file** | One file from the project, as it is. | Which file. It starts on the open one. |

Things to know:

- The file is made in your browser. With **Download**, nothing is sent to a server.
  The one other network request is for **HTML** with **Work offline**: it downloads the preview's own styles and fonts from the same CDN the preview uses. If that fails, you still get the file, and it loads them from the internet when it opens.
- An image or file that hasn't finished arriving from a peer is left out, and the notice after the export lists it. The Export dialog warns about it before you start.
- **PDF** and **HTML** come from the preview, so they look like the preview, not like a TeX PDF. See [what to expect from the PDF](editing-and-preview.md#pdf-export).
- If the document has an error, **PDF** and **HTML** stop and show it in the dialog, instead of making a broken file.
- **Flattened .tex** keeps an `\input` it can't find as it was, and says which ones. An `\include` gets `\clearpage` before and after it, like LaTeX does.
- In **HTML**, a `\newpage`, `\clearpage` or `\pagebreak` shows as a dashed line labeled "page break", like in the preview. Print the file and the page breaks there, without the line.
- **File > Download Project .zip** always downloads, whatever **Save to** says.

### Export to Google Drive

Pick **Google Drive** in **Save to**, then press **Export**. The file is uploaded to your Drive, with a bar while it goes, and the dialog stays open with an **Open** link to the file.

- **Where it goes:** the line under the menus shows the folder.
  - A project saved in Drive: an `exports` folder inside the project's folder. The app makes it the first time. It's kept apart from your project, so exported files never show up in the file tree or get loaded as project files.
  - A project saved in the browser: the top of **My Drive**.
  - **Choose folder…** opens the Google Picker so you can pick any folder. It's used until you open another project.
- **Signing in:** if you aren't signed in, Google Drive says "(sign-in needed)", and **Export** opens Google's sign-in first. Signing in here doesn't change where the project saves.
- **Guests** in a shared session see "Google Drive (host only)", turned off. A guest can't use the host's Drive, so download the file instead.
- **PDF** can't go to Drive: it goes through the browser's print dialog, so there's no file for the app to upload. Choose **Save as PDF** there, then add the file to Drive yourself. The dialog says so and uses **Download**.
- If the site wasn't set up with Google keys, Google Drive says "(not set up)".
- Drive stores each file as its own kind: HTML as a web page, Flattened .tex as a TeX file, Project .zip as a zip.

There's no other place to export to yet. Browser storage only holds projects, not exported files, so it isn't in the menu.

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
- **Add Files from Drive**: pick files that were put in the project folder from Drive itself, so the app can see them. See [Adding files from Drive](#adding-files-from-drive). Only works once the project is saved in Drive.
- **Rename Project**: renames the project. The next save renames the Drive folder too.
- **Disconnect Google Drive**: signs out and revokes the app's Drive token. Your edits keep saving in this browser as a new local project.

How a project looks in Drive:

- A project is a Drive folder, and each file is a real Drive file inside it, with subfolders kept as they are.
- Files you delete in the app go to the Drive trash.
- Moving a project from this browser to Drive saves a new copy there. The old copy in the browser stays.
- An old single `.tex` file from before projects keeps saving to that file. When you add a second file, the app makes a project folder next to it and moves the file in.

What the app can see:

- The app asks only for the `drive.file` permission. It can see files it made and files you pick, nothing else.
- If you add a file to the project folder in Drive itself, the app won't see it until you pick it with **File > Add Files from Drive**.

### Adding files from Drive

Say someone drops `figures/plot.png` into the project folder on drive.google.com.
The app doesn't see it, because `drive.file` only covers files the app made or you picked.
Picking the project folder when you opened it doesn't count: that grants the folder, not the files already in it.
Full Drive access would fix this, but it needs a Google security review, so the app doesn't ask for it.

To bring the file in:

1. Use **File > Add Files from Drive**, or the **Add Files from Drive** button in the upload dialog.
2. The Google Picker opens in the project folder. Select every file you want; you can pick several at once.
3. If a file is in a subfolder that was also made in Drive, pick that subfolder too, so the app can see where the file goes.
4. The app lists the folder again and adds each new file at the same path it has in Drive.

A notice says what was added. Some things are left out, and the notice says so:

- A file outside this project's folder.
- A Google Doc or Sheet. They have no file to download.

If the project already has a file at the same path that was never saved to Drive, the app doesn't just pick one:

- Same content on both sides: nothing to do, the file just counts as saved.
- Different content: saving that file pauses and the [conflict dialog](#when-a-file-changed-somewhere-else) asks which copy to keep. **Keep mine** writes the project's copy over Drive's. **Use Drive's copy** loads Drive's copy into the project. **Save mine as a copy** keeps yours under a new name and loads Drive's.

If the preview says **Not found in the project** while the project is on Drive, it adds a reminder to use **Add Files from Drive**, in case the file is in the Drive folder but not picked yet.

Only the host can do this, since it uses the host's Drive. Guests see the command turned off.

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

**File > New Project** (**Ctrl+Shift+N**) starts a fresh project with a starter `main.tex`, after you confirm.
The project you were on stays saved where it was.
New projects save to wherever you were saving before, browser or Drive.
If you're sharing, the new project replaces the old one for everyone in the room.

## Related topics

- [Projects and files](projects.md)
- [Getting started](getting-started.md)
- [Sharing and collaboration](collaboration.md)
