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

Rest the mouse on a menu item, or reach it with the arrow keys, and after a moment a preview card opens beside the menu.
It shows what the command does: a small picture where one helps (the layouts show how the panes are arranged, Share shows the link being copied, New File shows the new file in the list), and a sentence about it.
The card closes as soon as the mouse leaves, focus moves on, or you press a key or click.
Hovering only shows the card. The command runs only when you click it or press **Enter**.
On a touch screen there's no hover, so there's no preview card. The [command palette](#command-palette) shows the same description under each command.

![The preview card for View > Split View](assets/screenshots/hover-preview-light.png#only-light)
![The preview card for View > Split View](assets/screenshots/hover-preview-dark.png#only-dark)

### File

![The File menu](assets/screenshots/file-menu-light.png#only-light)
![The File menu](assets/screenshots/file-menu-dark.png#only-dark)

| Item | Shortcut | What it does |
| --- | --- | --- |
| New Project | Ctrl+Shift+N (Alt+Shift+N in a browser tab) | Starts a fresh project after you confirm. Host only. |
| Open Project… | Ctrl+O | Asks where the project is saved (this browser or a connected account), then lists or picks it. Host only. |
| Open from Google Drive | Ctrl+Shift+O | Opens the Drive picker. Host only. |
| Upload .zip as New Project | | Makes a new project from a `.zip`. Host only. |
| New File | Ctrl+N (Alt+N in a browser tab) | Adds a text file to the current folder. |
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
| Undo | Ctrl+Z | Undoes your last typing in this file. While the Files panel has focus or was used last, it undoes your last file operation instead, and says which, like **Undo Delete chapter.tex**. |
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
| pdfLaTeX Engine, XeLaTeX Engine, LuaLaTeX Engine | | Picks the project's [TeX engine](projects.md#tex-engine). The checked one is in use. |
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
| About | | Shows the app version, commit, and links. |

**Report a Bug** and **Request a Feature** open the GitHub issue forms in a new tab.
The bug form comes with your browser, OS, and the app version filled in.
It never includes your document, file names, or the room link, and nothing is sent until you submit the form yourself.

**Report a Security Issue** opens GitHub's private [Report a vulnerability](https://github.com/PrestonHager/LaTeXCollaborativeEditor/security/advisories/new) form instead.
Only the maintainers see what you send there, so use it for anything that could hurt other people if it were posted publicly.
The [security policy](https://github.com/PrestonHager/LaTeXCollaborativeEditor/blob/main/SECURITY.md) says what to include.

**About** shows the app version, the commit it was built from (linked to GitHub), and the build date, with links to the docs, the source code, and the policies.
Include the version when you report a problem. The bug form fills it in for you.
**View changelog** in About opens **What's new**: the changelog for this build, newest first. "Unreleased (in this build)" is at the top, and the version you're on says "You're on this version". Esc or Close goes back to About.

## Toolbar

The row of icon buttons under the menus covers the things you do most: new file, upload, save now, compile now, share, the three layout modes, the command palette, and the docs.
Hover a button (or focus it) to see what it does and its shortcut.
Keep the mouse there a little longer, or stay on it with the keyboard, and the tooltip turns into the same preview card as the menus, under the button.
On a touch screen, hold your finger on a button to see its name and shortcut. Holding doesn't run it.
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
On a window 1024px or wider, it's two columns: the settings on the left and keyboard shortcuts on the right.

![The settings dialog](assets/screenshots/settings-light.png#only-light)
![The settings dialog](assets/screenshots/settings-dark.png#only-dark)

- **App and editor theme** and **Preview theme**: match system, dark, or light.
- **Pause saving**: same as **View > Pause Saving**. It stops autosave and **Save Now** until you turn it off, then saves what changed.
- **Google Drive**: who's signed in, like "Signed in as you@example.com", or "Not connected".
- **Keyboard shortcuts**: every command with its keybinds. See [Changing shortcuts](keyboard-shortcuts.md#changing-shortcuts).
- **Your settings**:
  - **Export settings** downloads your themes, layout and shortcuts as a `.json` file.
  - **Import settings** loads such a file. Settings it doesn't know, or values that don't fit, are skipped, and the dialog says which.
  - **Reset to defaults** resets all settings, or just themes, layout, keyboard shortcuts, or the tour (so it shows again). Click it twice: the first click turns it red and says **Click again to reset**.
- **Clear local projects**: deletes every project saved in this browser, after asking first.

Your settings are saved in this browser and shared with its other open tabs, for guests as well as hosts. They're never sent to people in your room. See [Your settings](saving-and-storage.md#your-settings).

Guests can change themes, layout and shortcuts, but the saving options are turned off since the host decides how the project is saved.

## Themes

- **Toggle Editor Theme** cycles dark, light, and system for the app and the editor. System follows your computer's light or dark setting.
- **Toggle Preview Theme** does the same for the preview only, so you can mix, like a dark editor with a light preview.
- Your theme choices are remembered in this browser, whether you're the host or a guest, and your other open tabs switch too.

## Layout modes

Under **View**:

- **Split View**: editor and preview side by side. Drag the splitter between them to resize, from 20% to 80%, with the mouse or a finger. You can also focus the splitter with **Tab** and use the left and right arrow keys.
- **Editor Only**: hides the preview.
- **Preview Only**: hides the editor.

The active layout has a check mark in the menu.
The layout and the splitter position are remembered in this browser, like your other [settings](saving-and-storage.md#your-settings).

## On a phone

When the window is narrower than 640px, like on most phones, the app shows one pane at a time instead of the split:

- A bar under the toolbar has **Files**, then **Editor** and **Preview**. Tap Editor or Preview to switch. The pane you picked stays picked when you reload, until you close the tab.
- **Files** opens the file list as a drawer over the editor. Picking a file closes the drawer and shows that file in the editor. Tap outside the drawer, tap Files again, or press **Esc** to close it without picking.
- **View > Editor Only** and **Preview Only** pick the pane too. The Split View, Editor Only and Preview Only toolbar buttons are hidden, since the bar does their job.
- The buttons in the bar are 44px tall, so they're easy to tap.
- **File**, **Edit**, **View** and **Help** become one **Menu** button. Its menu fills the width of the window and has every item from the four menus, in the same order, under a **File**, **Edit**, **View** or **Help** heading. It scrolls if it's taller than the window.
- The toolbar keeps **Compile now** and **Share and copy link**. **New file**, **Upload files**, **Save now**, **Export**, **Command palette** and **Documentation** move into the **More actions** menu (the **⋯** button at the right end of the toolbar). The toolbar buttons and menu items are 44px tall.

With a keyboard, **Tab** reaches Files, Editor and Preview, and Enter or Space presses them. Screen readers announce Editor and Preview as toggle buttons, and Files as expanded or collapsed.

**Menu** and **More actions** work like the menus on a wider screen. Enter, Space or **Down** opens one on its first item. **Up** and **Down** move through the items, skipping grayed-out ones, and **Home** and **End** jump to the first and last. **Escape** closes the menu and puts focus back on its button. In the toolbar, **Left** and **Right** move between Compile now, Share and More actions. Screen readers announce each part of **Menu** as a group named File, Edit, View or Help when you move into it.

Tablets and wider windows keep the layout above.

- Dialogs like Settings, Upload, Export and Open a project fill the screen as a sheet: the title at the top, the buttons at the bottom, and the middle scrolls. Short questions stay a small card.

| Editor | Preview | Files |
|--------|---------|-------|
| ![The editor on a phone, with the Files, Editor and Preview bar above it](assets/screenshots/phone-editor-light.png#only-light)![The editor on a phone, with the Files, Editor and Preview bar above it](assets/screenshots/phone-editor-dark.png#only-dark) | ![The preview on a phone, at Fit width](assets/screenshots/phone-preview-light.png#only-light)![The preview on a phone, at Fit width](assets/screenshots/phone-preview-dark.png#only-dark) | ![The file list open as a drawer over the editor](assets/screenshots/phone-files-light.png#only-light)![The file list open as a drawer over the editor](assets/screenshots/phone-files-dark.png#only-dark) |

| Menu | More actions | Settings |
|------|--------------|----------|
| ![The Menu button's menu on a phone, with File, Edit, View and Help items under headings](assets/screenshots/phone-menu-light.png#only-light)![The Menu button's menu on a phone, with File, Edit, View and Help items under headings](assets/screenshots/phone-menu-dark.png#only-dark) | ![The toolbar's More actions menu on a phone](assets/screenshots/phone-more-light.png#only-light)![The toolbar's More actions menu on a phone](assets/screenshots/phone-more-dark.png#only-dark) | ![Settings as a full-screen sheet on a phone](assets/screenshots/phone-settings-light.png#only-light)![Settings as a full-screen sheet on a phone](assets/screenshots/phone-settings-dark.png#only-dark) |

| Share |
|-------|
| ![The Share popover on a phone, before sharing starts](assets/screenshots/phone-share-light.png#only-light)![The Share popover on a phone, before sharing starts](assets/screenshots/phone-share-dark.png#only-dark) |

## On a tablet

From 640px wide, like a tablet in either orientation, the app keeps the desktop layout: File, Edit, View and Help, the full toolbar, and the files, editor and preview side by side.
With a finger as the pointer, menu items and buttons are 44px tall (see [On a touch screen](#on-a-touch-screen)), so a long menu stops above the bottom of the screen and scrolls.
Dialogs are cards, and Settings is one column below 1024px wide.

| Main screen | Settings | Share |
|-------------|----------|-------|
| ![The app on a 768 by 1024 tablet, with files, editor and preview side by side](assets/screenshots/tablet-overview-light.png#only-light)![The app on a 768 by 1024 tablet, with files, editor and preview side by side](assets/screenshots/tablet-overview-dark.png#only-dark) | ![Settings on a tablet](assets/screenshots/tablet-settings-light.png#only-light)![Settings on a tablet](assets/screenshots/tablet-settings-dark.png#only-dark) | ![The Share popover on a tablet](assets/screenshots/tablet-share-light.png#only-light)![The Share popover on a tablet](assets/screenshots/tablet-share-dark.png#only-dark) |

An automated check opens every dialog and menu at 360×640, 390×844, 768×1024 and 1024×768 and fails if anything runs off the screen or the page scrolls sideways.

## On a touch screen

On phones and tablets (anything with a finger or stylus as its main pointer):

- Buttons, menu items, file rows and links are at least 44px tall, so they're easy to tap.
- Hold a finger on a file or folder for half a second to open its menu: **Set as main file**, **Rename or move** and **Delete**. On a phone the menu opens at the bottom of the screen.
- Hold a finger on a toolbar button to see its name and shortcut. Tapping runs it, and leaves no tooltip behind.
- The splitter between the editor and the preview drags with a finger, and you don't have to hit the thin bar exactly.
- There are no hover preview cards. The [command palette](#command-palette) lists each command with what it does.

## Header status pills

The three pills at the top right are connection, compile, and autosave.

- Connection: see [Connection status](collaboration.md#connection-status).
- Compile: see [Live preview](editing-and-preview.md#live-preview).
- Autosave: see [Autosave and Save Now](saving-and-storage.md#autosave-and-save-now). When you're signed in to Drive, hover it to see the account.

Every message they can show is in [Status and error messages](messages.md).

## Footer

The footer shows [preview diagnostics](editing-and-preview.md#diagnostics) on the left.
On the right are links to the Privacy policy, the Terms of Service, and the repository, then the app version, like `v0.1.0`.
Hover the version to see the commit and build date, or click it to open that commit on GitHub.

## Related topics

- [Keyboard shortcuts](keyboard-shortcuts.md)
- [Projects and files](projects.md)
