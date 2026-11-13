# Interface and layout

## Menu bar

| Menu | Typical actions |
|------|------------------|
| **File** | New project, open (local, Drive, or .zip), new file or folder, upload, download (.zip or one file), Drive connect/save/move/rename, Save Now, clear local projects |
| **Edit** | Undo, redo, cut, copy, paste, select all, **Settings** |
| **View** | Toggle **editor** theme, toggle **preview** theme, **Pause Saving**, **Compile Now**, layout modes |
| **Help** | Command palette, **Documentation** (this site), **Keyboard Shortcuts**, **Show Tour**, **Report a Bug**, **Request a Feature**, **About** |

Some File entries are **disabled** when you are a **guest** in a shared room (`?room=` in the URL).

**Report a Bug** and **Request a Feature** open the GitHub issue forms in a new tab.
The bug form comes with your browser, OS, and the app version filled in.
It never includes your document, file names, or the room link, and nothing is sent until you submit the form yourself.

**About** shows the app version, with links to the docs, the source code, and the policies.

## Toolbar

The row of icon buttons under the menus covers the things you do most: new file, upload, save now, compile now, share, the three layout modes, the command palette, and the docs.
Hover a button (or focus it) to see what it does and its shortcut.
They run the same commands as the menus, so they're disabled in the same cases.

With the keyboard, Tab moves into the toolbar, then the arrow keys move between buttons, and Home and End jump to the first and last.

## Help links

Small **?** buttons next to the share button, the save status, the file list, and the preview open the matching page of these docs.
The settings, upload, and project dialogs have a help link at the bottom too.
When something goes wrong, like a failed save or a blocked sign-in popup, the message at the top gets a **Learn more** link, and sometimes a **Report this** link that opens the bug form.

## First-run tour

The first time you open the app, a short tour points out the menus, toolbar, files, editor, preview, share button, and status.
Skip it any time with **Skip tour** or Esc.
It only shows once per browser, and you can take it again from **Help > Show Tour**.

## Command palette

Press **Ctrl+P** on Windows/Linux or **⌘+P** on macOS to open the **command palette**. It lists the menu commands, with shortcut hints, plus a few that only live in the palette. Type to filter, then choose an action.
Each entry has a one-line description under it, and search matches those words too, so typing "github" finds **Report a Bug**.

Palette-only commands:

- **Switch to dark mode**, **Switch to light mode**, and **Switch to system theme** set the app, editor, and preview theme in one go. The one you're already using is hidden. (The menu's theme toggles aren't in the palette, since these replace them.)
- **Copy share link** does the same thing as the **Share** button.
- **Focus editor** puts the cursor back in the editor.

While the palette is open, other global shortcuts are not handled so the palette can use the keyboard.

## Settings

Open **Edit > Settings**, press **Ctrl+,** (**⌘+,** on macOS), or search the palette for "settings".
Changes apply right away, there's no save button.

- **App and editor theme** and **Preview theme**: match system, dark, or light.
- **Pause saving**: same as **View > Pause Saving**. It stops autosave and **Save Now** until you turn it off, then saves what changed.
- **Clear local projects**: deletes every project saved in this browser, after asking first.

Guests in a shared room can change themes, but the saving options are turned off since the host decides how the project is saved.

## Themes

- **Toggle Editor Theme** cycles **dark → light → system** for the chrome and editor styling. **System** follows your OS light/dark preference.
- **Toggle Preview Theme** does the same for the preview pane only, so you can mix—for example a dark editor and a light preview.

## Layout modes

Under **View**:

- **Split View** — editor and preview side by side; drag the **splitter** to change the ratio (within sensible bounds). You can also focus the splitter with Tab and use the left and right arrow keys.
- **Editor Only** — maximizes source editing; preview is hidden.
- **Preview Only** — maximizes the rendered view; editor is hidden.

The active layout mode is indicated with a check mark in the menu.

## Header status pills

Use **Connection**, **Compile**, and **Autosave** (or related text) as quick reads on what the app is doing.

- **Connection** says who you're editing with, like "Not shared", "Shared, waiting for others", or "Connected with 2 other people".
- **Compile** says whether the preview is up to date.
- **Autosave** says where and when the project last saved, like "Saved to Browser storage at 3:41 PM".

Details for each are covered in [Collaboration](collaboration.md), [Editing and preview](editing-and-preview.md), and [Saving and storage](saving-and-storage.md).

## Related topics

- [Keyboard shortcuts](keyboard-shortcuts.md)  
