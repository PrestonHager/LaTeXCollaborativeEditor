# Getting started

## Open the app

Go to the address where the editor is hosted, like your team's GitHub Pages site.
The site needs HTTPS so collaboration and the clipboard work.

While the page loads, a bar under the header says "Loading compiler assets...".

## Main areas of the screen

![The main screen with each area labeled](assets/screenshots/overview-light.png#only-light)
![The main screen with each area labeled](assets/screenshots/overview-dark.png#only-dark)

- **Project name** (top left): click it to rename the project.
- **Menu bar**: File, Edit, View, and Help. The same commands are in the [command palette](interface-layout.md#command-palette).
- **Share** and **New link**: make and reset the collaboration link. See [Sharing and collaboration](collaboration.md).
- **Notice**: short messages next to Share, like "Share link copied to clipboard".
- **Status pills**: connection, compile, and autosave. See [Status and error messages](messages.md).
- **Files panel** (left): the project's file tree. See [Projects and files](projects.md).
- **Editor** (middle): the open text file. Images and PDFs open in a viewer here instead.
- **Preview** (right): the rendered document.
- **Splitter**: drag the bar between the editor and preview to resize them.
- **Footer**: preview diagnostics, plus links to Privacy, Terms, and the repository.

For a diagram of how these fit together, see [How the app fits together](how-it-fits.md).

## Host vs guest

- **Host**: you opened the app without `?room=` in the address. You own the project. You can open, save, and start projects, connect Google Drive, and click **Share** to invite people.
- **Guest**: you opened a link with `?room=...`. You edit the host's project over a direct connection. You can add and edit files, but you can't open, save, or start projects. Those menu items are grayed out. The autosave pill shows where the host is saving.

## First edits

A new tab starts with a starter project: one `main.tex` with a small LaTeX skeleton.

1. Type in the editor. The preview updates after a short pause.
2. Click **Untitled** at the top left and give the project a name. Now it autosaves to this browser.
3. Add files with the buttons at the top of the Files panel, or drop files onto it.
4. If something can't be shown, the footer says what and where. See [Editing and preview](editing-and-preview.md#diagnostics).

## Next steps

- [Projects and files](projects.md)
- [Sharing and collaboration](collaboration.md)
- [Keyboard shortcuts](keyboard-shortcuts.md)
