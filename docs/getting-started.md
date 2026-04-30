# Getting started

## Open the app

Use the URL where the editor is hosted (for example your team’s GitHub Pages site or a custom domain). The app needs **HTTPS** in production so the browser can use real-time collaboration features reliably.

## Main areas of the screen

| Area | Purpose |
|------|--------|
| **Title** | Shows the current document name. |
| **Menu bar** | File, Edit, View, and Help actions (same actions appear in the command palette). |
| **Share** | Creates a collaboration link for the current room (see [Sharing and collaboration](collaboration.md)). |
| **Connection / compile / autosave** | Short status labels for networking, preview build, and saving. |
| **Editor** | Your LaTeX source. |
| **Preview** | Rendered output in a sandboxed view. |
| **Splitter** | In split layout, drag the vertical bar to change how much space the editor and preview use. |
| **Footer** | Diagnostics when the preview reports issues; links to Privacy, Terms, and the repository. |

## Host vs guest

- **Host (normal tab)**  
  You opened the app **without** a `room` parameter in the address bar. You can use **File** actions such as opening local documents, connecting Google Drive, and clearing local storage (see [Saving and storage](saving-and-storage.md)). You start or continue a session and can use **Share** to invite others.

- **Guest (joined room)**  
  You opened a link that includes **`?room=…`**. You edit the same document as the host over a peer connection. File operations that change **your** Drive or **your** local document list are turned off, because the session follows the host’s document. The status line may show that you are using the host’s storage context.

## First edits

The editor starts with a small LaTeX skeleton. Type in the left pane; the preview on the right updates after a brief pause. If something cannot be processed for preview, a message may appear in the footer (see [Editing and preview](editing-and-preview.md)).

## Next steps

- [Editing and preview](editing-and-preview.md)  
- [Sharing and collaboration](collaboration.md)  
- [Keyboard shortcuts](keyboard-shortcuts.md)
