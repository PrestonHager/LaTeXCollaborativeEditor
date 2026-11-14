# Changelog

All notable changes to this project are written down here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [docs/versioning.md](docs/versioning.md) for how to bump the version and cut a release.

## [Unreleased]

### Added

- **Preview cards on hover.** Rest the mouse on a menu item or toolbar button, or reach it with the keyboard, and after a moment a card shows what it does: a small picture for things like the layouts, Share, New File and Export, and the same description as the command palette. It hides as soon as you move away, and hovering never runs anything. Touch screens don't show it.
- **Project templates.** File > New Project opens a template picker: an empty project, a blank article, a technical report, a letter, Beamer slides and a thesis with chapters, plus your own templates. File > Save as Template saves any project, with all its files, as a template in this browser or in a `Templates` folder in Google Drive. Templates can be edited, renamed, deleted, and shared as a `.zip`. The built-in templates use current packages (microtype, csquotes, siunitx, biblatex, cleveref and friends), each with a comment saying why it's there.
- **Your profile fills in templates.** Edit > Profile… keeps your name, affiliation, email, ORCID iD, address, language and paper size, and templates fill `{{name}}`, `{{email}}` and the rest from it, escaped so special characters print as typed. It's saved in this browser and, with Drive connected, in your Drive `Templates` folder. It's never sent to people in your room, and Clear profile removes it everywhere. The same dialog edits the name people in a shared room see.
- The preview now handles more of what modern documents use, instead of stopping with an error: `\cref`, `\enquote`, siunitx quantities, `equation` and `align` (without numbers), theorems and proofs, the `appendices` environment, and Beamer slides (one page per frame). Tables show a note in their place. Each approximation is listed under the preview's info button.

- **What's new.** Help → About → View changelog shows this changelog in the app, newest first, and marks the version you're on. The update prompt's What's new shows the new version's changelog, with what's new in it marked.
- **Update prompt.** When a new version is deployed, a small card offers to reload. It saves your changes first, and won't reload if the save fails. It also shows when a collaborator is on a newer, incompatible version.
- **Export dialog.** File > Export… (Ctrl+Shift+E, also on the toolbar and in the palette) saves the project as a `.zip`, a preview-quality PDF through the browser's print dialog, a standalone HTML file that works offline, a flattened `.tex` with every `\input` and `\include` in place, or a single file. It shows progress, can be canceled, and runs entirely in the browser. Formats come from a registry, so new ones are easy to add.
- **Install the editor as an app.** Chrome and Edge can install it (it now has a web app manifest and icons) and open it in its own window, where Ctrl+N and Ctrl+Shift+N work. Browser full screen (F11) does the same. How-to in the Keyboard shortcuts docs.
- The preview shows verbatim text and code listings (`verbatim`, `\verb`, `lstlisting`, `\lstinputlisting`, `minted`, `\inputminted`, `alltt` and more) exactly as typed, with captions, line numbers and `\ref` to listings, instead of stopping with an error. There are no syntax colors yet.
- `\newpage`, `\clearpage` and `\pagebreak` on their own line now break the page when the preview is printed or exported as PDF.
- **Export to Google Drive.** The Export dialog has a **Save to** menu next to the **Format** menu: Download or Google Drive. It remembers your choice. Drive uploads go to an `exports` folder in the project's Drive folder (or the top of My Drive for a project that isn't in Drive), or to a folder you pick, and show a bar while they upload and a link to the file when done. If you aren't signed in, Export signs you in first. Guests can't use the host's Drive, and PDF can't go to Drive since it goes through the print dialog; the dialog says so.
- **Staging site.** Every change to `main` now goes to a separate staging site first, marked with a small **Staging** badge next to the project name. Its projects, settings and shared sessions are separate from the live site, and search engines don't index it.
- **PDF figures show in the preview.** `\includegraphics{plot.pdf}` draws the page with pdf.js, at its own size or the size you give, with `page=`, `trim`, `viewport` and `clip`. pdf.js only loads when a document has a PDF figure. EPS figures, which the browser can't draw, show as an empty box of the right size with a hint to convert them to PDF.
- **See who's in a shared room.** While sharing, avatars next to Share show everyone in the room, with a tooltip naming them and the file they have open. Their cursors and selections show in the editor with their name, and a dot in their colour marks their file in the file tree. Click someone's avatar to jump to their file and cursor. Click your own to change your name; until you do, you get an anonymous animal name. Only your name and cursor are shared, and peers on older builds still sync.
- **Page breaks show in the preview and the HTML export.** `\newpage`, `\clearpage` and `\pagebreak` now show as a dashed line labeled "page break". The line isn't printed, and printing still starts a new page there.

