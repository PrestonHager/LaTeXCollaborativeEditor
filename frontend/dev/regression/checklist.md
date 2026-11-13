# Regression checklist

Run through this before a release, or after a change that touches a lot of the app.
It only covers what's on `main`, so add or update items in the same PR as the feature.
Start the dev server with `npm run dev` in `frontend/`, then open http://localhost:5173.
Open the command palette (Ctrl+P) and run **Open regression test project** to load the test project.
Then run **Open regression checklist** to get this page with checkboxes.

## Editor

- [ ] Line numbers show next to every line of `main.tex`.
- [ ] Typing in the editor updates the preview a moment later, without pressing anything.
- [ ] Undo (Ctrl+Z) and Redo (Ctrl+Shift+Z and Ctrl+Y) step through your typing.
- [ ] Cut, Copy, Paste and Select All work from the Edit menu and from their shortcuts.
- [ ] Clicking a file in the Files panel opens it, and the header shows its name.
- [ ] The main file shows a "main" marker in the header and in the Files panel.

## Preview

Everything here uses the regression test project, so compare each section with its `% Expect:` comment.

- [ ] Title block: title, author and the date 1 January 2026 show.
- [ ] Text: bold, emphasis, italic, monospace and underline all look different.
- [ ] Text: special characters, dashes, accented letters and curly quotes show correctly.
- [ ] Text: the footnote text shows, inline after the curly quotes.
- [ ] Lists: bullets, a nested bullet, a numbered list and a description list all render.
- [ ] Blocks: the quote is indented and the centered text is centered.
- [ ] Links: the repository link and the example.com link are clickable.
- [ ] Links: the javascript and data links show as plain text with no `href` (inspect them in dev tools).
- [ ] References: `\ref` in the Text section shows 1.5, not `??`.
- [ ] Math: inline math, the integral and the sum are typeset, with limits above and below the sum.
- [ ] Math: Greek letters, symbols and the matrix render.
- [ ] `\input`: the Text and Math sections show up, and the commented-out `\input` causes no error.
- [ ] `\include`: the Figures section shows up.
- [ ] Images: the four-color image shows twice, with a caption under the first one.
- [ ] Pictures: the box with a diagonal line and a circle renders.
- [ ] Typing stays smooth while the preview compiles, since the compile runs in a Web Worker.
- [ ] Citations: the text shows [1] and [2], the repeated cite reuses [1], and a References list follows.
- [ ] Compile Now (Ctrl+Shift+C) refreshes the preview.
- [ ] The preview iframe has `sandbox="allow-scripts"` and nothing else (inspect it in dev tools).
- [ ] The footer says Compiled, with no diagnostics.
- [ ] The preview shows "Preview is approximate: N changes made for LaTeX.js", and its list includes showing figures in place and footnotes inline.
- [ ] A `%` comment that mentions `\vspace` or `\usepackage{fancyhdr}` is left alone, not rewritten.

Known gaps, so don't count these as regressions: LaTeX.js has no `verbatim`, `equation`, `tabular` or `\pageref`, footnotes show inline, and `\includegraphics` ignores `width` and other options.

## Diagnostics

- [ ] Type `\foo{` on a new line in `main.tex`. An error marker shows on that line.
- [ ] The footer names the error, the file and the line, like `unknown macro: \foo (main.tex line 12)`.
- [ ] Put the same thing in `chapters/text.tex`. The marker and footer point at that file instead.
- [ ] Remove it again and the error clears.

## Projects and files

- [ ] New File makes a file in the selected folder, and it opens in the editor.
- [ ] New Folder makes a folder.
- [ ] Rename a file from its menu in the Files panel. The preview still finds it if you update the `\input`.
- [ ] Move a file into another folder.
- [ ] Delete a file after the confirm dialog.
- [ ] Set main file on another `.tex` file. The preview compiles from that file instead.
- [ ] Upload Files adds a file, and an image you upload can be used with `\includegraphics`.
- [ ] A file over 10 MB is refused with a message.
- [ ] Download Current File saves the open file.
- [ ] Download Project .zip (Ctrl+Shift+S) saves a zip with every file and folder.
- [ ] Upload .zip as New Project opens that zip as a project, with the right main file.
- [ ] Rename Project changes the name in the header.
- [ ] New Project (Ctrl+N) asks first, then opens a starter `main.tex`.

## Saving in the browser

- [ ] The save status in the header says when the project last saved.
- [ ] Reloading the page brings back the same project and files.
- [ ] Save Now (Ctrl+S) saves right away.
- [ ] View > Pause Saving stops autosave and Save Now, the menu shows it checked, and the status says "Saving paused".
- [ ] While paused, the palette shows Resume Saving, and leaving the page warns about unsaved edits.
- [ ] Resuming saves the edits made while paused, and the paused setting survives a reload.
- [ ] Open Local Project (Ctrl+O) lists saved projects and opens the one you pick.
- [ ] Clear Local Projects asks first, then removes the saved projects.

## Google Drive

These need Google dev keys in `.env.development.local` and a Google sign-in.

