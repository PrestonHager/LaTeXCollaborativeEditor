# Saving and storage

## Autosave and “Save Now”

When you are the **host** and not only a guest in someone else’s room, the app can **autosave** through the active storage provider.

- The **autosave** line in the header tells you whether autosaving is active and often names the provider (for example local storage or Google Drive).
- **Save Now** (File menu or shortcut) forces a save when autosave is enabled. You can **disable Save Now / autosave** from the **View** menu when you want to experiment without writing back immediately (menu label toggles accordingly).

Guests in a `?room=…` session see the host’s storage context in the status area; they do not reconfigure Drive or local libraries for that session.

## Local storage (browser)

The app can keep **named documents** in the browser’s **local storage** area for this origin.

- **Open Local** lists saved names and opens one you pick.
- **Clear Local Docs** removes stored local documents (use with care).

Local data is **per browser, per site**. Clearing site data in the browser or using another device will not carry those files over.

## Download `.tex`

**Download .tex** saves the current buffer to a file on your machine. You will be prompted for a **document name** if it is still **Untitled**. The download uses a `.tex` extension.

## Google Drive

If the deployment includes Google Picker credentials, you can:

1. **Connect Google Drive** — sign in and establish a session with Drive.
2. **Open from Google Drive** — pick an existing `.tex` (or compatible) file.
3. **Save to Google Drive** — saves the current document (you need a real title, not only “Untitled”).
4. **Move to Drive Folder** / **Rename in Drive** — when a Drive file is already open, organize or rename it from the picker flow.

If **Connect** or **Open** fails, check the status message in the header (for example missing API key on that deployment). Guests cannot open their own Drive file into the host’s room from the File menu; the shared document is the host’s session.

## New document

**New** resets to a starter LaTeX template after confirmation. Unsaved work in the buffer is replaced—use Download or Save first if you need a copy.

## Related topics

- [Getting started](getting-started.md)  
- [Collaboration](collaboration.md)  
