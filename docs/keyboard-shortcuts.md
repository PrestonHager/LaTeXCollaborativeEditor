# Keyboard shortcuts

Shortcuts use **Ctrl** on Windows and Linux, and **⌘** (Command) on macOS, iPhone, and iPad.
The menus, toolbar tooltips, command palette, and tour show the right one for your computer, with the Mac symbols on a Mac: **⌘** Command, **⇧** Shift, **⌥** Option, **⌃** Control, and **↩** Return.
On Windows and Linux, the Windows key doesn't count as Ctrl.
Shortcuts match exactly, so **Ctrl+Shift+S** downloads the project and never also saves it.

While the command palette is open, the other app shortcuts are paused.
A shortcut for a grayed-out command does nothing, for example **Ctrl+S** when you're a guest.

## General

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Open or close the **command palette** | **Ctrl+P** | **⌘P** |
| Open **Settings** | **Ctrl+,** | **⌘,** |

## File

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| **New File** | **Ctrl+N** | **⌘N** |
| **New Project** (after you confirm, host only) | **Ctrl+Shift+N** | **⇧⌘N** |
| **Open Local Project** (host only) | **Ctrl+O** | **⌘O** |
| **Open from Google Drive** (host only) | **Ctrl+Shift+O** | **⇧⌘O** |
| **Download Project .zip** | **Ctrl+Shift+S** | **⇧⌘S** |
| **Export…** | **Ctrl+Shift+E** | **⇧⌘E** |
| **Save Now** (host only, unless saving is paused) | **Ctrl+S** | **⌘S** |

### New File and New Project in a browser tab

**Ctrl+N** used to be **New Project**. It's **New File** now, and **New Project** moved to **Ctrl+Shift+N**, since it replaces the whole project.

In a normal browser tab, Chrome, Edge, and Firefox usually keep **Ctrl+N** (new window) and **Ctrl+Shift+N** (new private window) for themselves, so the editor never sees them and a new window opens instead.
They do reach the editor when it runs in its own app window, which Chrome and Edge can make for any site: use **Create shortcut** with **Open as window** ticked, or **Install this site as an app**.
If they don't work for you, use **File > New File** or the **New file** button in the Files panel, or give them other keys in **Settings > Keyboard shortcuts**.

If you had turned **Ctrl+N** off, it stays off, now for **New File**. Keybinds you added keep working, even on these keys.

## Edit

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| **Undo** | **Ctrl+Z** | **⌘Z** |
| **Redo** | **Ctrl+Shift+Z** | **⇧⌘Z** |
| **Redo** (other key) | **Ctrl+Y** | **⌘Y** |
| **Cut** | **Ctrl+X** | **⌘X** |
| **Copy** | **Ctrl+C** | **⌘C** |
| **Paste** | **Ctrl+V** | **⌘V** |
| **Select all** | **Ctrl+A** | **⌘A** |
| Indent | **Tab** | **Tab** |

## View

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| **Compile Now** (refresh the preview) | **Ctrl+Enter** | **⌘↩** |

**Compile Now** used to be **Ctrl+Shift+C**, but Chrome and Edge open the element inspector on that key.
In the editor, **Ctrl+Enter** compiles instead of inserting a blank line.

## Changing shortcuts

Open **Edit > Settings** and scroll to **Keyboard shortcuts**.
It lists every command, with its keybinds next to it.

- **Add a keybind**: press **+** next to the command, then press the keys you want.
  A command can have as many keybinds as you like.
  **Escape** stops without adding one.
- Keybinds need **Ctrl**, **Alt**, or **⌘** (or **⌥** or **⌃** on a Mac), so plain typing always reaches the editor.
  **F1** to **F12** work on their own.
- **Turn off a built-in keybind**: press the **×** on it. It stays in the list, crossed out, with a **Turn on** button.
  Press **×** on a keybind you added to remove it.
- **Search** by command name, menu, what it does, or key, like "save" or "Ctrl+S".
- **Reset to defaults** asks first, then removes every keybind you added and turns the built-in ones back on.

Your keybinds are saved in this browser, apart from your projects, along with your other [settings](saving-and-storage.md#your-settings). Your other open tabs pick up a change right away, and **Settings > Export settings** lets you take them to another browser.
They're stored with a "main modifier" instead of Ctrl or ⌘, so a keybind you add on Windows shows as ⌘ on a Mac.

The menus, toolbar tooltips, command palette, and tour all show your keybinds as soon as you add them.

### When two commands want the same key

A warning shows under both commands, and says which one runs now.
A keybind you added wins over a built-in one, and a newer one wins over an older one.
Press **Use it here** or **Give it to ...** to pick, and the other command's keybind gets turned off.

### Keys the editor or browser keeps

- While you type in the editor, its own keys come first, like **Ctrl+]** to indent or **Ctrl+Z** to undo.
  If you give one of those to a command, Settings warns you, and the command only runs when the editor doesn't have focus.
- Some keys belong to the browser, like **Ctrl+W** (close tab), **Ctrl+T** (new tab), **Ctrl+N** (new window), and **Ctrl+Shift+C** (inspector), and pages can't take them in a normal tab.
  Settings warns you about those too.

## Menus and the palette

- In the menu bar, **Left** and **Right** move between menus, **Down**, **Enter**, or **Space** open one, and **Up** and **Down** move through its items.
- **Escape** closes a menu, a dialog, or the command palette. The save conflict dialog is the exception, you have to pick a button.
- In the palette, **Up** and **Down** pick a command and **Enter** runs it.

## Moving around without a mouse

- **Tab** first lands on a **Skip to editor** link, which jumps straight into the editor.
- In the menu bar, the arrow keys move between menus and items, and Esc closes the menu.
- In the toolbar, the arrow keys move between buttons, and **Home** and **End** jump to the ends.
- The splitter between the editor and preview moves with the left and right arrow keys once it has focus.
- Closing a dialog or the command palette puts focus back where you were.
- **Edit > Paste** asks the browser to read the clipboard. If the browser says no, a notice tells you to press **Ctrl+V** (**⌘V**) instead.
- During the first-run tour, Esc skips it.

## Menu-only actions

These don't have shortcuts.
Use the menus or the command palette.

- New Folder, Upload Files, Download Current File, and Upload .zip as New Project.
- Connect Google Drive, Disconnect Google Drive, Save to Google Drive, Move to Drive Folder, Rename Project, and Clear Local Projects.
- The theme toggles, the layout modes, and Pause Saving.
- The **Help** menu items: Keyboard Shortcuts, Show Tour, Report a Bug, Report a Security Issue, Request a Feature, and About.

## Related topics

- [Interface and layout](interface-layout.md)