- [ ] Connect Google Drive opens a sign-in popup and the status says Drive is connected.
- [ ] Settings, and hovering the save status, show which Google account is signed in.
- [ ] Reloading the tab stays signed in, but a new tab asks you to connect again.
- [ ] The Drive token is in `sessionStorage` only, never `localStorage` (check in dev tools).
- [ ] Disconnect Google Drive signs out and switches saving to the browser, without losing edits.
- [ ] A blocked popup shows a message saying to allow popups.
- [ ] Save to Google Drive makes a project folder in Drive with the same files and subfolders.
- [ ] Edits autosave to Drive.
- [ ] Open from Google Drive (Ctrl+Shift+O) opens a project folder, and an old single `.tex` file.
- [ ] Move to Drive Folder moves the project folder.
- [ ] Renaming the project renames the Drive folder on the next save, with no duplicate left behind.
- [ ] Deleting a file in the app sends it to the Drive trash.
- [ ] When Google limits requests, the app waits and retries on its own.
- [ ] A full Drive shows "Google Drive is full" and stops retrying.
- [ ] After the sign-in expires (about an hour), the app renews it or shows a notice and saves to the browser.

## Sharing and collaboration

Use two browser windows, or a normal and a private window, so each has its own storage.

- [ ] Before sharing, the connection badge says Not shared.
- [ ] Share copies a `?room=` link and shows it next to the button, and the badge says Shared, waiting for others.
- [ ] Opening the link in the second window joins as a guest, and both badges say Connected with 1 other person.
- [ ] The guest gets the whole file tree, the text and the image.
- [ ] Edits show up in the other window within a couple of seconds, both ways.
- [ ] A new file or folder from either side shows up on the other.
- [ ] An image uploaded on one side shows up in the other's preview, with a progress bar while it transfers.
- [ ] Reloading the host rejoins the same room, and the guest keeps syncing.
- [ ] Text the guest typed while the host was reloading shows up on the host.
- [ ] New link starts a different room, and the old link stops working.
- [ ] Closing the guest window makes the host badge go back to Shared, waiting for others.
- [ ] Closing the host window makes the guest badge say Can't reach the host, with a notice that has help links.
- [ ] Guests can't use New Project, Open Local Project, Open from Google Drive, Upload .zip, or the Drive commands, from the menus, the palette or shortcuts.
- [ ] Guests can still add, edit and upload files in the host's project.
- [ ] The guest's header shows the project name and where the host saves.

## Network and privacy

- [ ] The console shows no relay or tracker errors on load.
- [ ] In the Network tab, the only tracker connections are the ones in `VITE_P2P_RENDEZVOUS`, or the defaults.
- [ ] Tracker traffic only has the room id, never document text.

## Interface

- [ ] Each menu (File, Edit, View, Help) opens on click and shows above the editor.
- [ ] Arrow keys move through menu items and between menus, and Escape closes them.
- [ ] Disabled items are greyed out and don't run.
- [ ] Ctrl+P opens the command palette. Typing filters it, and Enter runs the command.
- [ ] Each palette entry has a description, and searching a word from one finds it (typing "github" finds Report a Bug).
- [ ] The palette has the palette-only commands: Copy share link, Focus editor, and Switch to dark, light or system theme.
- [ ] Ctrl+, opens Settings. Its theme selects, Pause Saving and Clear Local Projects all work.
- [ ] Toggle Editor Theme and Toggle Preview Theme switch light and dark.
- [ ] With the app theme on Light and the OS in dark mode, a preview theme of Match system shows a dark preview with light text. "Match system" follows the OS, not the app theme.
- [ ] Try each preview theme (Light, Dark, Match system) with the app theme on Light, Dark and Match system, in OS light and dark mode. The preview's text, links, math, picture lines and "Preview is approximate" note are always readable on its background.
- [ ] With a Match system preview open, switch the OS between light and dark. The preview follows without a reload.
- [ ] Split View, Editor Only and Preview Only change the layout, and the splitter drags.
- [ ] Help > Documentation opens the docs, and Keyboard Shortcuts opens the shortcuts page.
- [ ] Help > Report a Bug and Request a Feature open the GitHub forms, and the bug form has browser, OS and version filled in, but no document text.
- [ ] Help > About shows the app version with links to the docs, the source and the policies.
- [ ] The toolbar under the menus runs the same commands as the menus, shows tooltips on hover, and its buttons are disabled in the same cases.
- [ ] Tab moves into the toolbar, the arrow keys move between its buttons, and Home and End jump to the ends.
- [ ] The ? help links next to Share, the save status, the file list and the preview open the matching docs page.
- [ ] A failed save or a blocked popup shows a notice with a Learn more link.
- [ ] In a fresh private window, the first-run tour shows once. Skip tour and Esc close it, and Help > Show Tour runs it again.
- [ ] The page works at phone width without scrolling sideways.

## Build

- [ ] `npm run build` passes and reports the gzipped size under the budget.
- [ ] `npm run test:e2e` from the repo root passes the two-browser sync test (it uses public relays, so retry once if it times out).
- [ ] `dist/` has no `regression.html` and no regression test files.
- [ ] `npm run preview` serves the built app, and the palette has no regression commands.
