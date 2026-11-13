# Getting started

## Open the app

Go to the address where the editor is hosted, like your team's GitHub Pages site.
The site needs HTTPS so collaboration and the clipboard work.

While the page loads, a bar under the header says "Loading the editor...". On a fast connection it is gone before you notice it.

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
- **Footer**: preview diagnostics, plus links to Privacy, Terms, the repository, and the app version.

For a diagram of how these fit together, see [How the app fits together](how-it-fits.md).

## Host vs guest

- **Host**: you opened the app without `?room=` in the address. You own the project. You can open, save, and start projects, connect Google Drive, and click **Share** to invite people.
- **Guest**: you opened a link with `?room=...`. You edit the host's project over a direct connection. You can add and edit files, but you can't open, save, or start projects. Those menu items are grayed out. The autosave pill shows where the host is saving.

## First edits

A new tab starts with a starter project: one `main.tex` with a small LaTeX skeleton.
To start from a template instead, use **File > New Project** (**Ctrl+Shift+N**, or **Alt+Shift+N** in a browser tab):

![The New project picker with the Technical report template chosen](assets/screenshots/templates-picker-light.png#only-light)
![The New project picker with the Technical report template chosen](assets/screenshots/templates-picker-dark.png#only-dark)

Pick a template on the left: an empty project, a blank article, a technical report, a letter, Beamer slides or a thesis. The right side asks for what the template needs, like the title, already filled in from your profile (**Edit > Profile…**). Press **Create project**. More in [Templates](saving-and-storage.md#templates).

The preview runs LaTeX.js, which can't do everything a real TeX can. For the built-in templates it approximates these, and lists them under the info button above the preview:

- Tables show as a note ("A table goes here"), and table floats show in place.
- `equation` and `align` show without numbers, so a reference to an equation shows `??`. Theorems and proofs show as bold and italic headings, without numbers.
- `\cref` shows as a plain reference with a name guessed from the label prefix (`sec:`, `fig:`, `tab:`, `eq:`, `ch:` and so on), like "section 1". Figures and tables are numbered like sections.
- siunitx quantities show as plain text, like 9.81 m/s².
- Beamer slides show as pages, one per frame, with the frame title in bold and no theme or overlays.
- Packages the preview can't load (`geometry`, `fontspec`) and setup commands (`\sisetup`, `\newtheorem`, `\usetheme` and the like) are skipped, so fonts, margins and paper size don't change the preview.

Compile with pdfLaTeX or LuaLaTeX (and biber, for the report and thesis) to see the real thing.


1. Type in the editor. The preview updates after a short pause.
2. Click **Untitled** at the top left and give the project a name. Now it autosaves to this browser.
3. Add files with the buttons at the top of the Files panel, or drop files onto it.
4. If something can't be shown, the footer says what and where. See [Editing and preview](editing-and-preview.md#diagnostics).

## Next steps

- [Projects and files](projects.md)
- [Sharing and collaboration](collaboration.md)
- [Keyboard shortcuts](keyboard-shortcuts.md)
