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
| **New File** | **Ctrl+N**, or ***Alt+N*** | **⌘N**, or ***⌥⌘N*** |
| **New Project** (after you confirm, host only) | **Ctrl+Shift+N**, or ***Alt+Shift+N*** | **⇧⌘N**, or ***⌥⇧⌘N*** |
| **Open Local Project** (host only) | **Ctrl+O** | **⌘O** |
| **Open from Google Drive** (host only) | **Ctrl+Shift+O** | **⇧⌘O** |
| **Download Project .zip** | **Ctrl+Shift+S** | **⇧⌘S** |
| **Export…** | **Ctrl+Shift+E**, or ***Alt+Shift+E*** | **⇧⌘E** |
| **Save Now** (host only, unless saving is paused) | **Ctrl+S** | **⌘S** |

Where the browser keeps a key for itself, the second key in **bold italics** is used instead, and the menus show it.
It works everywhere, so you can always use it.
See [Keys your browser keeps](#keys-your-browser-keeps).

**Ctrl+N** used to be **New Project**. It's **New File** now, and **New Project** moved to **Ctrl+Shift+N**, since it replaces the whole project.
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

## Autocompletion

These work while you type in the editor. See [Autocompletion](editing-and-preview.md#autocompletion).

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Open the completion list | **Ctrl+Space** | **⌃Space**, **⌥`** or **⌥I** |
| Accept the highlighted completion | **Enter** | **↩** |
| Move through the list | **↑** / **↓**, **Page Up** / **Page Down** | **↑** / **↓**, **Page Up** / **Page Down** |
| Close the list, or leave a command's placeholders | **Escape** | **Escape** |
| Next placeholder (tab stop) | **Tab** | **Tab** |
| Previous placeholder | **Shift+Tab** | **⇧Tab** |

The list opens by itself after `\` or `\begin{`.
While a command's placeholders are active, **Tab** moves between them instead of indenting.

Undo and Redo go by where focus is, like VS Code.
In the editor they undo typing in the open file.
In the **Files** panel they undo and redo file operations: create, rename, move, delete and upload.
**Edit > Undo** says which one it'll do, like **Undo Delete chapter.tex**.
See [Undoing file operations](editing-and-preview.md#undoing-file-operations).

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

- While you type in the editor, its own keys come first, like **Ctrl+]** to indent, **Ctrl+Z** to undo or **Ctrl+Space** to open the completion list.
  If you give one of those to a command, Settings warns you, and the command only runs when the editor doesn't have focus.
- Some keys belong to the browser or your computer, like **Ctrl+W** (close tab), **Ctrl+T** (new tab) and **Ctrl+N** (new window) in a browser tab, or **⌘H** (hide) on a Mac.
  Settings warns you about those, and says which key is used instead. See [Keys your browser keeps](#keys-your-browser-keeps).
- Your keybinds are saved in this browser profile, so a change in Chrome doesn't change Firefox, and each browser can have the keys that work in it.

## Keys your browser keeps

In a normal browser tab, the browser keeps a few keys for itself. The page never sees them, so the editor can't use them there:

| Browser | Keys it keeps in a tab |
| --- | --- |
| Chrome, Edge, Opera, Brave | **Ctrl+N** (new window), **Ctrl+Shift+N** (private window), **Ctrl+T**, **Ctrl+W**, **Ctrl+Shift+W**, **Ctrl+Tab**, **Ctrl+PageUp** and **Ctrl+PageDown**, and **Ctrl+Shift+T** once there's a closed tab to reopen. ⌘ instead of Ctrl on a Mac. |
| Firefox | The same, plus **Ctrl+Shift+P** (private window). **Ctrl+Shift+N** reopens a closed window. **Ctrl+Shift+E** opens the Network Monitor on Windows and Linux. |
| Safari | **⌘N**, **⇧⌘N**, **⌘T**, **⌘W**, and **⌃Tab**. |
| macOS, any browser | **⌘Q**, **⌘H**, **⌘M**, **⌘Tab**, **⌘Space**. |

So the editor picks its keys for where it's running:

- **New File** is **Ctrl+N** (**⌘N**) in its own window, and **Alt+N** (**⌥⌘N**) in a browser tab.
- **New Project** is **Ctrl+Shift+N** (**⇧⌘N**) in its own window, and **Alt+Shift+N** (**⌥⇧⌘N**) in a browser tab.
- **Export…** is **Ctrl+Shift+E** (**⇧⌘E**), and **Alt+Shift+E** in Firefox on Windows and Linux.
- Every other shortcut works in a tab in every browser.

The menus, palette, tour, and Settings show the key that works where you are.
The second keys work everywhere, so you don't have to remember which window you're in.
On a Mac they add ⌥ to ⌘, since ⌥ on its own types characters (⌥N starts ñ), and ⌃N moves the cursor down in the editor.

### Get the real Ctrl+N: install the app

When the editor runs in its own window, Chrome and Edge give it every key, Ctrl+N included.

- **Chrome**: open the editor, then **⋮ > Cast, save, and share > Install page as app** (or the install icon at the end of the address bar).
- **Edge**: **… > Apps > Install this site as an app**.
- Then open it from your Start menu, Dock, or app list. It's the same editor, with your projects and settings, in a window without tabs.
- Pressing **F11** for full screen in Chrome or Edge also gives the editor these keys, until you leave full screen.

Firefox and Safari don't give these keys to installed sites, as far as we know, so the second keys are used there.
In Firefox you can let the editor have them: open **Page Info** (the icon left of the address) **> Permissions > Override keyboard shortcuts**, and choose **Allow**.
Safari on a Mac can **File > Add to Dock**, but it isn't known to hand over **⌘N**.

### How these were checked

The Chrome keys were pressed for real (X key events, not keys sent straight to the page) in Chromium 153 on Linux, in a normal tab, an app window, and full screen.
Everything else comes from the browsers' own documentation and source, because Firefox, Safari, Windows and macOS weren't available to test.
The full list, with where each entry comes from, is in `frontend/src/app/reservedKeys.ts`.

Chrome and Edge also have an experimental [Keyboard Lock](https://developer.mozilla.org/docs/Web/API/Keyboard_API) that lets a page take these keys, but only while one part of the page is in full screen.
The editor doesn't use it.

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