- **Undo file operations.** Creating, renaming, moving, deleting and uploading files and folders, and Add Files from Drive, can be undone and redone. Press Ctrl+Z in the Files panel, use Edit > Undo (it says what it'll undo, like "Undo Delete chapter.tex"), or click **Undo** in the notice after a delete, rename or move. Typing keeps its own undo in the editor. Only your own changes are undone, a file someone else has typed in since is never removed, deleted images come back too, and a file that comes back where someone made a new one is named "name (restored)". In Drive, the same file comes out of the trash instead of a copy being made.

- **Desktop app (experimental).** A first native build for Windows, macOS and Linux, made with Tauri around the same app as the website. It isn't signed or published yet: maintainers can build it from the **Desktop app** workflow. In the app, Ctrl+N, Ctrl+W and the other keys browsers keep for tabs work like in an installed web app. Google Drive sign-in and joining shared rooms on Linux don't work in it yet.

### Changed

- **File > New Project** opens the template picker instead of a confirm box. **Empty project** is still first, and the picker warns when it would replace the project for people in your room.
- Figures with placement options like `[htbp]` no longer show the options as text in the preview, and a `\newpage` right after a list now breaks the page. A commented-out `\includegraphics` is no longer reported as a missing file.
- **Your colour in a shared room stays the same when you reload,** and two people in a room no longer get the same colour (up to eight people): whoever joined later gets the next free one. A remote cursor's name label on the first line now shows below the cursor instead of being cut off.
- **The live site only changes with a release.** It updates to numbered versions listed here, not with every change, so the update prompt shows up less often and always has release notes.
- **Faster first load.** The page downloads about 33 kB less (gzipped) before the editor shows. Sharing, the lint gutter, the command palette, Settings, About, the Open, Upload and conflict dialogs, the tour, Add Files from Drive and the zip code now load just after the page, when you point at them, or on first use. If a part can't load because a new version was deployed, the update prompt offers a reload.
- The loading bar at startup says "Loading the editor..." instead of "Loading compiler assets...".
- **Wider Settings, and dialogs sized to fit.** Settings is wider, with keyboard shortcuts in their own column on large screens. Dialogs now use a few shared sizes, so Upload, Export, About, Open a project and the conflict dialog have more room, and Open a project's buttons no longer run past its edge.
- **Breaking for open shared sessions:** the peer-to-peer library (Trystero) moved to 0.26, which changes how peers talk to each other. Tabs on the old build and tabs on this build can't sync with each other, so everyone in a session needs to reload. Open tabs see the update prompt and can reload from there. The P2P protocol version is now 2.
- **In-app dialogs replace the browser's prompt and confirm boxes.** Renaming, creating, deleting, starting a new link and replacing the project now ask in a dialog that matches the theme, names the action on its button, and checks file and project names as you type. Risky actions have a red button with focus on Cancel.
- **Ctrl+N (⌘N) is now New File, and New Project moved to Ctrl+Shift+N (⇧⌘N).** Browsers keep these keys for a new window in a normal tab, so there the editor uses **Alt+N** and **Alt+Shift+N** (⌥⌘N and ⌥⇧⌘N on a Mac), and the menus show them. Export gets **Alt+Shift+E** too, since Firefox on Windows and Linux uses Ctrl+Shift+E. The second keys work everywhere. If you had turned Ctrl+N off, it stays off, and keybinds you added still win.
- **Settings > Keyboard shortcuts says which keys your browser keeps**, like "Chrome uses Ctrl+N to open a new window, so Alt+N is used here instead", for built-in keys and ones you add. It also says your shortcuts are saved per browser profile.
- **New file and New folder suggest a free name.** When `chapter.tex` or `figures` is taken, the box starts with `chapter (2).tex` or `figures (2)` and says why. Typing a taken name, here or in Rename, offers the next free one.
- **New Project's confirm now says it replaces the whole project**, points to New File, and starts on Cancel even with nobody connected, so Ctrl+Shift+N then Enter does nothing.

### Fixed

- Downloaded and exported `.zip` files now carry a real date (the time of the download) on each file. Before, every entry had an invalid date, which some zip tools showed as blank or rejected.
- The "Leave site?" box no longer shows just because you typed in the last 4 seconds. Edits are written to this browser as you leave, and the box only shows when something could really be lost.
- Going offline no longer brings up "a new version is live, reload to update". Opening Export, Settings, the palette or another part that loads on first use while offline now says you're offline, and opens it once you're back. The update prompt only offers a reload for a part that didn't load when the site really has a newer version.
- Errors from background libraries (sharing, Google sign-in) no longer show as a red notice in the header, where they could replace one that mattered. They go to the browser console; errors from your own actions still show.

## [0.1.0] - 2026-11-13

The first numbered release. It covers everything built so far.

### Added

- **Version numbers.** The About dialog and the footer show the version and commit, and the bug report form carries them. Each build ships a `version.json`, and peers say which build they run when they connect.
- **Peer-to-peer collaboration.** Share a link and edit the same project at the same time, browser to browser over WebRTC. There is no signaling server of our own: peers meet through public WebTorrent trackers (Trystero), and document content only travels between peers.
  - Yjs keeps edits in sync, with a shared undo and redo history.
  - The host's room and document survive a reload, so guest links keep working.
  - Connection badges show Not sharing, Waiting for peers, Connected, Relayed and Reconnecting, with the peer count.
  - Every incoming peer message is checked for shape and size before it's used.
  - Guests can't replace the shared project, and the host confirms Open and Import while guests are connected.
- **Projects.** A project is a folder of files with a main `.tex` file, not a single document.
  - Upload images and other binary files. They're shared between peers by hash, in chunks.
  - Rename, move, and make folders. Download the project as a `.zip`, empty folders included, or open one.
- **LaTeX preview** with LaTeX.js, in a Web Worker so typing stays smooth, inside a sandboxed iframe.
  - `\input`, `\include`, `\includegraphics` (with width, height and scale) and a simple bibliography.
  - Errors are mapped back to the original source lines and shown in the editor.
  - KaTeX fonts fill in math glyphs Computer Modern lacks, and preview text stays readable in every theme.
- **Editor.** CodeMirror with LaTeX syntax highlighting, light and dark themes, and keyboard shortcuts.
- **Saving.** Projects autosave to browser storage (IndexedDB) or to Google Drive with the `drive.file` scope.
  - Drive saves detect conflicts before overwriting and retry rate limits and server errors.
  - Pause Saving, Drive sign-out, and a Drive token kept per tab.
- **Interface.** Basecoat and Tailwind UI with menus, a command palette, in-app help links, and a first-run tour.
- **Docs and policies.** User docs (MkDocs) published under `/docs/`, Privacy and Terms of Service pages, a security policy, and issue forms.

[Unreleased]: https://github.com/PrestonHager/LaTeXCollaborativeEditor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/PrestonHager/LaTeXCollaborativeEditor/releases/tag/v0.1.0
