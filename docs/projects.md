# Projects and files

Everything you open, save, and share is a project.
A project is a file tree with one main `.tex` file, plus whatever else it uses: chapters, images, `.bib` files, and custom `.sty` or `.cls` files.

![The Files panel with its buttons labeled](assets/screenshots/files-light.png#only-light)
![The Files panel with its buttons labeled](assets/screenshots/files-dark.png#only-dark)

## File tree

The **Files** panel on the left shows the project's file tree.

- Click a text file to open it in the editor.
- Click an image or PDF to open it in the [file viewer](#viewing-images-and-pdfs).
- Click a folder to open or close it.
- The open file is highlighted, and its path shows in the bar above the editor.
- The main file has a **main** badge, in the tree and above the editor.

Hover a row to see its buttons:

- **Star**: make this the [main file](#main-file).
- **Pencil**: rename or move it.
- **Trash**: delete it.

The three buttons at the top of the panel are **New file**, **New folder**, and **Upload files**.
They're also in the **File** menu.

If the project has no files, the panel says "No files yet".
If you joined someone else's room and haven't connected yet, it says "Waiting for the host" instead.

## New files and folders

**New file** (**Ctrl+N**, or **Alt+N** in a browser tab) asks for a name and suggests `chapter.tex`.
**New folder** suggests `figures`.

- They go into the current folder: the folder you last clicked, or the folder of the file you last clicked.
- New files are always text. If the name doesn't end in a text extension like `.tex`, `.bib`, or `.sty`, the app adds `.tex`.
- If the suggested name is taken, the box starts with the next free one, like `chapter (2).tex` or `figures (2)`, and says "chapter.tex already exists, so here's chapter (2).tex instead." until you type.
- If you type a name that's taken, it says so under the box with a **Use chapter (2).tex** button. Pressing Enter fills in that name, and a second Enter creates it.
- Renaming works the same way when you type a name that's taken.

## Rename, move, and delete

- Click the pencil and type a new name. Use `/` to move it into a folder, like `figures/plot.png`.
- Or drag a file onto a folder to move it there.
- Renaming a folder moves everything inside it.
- You can't move a folder into itself, and you can't take a name that's already in use. The app tells you if you try.
- Click the trash can to delete a file or folder. The app asks first, since collaborators lose it too.

You can undo all of these, and new files, folders and uploads too: click **Undo** in the notice, or press **Ctrl+Z** with focus in the Files panel.
See [Undoing file operations](editing-and-preview.md#undoing-file-operations).

## Uploading files

There are two ways to upload.
Either click **Upload files** in the Files panel (or **File > Upload Files**), or drop files from your computer onto the panel.

![The upload dialog](assets/screenshots/upload-light.png#only-light)
![The upload dialog](assets/screenshots/upload-dark.png#only-dark)

In the upload dialog:

- **Upload into** picks the folder.
- Drop files on the box, or click it to pick them.
- Each file shows "added", "replaced", or why it failed.
- Files go into the project right away, so **Done** just closes the dialog.

When you drop files on the panel, they go into the folder you drop them on, or the root if you drop them anywhere else.

Some rules:

- Each file can be up to 10 MB.
- Text files (`.tex`, `.bib`, `.sty`, `.cls`, `.txt`, `.csv`, and similar) become editable text.
- Everything else, like images and PDFs, is kept as a binary file.
- Uploading a file with the same path as an existing one replaces it.
- A `.zip` isn't unpacked here. Use **File > Upload .zip as New Project** for that.

When the project is saved in Google Drive, the bottom of the upload dialog has an **Add Files from Drive** button.
Use it for files someone put in the project's Drive folder from Drive itself, since the app can't see those until you pick them.
See [Adding files from Drive](saving-and-storage.md#adding-files-from-drive).
When it's turned off, the line next to it says why: the project isn't on Drive yet, or you're a guest.

When you're in a shared room, peers get your uploads over the direct WebRTC connection.
While a file is on its way, its row shows a progress bar.
Nothing goes through a server.

## Main file

The main file is where the preview starts.
It's the `.tex` file with `\documentclass` unless you pick another one.

- To change it, hover a `.tex` file and click the star.
- The compile pill says **No main file** if the project has files but no main file, for example after you delete it.

The preview follows `\input` and `\include` from the main file, so you only need one main file even for a big project.
See [Editing and preview](editing-and-preview.md#live-preview) for what the preview can read.

## Viewing images and PDFs

Clicking a binary file opens it in the viewer instead of the editor.

- PNG, JPG, GIF, WebP, and SVG images show as pictures.
- PDFs show in the browser's own PDF viewer.
- Other files show their size, a note that they can't be shown, and a **Download** button.
- If the file is still coming from a peer, you see "Getting this file from a peer" with a progress bar.

## Project name

Click the project name at the top left (it says "Untitled" at first) to rename it.
**File > Rename Project** does the same thing.

A project isn't saved until it has a name.
**Save Now** and **Save to Google Drive** ask for one if it's missing.
The name is shared with everyone in the room, and the next save renames the stored copy too.

## New project

**File > New Project** (**Ctrl+Shift+N**, or **Alt+Shift+N** in a browser tab) starts a fresh project with a starter `main.tex`, after you confirm.
The confirm is titled **Replace the whole project?** and starts on **Cancel**, so pressing it by mistake when you meant **New File** is easy to spot, and Enter cancels.
The project you were on stays saved where it was.
It's host only, and if you're sharing, it clears the project for everyone in the room, so the confirm says so.

## Opening a project

- **File > Open Local Project** (**Ctrl+O**) opens a dialog listing projects saved in this browser, newest first. Click one to open it.
- **File > Open from Google Drive** (**Ctrl+Shift+O**) opens the Drive picker. Pick a project folder, or an old single `.tex` file.
- **File > Upload .zip as New Project** makes a new project from a `.zip`, like one downloaded from Overleaf. The **Upload .zip** button in the open dialog does the same.

![The Open a project dialog](assets/screenshots/projects-light.png#only-light)
![The Open a project dialog](assets/screenshots/projects-dark.png#only-dark)

These are host only. While a guest is connected, each one asks first, since it replaces the project for everyone in the room.

Before switching, the app saves anything still pending on the current project.

If every file in a `.zip` sits in one folder, that folder becomes the project root.
The new project isn't saved until the first autosave, which needs a name.

## Downloading

- **File > Download Project .zip** (**Ctrl+Shift+S**) saves the whole project as `name.zip`.
- **File > Download Current File** saves just the open file.

If a peer hasn't finished sending you an image yet, the zip leaves it out and the notice says which files it's still waiting on.
Empty folders are kept in the zip, so uploading it again gives back the same folder tree.

## Projects with collaborators

- A share link shares the whole project, not one file.
- Guests see the full file tree and can add, rename, move, delete, and upload files too.
- Guests can't open, save, or start projects. Those are host-only, so they're grayed out in the guest's File menu.
- If two people rename the same file at the same time, everyone ends up with the same one of the two names.
- If one person renames a file while another deletes it, the renamed file is kept.
- If two people make a file with the same path at the same time, both are kept, and one shows up as `name (2).ext`.

## Related topics

- [Saving and storage](saving-and-storage.md)
- [Sharing and collaboration](collaboration.md)
- [What's supported](whats-supported.md)
