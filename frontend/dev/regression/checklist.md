# Regression checklist

Run through this before a release, or after a change that touches a lot of the app.
It only covers what's on `main`, so add or update items in the same PR as the feature.
Start the dev server with `npm run dev` in `frontend/`, then open http://localhost:5173.
Open the command palette (Ctrl+P) and run **Open regression test project** to load the test project.
Then run **Open regression checklist** to get this page with checkboxes.

## Editor

- [ ] Line numbers show next to every line of `main.tex`.
- [ ] LaTeX is colored in `main.tex`: commands like `\section`, arguments like `{document}`, `$` math, brackets and `%` comments each have their own color.
- [ ] Switching Settings > App and editor theme between Light and Dark recolors the syntax right away, and both stay readable.
- [ ] The line number gutter matches the editor theme: light gutter with dark numbers on Light, dark gutter with light numbers on Dark. With Match system, it follows the OS (light or dark mode) and looks the same as picking that theme directly. The current line's number stays readable in all of them.
- [ ] Typing in the editor updates the preview a moment later, without pressing anything.
- [ ] Undo (Ctrl+Z) and Redo (Ctrl+Shift+Z and Ctrl+Y) step through your typing.
- [ ] Cut, Copy, Paste and Select All work from the Edit menu and from their shortcuts. The first Edit > Paste asks to read the clipboard, and if you block it, a notice says to press Ctrl+V instead.
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
- [ ] Links: clicking the repository link or the example.com link opens it in a new tab, and the preview stays where it was.
- [ ] Links: clicking the email link opens your mail app (or the browser's mailto handler).
- [ ] Links: the javascript and data links show as plain text with no `href` (inspect them in dev tools).
- [ ] References: "This is section 1.5" in the Text section shows 1.5, not `??`.
- [ ] References: clicking the 4 in "Jump to section 4" scrolls the preview to the Citations section, and clicking the 1.5 there scrolls back up.
- [ ] References: the missing label shows `??` as plain text, not a link.
- [ ] Scroll the preview halfway down, then type in the editor. After the preview updates it stays at the same place instead of jumping to the top.
- [ ] Verbatim: the `\verb` text shows exactly as typed, nothing from the comment block shows, and the "Preview is approximate" list (the ⓘ button above the preview) doesn't mention `\vspace` or `\addcontentsline`.
- [ ] Math: inline math, the integral and the sum are typeset, with limits above and below the sum.
- [ ] Math: Greek letters, symbols and the matrix render.
- [ ] Math: `\infty`, `\neq`, `\notin` and the other symbols in the "Computer Modern lacks" line use a serif math font, and the `\neq`-style slashes cross their symbol.
- [ ] `\input`: the Text and Math sections show up, and the commented-out `\input` causes no error.
- [ ] `\include`: the Figures section shows up.
- [ ] Images: the four-color image shows full size, with a caption under it.
- [ ] Image sizes: `width=0.5\textwidth` is half the column, `width=2cm` and `height=1in` keep their proportions, `width=4cm,height=1cm` stretches, adding `keepaspectratio` doesn't, and `scale=0.5` is half size.
- [ ] Pictures: the box with a diagonal line and a circle renders.
- [ ] Typing stays smooth while the preview compiles, since the compile runs in a Web Worker.
- [ ] Citations (plain): Lamport is [3] and Knuth is [1], since plain sorts by author. The repeated cite reuses [1], the page note shows as [2, p. 5], and two keys show as [4, 3].
- [ ] Citations (plain): the References list has five entries in the `% Expect:` order, including the `\nocite` one. "Literate programming" is lowercased after its first word, and the TeX and LaTeX logos render in the book titles.
- [ ] Bibliography styles: set each file in `styles/` as the main file (`unsrt`, `alpha`, `abbrv`, `ieeetr`, `apalike`, `natbib`, `biblatex`) and check the labels, order and names against its `% Expect:` comments. Set `main.tex` back as the main file after.
- [ ] Bibliography styles: with `styles/unknown.tex` as the main file, the footer shows 2 diagnostics, the cite shows [?] with a warning on its line, and the `\bibliographystyle{nature}` line has an info note saying it uses plain.
- [ ] Compile Now (Ctrl+Enter, ⌘↩ on a Mac) refreshes the preview, from the editor too. Ctrl+Shift+C does nothing in the app, so the browser keeps it for the inspector.
- [ ] The preview iframe has `sandbox="allow-scripts"` and nothing else (inspect it in dev tools).
- [ ] The footer says Compiled, with no diagnostics.
- [ ] The rendered document has no "Preview is approximate" note at the top.
- [ ] The preview bar has a small ⓘ button with a count, next to the `?` help link. Hovering it shows "Preview is approximate: N changes", and a screen reader reads the same name.
- [ ] Clicking it opens a popover that lists the changes, including showing figures in place and footnotes inline, with a "What's supported" link that opens the docs page in a new tab.
- [ ] The popover closes with Esc (focus goes back to the button), with a click outside it, and with a click in the preview. Tab reaches the button, Enter opens it, and Tab moves on to the link.
- [ ] The button and popover look right in the light and dark app themes, and the popover fits on a phone-width screen.
- [ ] Open a project with nothing for the preview to change (the starter project). The ⓘ button isn't there.
- [ ] A `%` comment that mentions `\vspace` or `\usepackage{fancyhdr}` is left alone, not rewritten.
- [ ] Code in `verbatim`, `lstlisting`, `minted` or `comment` blocks, and in environments the document defines with `\lstnewenvironment`, `\DefineVerbatimEnvironment`, `\newminted` or a `\newenvironment` around one of those, is left alone, even when `\begin` or `\end` is in the middle of a line. LaTeX.js has none of these except `comment`, so the unit tests in `src/compile/latexJsAdapt.test.ts` cover them.

Known gaps, so don't count these as regressions: LaTeX.js has no `verbatim`, `equation`, `tabular` or `\pageref`, footnotes show inline, and `\includegraphics` reads only `width`, `height`, `totalheight`, `scale` and `keepaspectratio` (a height relative to `\textheight` is ignored).

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
- [ ] On a project saved in the browser, the upload dialog shows Add Files from Drive turned off, with a line saying to save to Drive first. File > Add Files from Drive is turned off too.
- [ ] Download Current File saves the open file.
- [ ] Download Project .zip (Ctrl+Shift+S) saves a zip with every file and folder.
- [ ] Add an empty folder (like `figures/`), download the .zip, and upload it as a new project: the empty folder is still in the file tree.
- [ ] Upload .zip as New Project opens that zip as a project, with the right main file.
- [ ] Rename Project changes the name in the header.
- [ ] New Project (Ctrl+N) asks first, then opens a starter `main.tex`.

## Saving in the browser

- [ ] The save status in the header says when the project last saved.
- [ ] Reloading the page brings back the same project and files.
- [ ] Save Now (Ctrl+S) saves right away.
- [ ] View > Pause Saving stops autosave and Save Now, the menu shows it checked, and the status says "Saving paused".
- [ ] While paused, the palette shows Resume Saving, and leaving the page warns about unsaved edits.
- [ ] On a named project saved in this browser, type and reload within 4 seconds. No "Leave site?" box shows, the edit is still there, and the autosave saves it again after the reload.
- [ ] With Google Drive connected, type and close the tab within 4 seconds. The "Leave site?" box shows.
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
- [ ] Add a file to the project folder on drive.google.com (also one in a new subfolder made there). File > Add Files from Drive opens the Picker in the project folder, lets you pick several, and adds them at the same paths. The next save doesn't write them back to Drive.
- [ ] Picking a Google Doc or a file outside the project folder in Add Files from Drive says it couldn't be added.
- [ ] Make `notes.tex` in the app (don't save) and a different `notes.tex` in the Drive folder, then pick it with Add Files from Drive. The conflict dialog asks; Keep mine writes the app's copy to Drive, and Use Drive's copy loads Drive's into the editor. Neither happens silently.
- [ ] With the project on Drive, an `\includegraphics` of a file that isn't in the project says "Not found in the project" plus a hint to use Add Files from Drive.
- [ ] Renaming the project renames the Drive folder on the next save, with no duplicate left behind.
- [ ] Deleting a file in the app sends it to the Drive trash.
- [ ] When Google limits requests, the app waits and retries on its own.
- [ ] A full Drive shows "Google Drive is full" and stops retrying.
- [ ] After the sign-in expires (about an hour), the app renews it or shows a notice and saves to the browser.

## Sharing and collaboration

Use two browser windows, or a normal and a private window, so each has its own storage.

- [ ] Before sharing, the connection badge says Not shared.
- [ ] Share copies a `?room=` link and shows it next to the button, and the badge says Shared, waiting for others. The console shows no `TypeError` (a Trystero API change once broke Share with "object is not iterable").
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
- [ ] Guests can't use New Project, Open Local Project, Open from Google Drive, Upload .zip, or the Drive commands (Add Files from Drive included), from the menus, the palette or shortcuts. The upload dialog's Add Files from Drive button is off and says only the host can use it.
- [ ] Guests can still add, edit and upload files in the host's project.
- [ ] With a guest connected, the host's Open Local Project, Open from Google Drive, and Upload .zip as New Project ask first, saying it replaces the project for everyone in the room. Cancel opens no dialog or file picker and leaves both windows unchanged.
- [ ] With a guest connected, OK on Open Local Project and then Upload .zip in that dialog asks only once and opens the file picker.
- [ ] With nobody connected, those three open straight away without asking.
- [ ] With a guest connected, leaving the Upload .zip confirm open for more than 5 seconds and then pressing OK shows a notice that the browser blocked the picker. Choosing Upload .zip again opens the picker without asking.
- [ ] The guest's header shows the project name and where the host saves.
- [ ] With both windows on the same build, the console shows no version message. A guest on another build (say `npm run dev` with another version in `package.json`) logs which version each side runs, and still syncs.

## Network and privacy

- [ ] The console shows no relay or tracker errors on load.
- [ ] In the Network tab, the only tracker connections are the ones in `VITE_P2P_RENDEZVOUS`, or the defaults.
- [ ] Tracker traffic only has the room id, never document text.
- [ ] The console shows no Content Security Policy errors ("violates the following Content Security Policy directive") while you load the test project, open each dialog, share a room, connect Google Drive and open the Drive Picker. The preview still has its LaTeX fonts.

## Interface

- [ ] Each menu (File, Edit, View, Help) opens on click and shows above the editor.
- [ ] Arrow keys move through menu items and between menus, and Escape closes them.
- [ ] With one menu open, moving the mouse over another menu (File, Edit, View, Help) switches to it without clicking. Hovering never runs a command, and with no menu open hovering does nothing.
- [ ] After switching menus by hover, arrow keys still move between menus and Escape closes the menu.
- [ ] Disabled items are greyed out and don't run.
- [ ] Ctrl+P opens the command palette. Typing filters it, and Enter runs the command.
- [ ] Each palette entry has a description, and searching a word from one finds it (typing "github" finds Report a Bug).
- [ ] The palette has the palette-only commands: Copy share link, Focus editor, and Switch to dark, light or system theme.
- [ ] Ctrl+, opens Settings. Its theme selects, Pause Saving and Clear Local Projects all work.
- [ ] Settings > Keyboard shortcuts lists every command. Press + on Copy share link, then Alt+L: the chip shows, the palette lists Alt+L, and Alt+L copies the link, from the editor too.
- [ ] While recording, a plain letter says it's for typing, Escape stops, and Tab moves on without adding anything.
- [ ] Giving Ctrl+S to Compile Now shows a warning on both rows. Use it here on Save Now gives it back, and the Compile Now chip turns off.
- [ ] The × on Redo's Ctrl+Y crosses it out and Ctrl+Y stops redoing. Turn on brings it back.
- [ ] Giving Ctrl+] to a command warns that the editor uses it. In the editor Ctrl+] still indents, and outside it runs the command.
- [ ] Added keybinds are still there after a reload, and Reset to defaults puts everything back.
- [ ] Upgrading keeps your settings: with keybinds, tour seen and themes saved by the previous version, the new version shows the same themes and keybinds and no tour. DevTools > Application > Local Storage then has `latex-editor.settings`, and `latex-editor.keybinds` and `latex-editor.tour-seen` are gone.
- [ ] Open the app in two tabs. Changing the theme, a keybind or the layout (View > Editor Only, or dragging the splitter) in one shows up in the other right away, Settings included if it's open.
- [ ] The layout mode and splitter position survive a reload.
- [ ] As a guest (a `?room=` link), change the theme and reload: the theme stays. The host's theme doesn't change.
- [ ] Settings > Export settings downloads `latex-editor-settings-YYYY-MM-DD.json`. In a private window, Import settings with that file brings back the themes, layout and keybinds, and the status line says how many were imported.
- [ ] Importing a file that isn't a settings file (any other `.json`, or a `.tex`) says so and changes nothing. A settings file with an unknown key imports the rest and names what it skipped.
- [ ] Settings > Reset to defaults turns red and says Click again to reset, and resets nothing until the second click. It lets go after a few seconds or when you pick another section. Resetting Themes leaves keybinds alone. Resetting Tour shows the tour again on the next load.
- [ ] With site data blocked for the page, Settings shows the note that settings only last for this tab, and changing them still works.
- [ ] The Settings dialog scrolls inside when the window is short, so Done and the footer stay on screen, also at phone width.
- [ ] On Windows and Linux every shortcut label (menus, toolbar tooltips, palette, first tour step) says Ctrl, and the Windows key plus P does not open the palette.
- [ ] On a Mac (or with DevTools > Sensors set to a Mac user agent) the same labels use ⌘ and the Mac symbols, like ⇧⌘O and ⌘↩, and never say Ctrl or "Cmd".
- [ ] Toggle Editor Theme and Toggle Preview Theme switch light and dark.
- [ ] With the app theme on Light and the OS in dark mode, a preview theme of Match system shows a dark preview with light text. "Match system" follows the OS, not the app theme.
- [ ] Try each preview theme (Light, Dark, Match system) with the app theme on Light, Dark and Match system, in OS light and dark mode. The preview's text, links, math and picture lines are always readable on its background.
- [ ] With a Match system preview open, switch the OS between light and dark. The preview follows without a reload.
- [ ] Split View, Editor Only and Preview Only change the layout, and the splitter drags.
- [ ] Help > Documentation opens the docs, and Keyboard Shortcuts opens the shortcuts page.
- [ ] Help > Report a Bug and Request a Feature open the GitHub forms, and the bug form has browser, OS and version filled in, but no document text.
- [ ] Help > Report a Security Issue sits right under Report a Bug, has a shield icon in the palette, and opens GitHub's private Report a vulnerability form (`/security/advisories/new`), not a public issue.
- [ ] Help > About shows the app version with links to the docs, the source and the policies.
- [ ] Help > About says `Version X.Y.Z (commit abc1234, built YYYY-MM-DD)`, and the commit link opens that commit on GitHub.
- [ ] The footer ends with a small `vX.Y.Z` link. Hovering it shows the commit and build date, and clicking it opens the commit.
- [ ] The bug form's extra info says `App version: X.Y.Z+abc1234`.
- [ ] The toolbar under the menus runs the same commands as the menus, shows tooltips on hover, and its buttons are disabled in the same cases.
- [ ] Tab moves into the toolbar, the arrow keys move between its buttons, and Home and End jump to the ends.
- [ ] The ? help links next to Share, the save status, the file list and the preview open the matching docs page.
- [ ] A failed save or a blocked popup shows a notice with a Learn more link.
- [ ] In a fresh private window, the first-run tour shows once. Skip tour and Esc close it, and Help > Show Tour runs it again.
- [ ] Each tour card sits next to what it points at without covering it: beside the file list, editor and preview, below the menus and toolbar. In a small window the card stays fully on screen and covers as little of the highlighted part as it can.
- [ ] The page works at phone width without scrolling sideways.

## Build

- [ ] `npm run build` passes and reports the gzipped size under the budget.
- [ ] `npm run test:e2e` from the repo root passes the two-browser sync test (it uses public relays, so retry once if it times out).
- [ ] `dist/` has `privacy.html` and `tos.html`, and no `regression.html` and no regression test files. `npm run build` checks this and fails if it's wrong.
- [ ] In `npm run preview`, the Privacy and ToS links in the footer and in Help > About open the policy pages, not a 404.
- [ ] `npm run preview` serves the built app, and the palette has no regression commands.
- [ ] `dist/version.json` has the `version` from `package.json`, the short commit, and the build time. `/version.json` also works in `npm run dev`.
- [ ] In `npm run preview`, open the app, then edit `dist/version.json` to another commit and switch to another tab and back (or wait 15 minutes). The "A new version of the app is available" card shows in the bottom corner without taking focus from the editor, in light and dark themes.
- [ ] Type something, then click Reload to update. The autosave pill shows Saving, then Saved, then the page reloads with no "Leave site?" box, and the edit is still there.
- [ ] Later hides the card, and it doesn't come back for the same version. It shows again for another version.
- [ ] `npm run dev` never fetches `version.json` on its own.
