# Interface and layout

## Menu bar

| Menu | Typical actions |
|------|------------------|
| **File** | New, open (local or Drive), download, Drive connect/save/move/rename, Save Now, clear local docs |
| **Edit** | Undo, redo, cut, copy, paste, select all, **Settings** |
| **View** | Toggle **editor** theme, toggle **preview** theme, toggle autosave / Save Now, **Compile Now**, layout modes |
| **Help** | Command palette, **Documentation** (this site), link to the **repository** |

Some File entries are **disabled** when you are a **guest** in a shared room (`?room=` in the URL).

## Command palette

Press **Ctrl+P** on Windows/Linux or **⌘+P** on macOS to open the **command palette**. It lists the menu commands, with shortcut hints, plus a few that only live in the palette. Type to filter, then choose an action.

Palette-only commands:

- **Switch to dark mode**, **Switch to light mode**, and **Switch to system theme** set the app, editor, and preview theme in one go. The one you're already using is hidden. (The menu's theme toggles aren't in the palette, since these replace them.)
- **Rename document** does the same thing as clicking the title.
- **Copy share link** does the same thing as the **Share** button.
- **Focus editor** puts the cursor back in the editor.

While the palette is open, other global shortcuts are not handled so the palette can use the keyboard.

## Settings

Open **Edit > Settings**, press **Ctrl+,** (**⌘+,** on macOS), or search the palette for "settings".
Changes apply right away, there's no save button.

- **App and editor theme** and **Preview theme**: match system, dark, or light.
- **Disable Save Now**: same as the View menu toggle.
- **Clear local docs**: deletes every document saved in this browser, after asking first.

Guests in a shared room can change themes, but the saving options are turned off since the host decides how the document is saved.

## Themes

- **Toggle Editor Theme** cycles **dark → light → system** for the chrome and editor styling. **System** follows your OS light/dark preference.
- **Toggle Preview Theme** does the same for the preview pane only, so you can mix—for example a dark editor and a light preview.

## Layout modes

Under **View**:

- **Split View** — editor and preview side by side; drag the **splitter** to change the ratio (within sensible bounds).
- **Editor Only** — maximizes source editing; preview is hidden.
- **Preview Only** — maximizes the rendered view; editor is hidden.

The active layout mode is indicated with a check mark in the menu.

## Header status pills

Use **Connection**, **Compile**, and **Autosave** (or related text) as quick reads on what the app is doing. Details for each are covered in [Collaboration](collaboration.md), [Editing and preview](editing-and-preview.md), and [Saving and storage](saving-and-storage.md).

## Related topics

- [Keyboard shortcuts](keyboard-shortcuts.md)  
