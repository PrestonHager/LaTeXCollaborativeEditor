# What's supported

This page says plainly what works today, what doesn't, and what's planned.
If you hit something that isn't listed, please open an issue.

## What works

Projects and files:

- Projects with folders, a main `.tex` file, and any other files up to 10 MB each.
- New files and folders, upload (button or drag and drop), rename, move, delete, and set main file.
- Viewing PNG, JPG, GIF, WebP, SVG, and PDF files.
- Download the project as a `.zip`, or one file at a time.
- Upload a `.zip` (like one from Overleaf) as a new project.

Editing and preview:

- A LaTeX editor with syntax highlighting, line numbers, bracket matching, and auto-closing brackets.
- A live preview in the browser, built with LaTeX.js.
- `\input` and `\include` from the main file.
- `\includegraphics` for PNG, JPG, GIF, WebP, and SVG, with `\graphicspath` and the size options `width`, `height`, `scale` and `keepaspectratio`. Sizes can be relative, like `0.5\textwidth`, or absolute, like `5cm`, `30mm`, `2in`, `72pt` or `10em`.
- Bibliographies from `.bib` files, with `\bibliography` or biblatex's `\addbibresource` and `\printbibliography`. The `plain`, `unsrt`, `abbrv`, `alpha`, `ieeetr`, `IEEEtran`, `apalike`, `plainnat`, `unsrtnat` and `abbrvnat` styles set the order, the labels (`[1]`, `[Knu84]` or `Knuth, 1984`) and the entry format. See [Bibliography](editing-and-preview.md#bibliography).
- Verbatim text and code listings, shown exactly as typed: `verbatim`, `verbatim*`, `\verb`, `\verb*`, fancyvrb's `Verbatim`, `alltt`, listings' `lstlisting`, `\lstinline` and `\lstinputlisting`, and minted's `minted`, `\mintinline` and `\inputminted` (no `-shell-escape` needed), plus environments the document makes with `\lstnewenvironment`, `\newminted` or `\DefineVerbatimEnvironment`. The options `caption`, `label`, `title`, `numbers` (`linenos` for minted), `firstnumber`, `firstline`, `lastline`, `gobble` and `autogobble` work, and `\ref` to a listing's label gives its number. Listing files are read from the project.
- Errors with the file and line they came from.

Collaboration:

- Live editing with others through a share link, peer to peer over WebRTC.
- The whole project is shared, including images, which go straight between browsers.
- The host can reload and keep the same link, or make a new link to drop everyone.

Saving:

- Autosave to this browser (IndexedDB).
- Autosave to Google Drive, as a real folder with real files, if the site has Google keys set up.
- Open projects from this browser or from Drive.
- If a file changed in Drive since your last save, the app asks before it overwrites it.
- Sign out of Drive with **File > Disconnect Google Drive**, and keep saving in this browser.
- Old documents from before projects open as one-file projects.

Look and feel:

- Light, dark, and system themes, set apart for the app and the preview.
- Split, editor-only, and preview-only layouts.
- A command palette and keyboard shortcuts.

## What doesn't work

These are known limits right now.

- **It's not real LaTeX.** The preview is LaTeX.js, which covers common commands and environments, but not every package. A document that works here might not build with `pdflatex`, and the other way around. There's no PDF output.
- **PDF and EPS figures don't show in the preview.** The preview puts a note in their place. The file viewer can still show PDFs. Convert figures to PNG or SVG if you want them in the preview.
- **Code listings have no syntax colors.** The preview shows the code exactly, in a plain monospaced box. Style options like `basicstyle`, `frame` or a minted style are ignored.
- **The bibliography is close, not exact.** The preview copies the common BibTeX styles itself instead of running BibTeX, so small details can differ. Other styles fall back to `plain` with a note. Citations aren't compressed or merged (no `[1-3]` or `1984a,b`), and biblatex options other than `style` and `sorting=none` are ignored.
- **Files added to a Drive project folder from Drive itself don't show up.** The app only has permission to see files it made or that you picked. Upload files from the editor instead.
- **There's no undo for file operations.** Undo only covers typing. Deleting, renaming, or moving a file can't be undone from the app.
- **Undo history is per file and only lasts until you switch files.** Opening another file starts a fresh undo history.
- **Files over 10 MB** can't be uploaded or sent to peers.
- **Guests can't save.** Only the host's browser saves the project. If the host closes their tab, guests keep their copy but nothing new gets saved until the host comes back.
- **Very strict networks** may block the peer connection unless the site has a TURN server.
- **Drive needs setup.** Drive only works on a copy of the site that has Google keys.
- **Zip64 archives** and zips using unusual compression can't be read.
- **No comments, track changes, or chat.**
- **No offline mode.** The editor works once loaded, but the preview's fonts and styles come from a CDN.

## What's planned

These are ideas that are tracked or talked about.
None of them are promised for a date.

- A real compile step with a TeX engine, with its own docs and UI (issue #43).
- In-app help links, a first-run tour, and a toolbar (issue #45).
- An "add files from Drive" picker, so files added in Drive can be brought in.
- Bug report and feature request forms (issue #42).

## Browsers

The app is built for recent desktop versions of Chrome, Edge, Firefox, and Safari.
It needs WebRTC, IndexedDB, and `CompressionStream` (for zips), which all of those have.
Phones and tablets can view and type, but the layout is built for a desktop screen.
The site has to be served over HTTPS for collaboration and the clipboard to work.
