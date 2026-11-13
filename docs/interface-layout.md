# Interface and layout

This page goes through every menu item, the command palette, settings, themes, and layouts.
For a picture of how it all connects, see [How the app fits together](how-it-fits.md).

## Menu bar

The shortcuts on this page are the Windows and Linux defaults.
On a Mac, the menus show the Mac keys instead, like **⌘S** for **Ctrl+S** and **⇧⌘O** for **Ctrl+Shift+O**.
If you change a shortcut in [Settings](#settings), the menus, toolbar tooltips, and command palette show your keybind instead.

Click a menu to open it, or focus it with **Tab** and use the arrow keys.
**Escape** closes it.
Items that don't apply right now are grayed out, for example host-only items when you're a guest.

### File

![The File menu](assets/screenshots/file-menu-light.png#only-light)
![The File menu](assets/screenshots/file-menu-dark.png#only-dark)

| Item | Shortcut | What it does |
| --- | --- | --- |
| New Project | Ctrl+N | Starts a fresh project after you confirm. Host only. |
| Open Local Project | Ctrl+O | Lists projects saved in this browser. Host only. |
| Open from Google Drive | Ctrl+Shift+O | Opens the Drive picker. Host only. |
| Upload .zip as New Project | | Makes a new project from a `.zip`. Host only. |
| New File | | Adds a text file to the current folder. |
| New Folder | | Adds a folder to the current folder. |
| Upload Files | | Opens the upload dialog. |
| Download Project .zip | Ctrl+Shift+S | Saves the project as a `.zip`. |
| Download Current File | | Saves the open file. |
| Connect Google Drive | | Signs in and sends autosave to Drive. Host only. |
| Disconnect Google Drive | | Signs out, revokes the token, and saves to this browser from then on. Host only, when signed in. |
| Save to Google Drive | | Saves the project to Drive now. Host only. |
| Move to Drive Folder | | Moves the Drive project folder. Host only, Drive projects only. |
| Rename Project | | Renames the project. Host only. |
| Save Now | Ctrl+S | Saves right away. Host only, and off if Save Now is disabled. |
| Clear Local Projects | | Deletes every project saved in this browser, after you confirm. Host only. |

Details: [Projects and files](projects.md) and [Saving and storage](saving-and-storage.md).

### Edit

| Item | Shortcut | What it does |
| --- | --- | --- |
| Undo | Ctrl+Z | Undoes your last typing in this file. |
| Redo | Ctrl+Shift+Z or Ctrl+Y | Redoes it. |
| Cut, Copy, Paste | Ctrl+X, Ctrl+C, Ctrl+V | The usual. The first time you choose **Paste** from the menu, the browser asks to let the page read the clipboard. If you say no, a notice tells you to use the shortcut instead. |
| Select All | Ctrl+A | Selects the whole file. |
| Settings | Ctrl+, | Opens [Settings](#settings). |

### View

| Item | Shortcut | What it does |
| --- | --- | --- |
| Toggle Editor Theme | | Cycles the app and editor theme: dark, light, system. |
| Toggle Preview Theme | | Cycles the preview theme the same way. |
| Pause Saving | | Stops autosave and Save Now until you turn it off. A check means saving is paused. |
| Compile Now | Ctrl+Enter | Rebuilds the preview right away. |
| Split View | | Editor and preview side by side. |
| Editor Only | | Hides the preview. |
| Preview Only | | Hides the editor. |

### Help

| Item | Shortcut | What it does |
| --- | --- | --- |
| Command Palette | Ctrl+P | Opens the [command palette](#command-palette). |
| Documentation | | Opens this site in a new tab. |
| Keyboard Shortcuts | | Opens the [keyboard shortcuts](keyboard-shortcuts.md) page. |
| Show Tour | | Runs the [first-run tour](#first-run-tour) again. |
| Report a Bug | | Opens the GitHub bug form. |
| Report a Security Issue | | Opens GitHub's private vulnerability form. |
| Request a Feature | | Opens the GitHub feature request form. |
| About | | Shows the app version and links. |

**Report a Bug** and **Request a Feature** open the GitHub issue forms in a new tab.
The bug form comes with your browser, OS, and the app version filled in.
It never includes your document, file names, or the room link, and nothing is sent until you submit the form yourself.

**Report a Security Issue** opens GitHub's private [Report a vulnerability](https://github.com/PrestonHager/LaTeXCollaborativeEditor/security/advisories/new) form instead.
Only the maintainers see what you send there, so use it for anything that could hurt other people if it were posted publicly.
The [security policy](https://github.com/PrestonHager/LaTeXCollaborativeEditor/blob/main/SECURITY.md) says what to include.

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

Press **Ctrl+P** (**⌘P** on macOS), or choose **Help > Command Palette**.
It lists every menu command with its shortcut, plus a few that only live here.
Each entry has a one-line description under it, and search matches those words too, so typing "github" finds **Report a Bug**.

![The command palette](assets/screenshots/palette-light.png#only-light)
![The command palette](assets/screenshots/palette-dark.png#only-dark)

- Type to filter.
- **Up** and **Down** move through the list.
- **Enter** runs the highlighted command.
- **Escape** or **Ctrl+P** closes it.

Commands that don't apply right now are grayed out.

Palette-only commands:

- **Switch to dark mode**, **Switch to light mode**, and **Switch to system theme** set the app, editor, and preview theme in one go. The one you're already using is hidden. The menu's theme toggles aren't in the palette, since these replace them.
- **Copy share link** does the same thing as the **Share** button.
- **Focus editor** puts the cursor back in the editor.

The Pause Saving toggle shows up as **Resume Saving** while saving is paused.

While the palette is open, other shortcuts are paused so the palette can use the keyboard.

## Settings

Open **Edit > Settings**, press **Ctrl+,** (**⌘,** on macOS), or search the palette for "settings".
Changes apply right away, so there's no save button.
**Done**, the X, or **Escape** close it.

![The settings dialog](assets/screenshots/settings-light.png#only-light)
![The settings dialog](assets/screenshots/settings-dark.png#only-dark)

- **App and editor theme** and **Preview theme**: match system, dark, or light.
- **Pause saving**: same as **View > Pause Saving**. It stops autosave and **Save Now** until you turn it off, then saves what changed.
- **Google Drive**: who's signed in, like "Signed in as you@example.com", or "Not connected".
- **Keyboard shortcuts**: every command with its keybinds. See [Changing shortcuts](keyboard-shortcuts.md#changing-shortcuts).
- **Clear local projects**: deletes every project saved in this browser, after asking first.

Guests can change themes and shortcuts, but the saving options are turned off since the host decides how the project is saved.

## Themes

- **Toggle Editor Theme** cycles dark, light, and system for the app and the editor. System follows your computer's light or dark setting.
- **Toggle Preview Theme** does the same for the preview only, so you can mix, like a dark editor with a light preview.
- As the host, your theme choices are remembered in this browser. Guests' choices only last until they close the tab.

## Layout modes

Under **View**:

- **Split View**: editor and preview side by side. Drag the splitter between them to resize, from 20% to 80%. You can also focus the splitter with **Tab** and use the left and right arrow keys.
- **Editor Only**: hides the preview.
- **Preview Only**: hides the editor.

The active layout has a check mark in the menu.

## Header status pills

The three pills at the top right are connection, compile, and autosave.

- Connection: see [Connection status](collaboration.md#connection-status).
- Compile: see [Live preview](editing-and-preview.md#live-preview).
- Autosave: see [Autosave and Save Now](saving-and-storage.md#autosave-and-save-now). When you're signed in to Drive, hover it to see the account.

Every message they can show is in [Status and error messages](messages.md).

## Footer

The footer shows [preview diagnostics](editing-and-preview.md#diagnostics) on the left.
On the right are links to the Privacy policy, the Terms of Service, and the repository.

## Related topics

- [Keyboard shortcuts](keyboard-shortcuts.md)
- [Projects and files](projects.md)
