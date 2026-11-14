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
- [ ] Autocompletion: typing `\sec` on a new line shows a list with `\section` (with `{title}` and "Section heading") under the cursor. Enter puts in `\section{title}` with "title" selected, and typing replaces it.
- [ ] Autocompletion: after `\frac`, Tab moves from the first placeholder to the second, and Shift+Tab back.
- [ ] Autocompletion: typing `\begin{it` offers `itemize`. Enter gives `\begin{itemize}`, an indented `\item` line with the cursor on it, and `\end{itemize}`, with no extra `}` left over.
- [ ] Autocompletion: Ctrl+Space (⌃Space on a Mac) opens the list, Escape closes it, and nothing shows inside a `%` comment or after `\\`. One Ctrl+Z takes back an accepted completion, and a peer in the room sees the completed text.
- [ ] Autocompletion: in the dev tools Network tab, `latexCompletion` loads just after the editor shows, and `latexCompletionData` only the first time the list opens.
- [ ] Undo (Ctrl+Z) and Redo (Ctrl+Shift+Z and Ctrl+Y) step through your typing.
- [ ] Cut, Copy, Paste and Select All work from the Edit menu and from their shortcuts. The first Edit > Paste asks to read the clipboard, and if you block it, a notice says to press Ctrl+V instead.
- [ ] Soft keyboard (a phone, or dev tools device mode with touch): tapping a line near the bottom of `main.tex` opens the keyboard, and the cursor line stays visible above it and the key bar.
- [ ] Key bar: while the editor has focus on a touch screen, a bar with `\` `{` `}` `$` `%` `[` `]` `&` shows just above the keyboard. Each key types its character at the cursor without closing the keyboard, `\` opens autocompletion, one undo takes a key back, and a peer in the room sees it. The bar hides when the editor loses focus, and never shows with a mouse.
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
- [ ] Code: in the Code section, each `verbatim`, `lstlisting`, `minted` and `\lstinputlisting` block shows as a monospaced box with the text exactly as typed (indents, tabs, `%`, `<b>`, and `\ { } $ & # ^ _ ~`), in both the light and dark preview themes. Captions, line numbers, `firstline`/`lastline` and `\ref` to listings match the `% Expect:` comments, and the ⓘ list says listings have no syntax highlighting.
- [ ] Code: `\verb*`, `\lstinline` and `\mintinline` stay inside their line, and copying a numbered listing copies the code without the line numbers.
- [ ] Math: inline math, the integral and the sum are typeset, with limits above and below the sum.
- [ ] Math: Greek letters, symbols and the matrix render.
- [ ] Math: `\infty`, `\neq`, `\notin` and the other symbols in the "Computer Modern lacks" line use a serif math font, and the `\neq`-style slashes cross their symbol.
- [ ] `\input`: the Text and Math sections show up, and the commented-out `\input` causes no error.
- [ ] `\include`: the Figures section shows up.
- [ ] Images: the four-color image shows full size, with a caption under it.
- [ ] Image sizes: `width=0.5\textwidth` is half the column, `width=2cm` and `height=1in` keep their proportions, `width=4cm,height=1cm` stretches, adding `keepaspectratio` doesn't, and `scale=0.5` is half size.
- [ ] PDF figures: the bar chart from `figures/chart.pdf` shows at 2in by 1.33in, page 2 (the blue diamond) is 3cm wide, and the trimmed one shows only the blue bar, 1in tall. In the dev tools Network tab, `pdf.worker` loads from the app itself, once, and only after opening a project with a PDF.
- [ ] PDF figures: they look the same in the light and dark preview (a white page behind the chart), and typing elsewhere doesn't make them flicker or redraw.
- [ ] PDF figures: change `page=2` to `page=5`. A dashed box says the page doesn't exist (it has 2), and the ⓘ list says the same.
- [ ] EPS figures: `figures/wave.eps` shows as a dashed 2in by 1in box with the file name and "EPS can't be previewed; convert it to PDF.", and at half the column width it keeps its 2:1 shape. The ⓘ list says EPS figures show as empty boxes.
- [ ] Pictures: the box with a diagonal line and a circle renders.
- [ ] Typing stays smooth while the preview compiles, since the compile runs in a Web Worker.
- [ ] Citations (plain): Lamport is [3] and Knuth is [1], since plain sorts by author. The repeated cite reuses [1], the page note shows as [2, p. 5], and two keys show as [4, 3].
- [ ] Citations (plain): the References list has five entries in the `% Expect:` order, including the `\nocite` one. "Literate programming" is lowercased after its first word, and the TeX and LaTeX logos render in the book titles.
- [ ] Bibliography styles: set each file in `styles/` as the main file (`unsrt`, `alpha`, `abbrv`, `ieeetr`, `apalike`, `natbib`, `biblatex`) and check the labels, order and names against its `% Expect:` comments. Set `main.tex` back as the main file after.
- [ ] Bibliography styles: with `styles/unknown.tex` as the main file, the footer shows 2 diagnostics, the cite shows [?] with a warning on its line, and the `\bibliographystyle{nature}` line has an info note saying it uses plain.
- [ ] Packages: with `unsupported-packages.tex` as the main file, the `geometry` line has an info marker, the `tikz` line a warning that says a `tikzpicture` stops the preview, and only the `amssymb` half of the two-line `\usepackage{xcolor, amssymb}` has one. `\RequirePackage{hyperref}` gets no marker and no error. The footer leads with the tikz warning (`3 diagnostic(s)`), the text shows with "blue" in blue, and the ⓘ list says which packages were removed. Set `main.tex` back as the main file after.
- [ ] Packages: add `\begin{tikzpicture}\end{tikzpicture}` to its body. The footer shows the `unknown environment` error first, and the tikz warning is still on its line.
- [ ] Compile Now (Ctrl+Enter, ⌘↩ on a Mac) refreshes the preview, from the editor too. Ctrl+Shift+C does nothing in the app, so the browser keeps it for the inspector.
- [ ] The preview iframe has `sandbox="allow-scripts"` and nothing else (inspect it in dev tools).
- [ ] The footer says Compiled. Its only diagnostics are the 7 info notes on `main.tex`'s `\usepackage` lines, from listings to cleveref, and hovering one says what the stand-in does.
- [ ] The rendered document has no "Preview is approximate" note at the top.
- [ ] The preview bar has a small ⓘ button with a count, next to the `?` help link. Hovering it shows "Preview is approximate: N changes", and a screen reader reads the same name.
- [ ] Clicking it opens a popover that lists the changes, including showing figures in place and footnotes inline, with a "What's supported" link that opens the docs page in a new tab.
- [ ] The popover closes with Esc (focus goes back to the button), with a click outside it, and with a click in the preview. Tab reaches the button, Enter opens it, and Tab moves on to the link.
- [ ] The button and popover look right in the light and dark app themes, and the popover fits on a phone-width screen.
- [ ] Open a project with nothing for the preview to change (the starter project). The ⓘ button isn't there.
- [ ] A `%` comment that mentions `\vspace` or `\usepackage{fancyhdr}` is left alone, not rewritten.
- [ ] Code in `verbatim`, `lstlisting`, `minted` or `comment` blocks, and in environments the document defines with `\lstnewenvironment`, `\DefineVerbatimEnvironment`, `\newminted` or a `\newenvironment` around one of those, is left alone, even when `\begin` or `\end` is in the middle of a line. The unit tests in `src/compile/latexJsAdapt.test.ts` and `src/compile/verbatimBlocks.test.ts` cover them.

- [ ] Modern packages (the last section): `\enquote`, `\cref`, siunitx, `equation` and `align`, the theorem and proof, and the booktabs table each match their `% Expect:` comment, and the ⓘ list names each stand-in (theorems, equations, `\cref`, siunitx, tables, and the ignored `\newtheorem`).

Known gaps, so don't count these as regressions: LaTeX.js has no `verbatim`, `equation`, `tabular` or `\pageref` of its own (the preview stands in for the first three), footnotes show inline, and `\includegraphics` reads only `width`, `height`, `totalheight`, `scale` and `keepaspectratio`, plus `page`, `trim`, `viewport` and `clip` for PDF figures (a height relative to `\textheight` is ignored, and `trim` or `viewport` always clips). EPS figures are boxes, not drawings.

## Diagnostics

- [ ] Type `\foo{` on a new line in `main.tex`. An error marker shows on that line.
- [ ] The footer names the error, the file and the line, like `unknown macro: \foo (main.tex line 12)`.
- [ ] Put the same thing in `chapters/text.tex`. The marker and footer point at that file instead.
- [ ] Remove it again and the error clears.

## Projects and files

- [ ] New File opens an in-app **New file** dialog with `chapter` selected in `chapter.tex`. Create file makes it in the selected folder, and it opens in the editor.
- [ ] Open New File again in the same folder. The box says `chapter (2).tex` with `chapter (2)` selected, and the red line says `chapter.tex already exists, so here's chapter (2).tex instead.` until you type. Enter creates `chapter (2).tex`. New Folder twice does the same with `figures (2)`.
- [ ] In the New file dialog, type `chapter` while `chapter.tex` exists. The line says `chapter.tex already exists.` with an underlined **Use chapter (2).tex** button. Clicking it, or pressing Enter, puts `chapter (2).tex` in the box. Rename a file to another file's name and it offers the same.
- [ ] In the New file dialog, typing `main` says `main.tex already exists.` under the box, `a:b` says the `:` isn't allowed, and an empty box says Enter a name. Enter does nothing until the name is fine.
- [ ] New Folder opens a **New folder** dialog, and Create folder makes the folder.
- [ ] Rename a file from its pencil in the Files panel. The **Rename** dialog selects the name without its extension. The preview still finds it if you update the `\input`.
- [ ] Move a file into another folder by typing `folder/name.tex` in the Rename dialog.
- [ ] Delete a file from its trash can. The dialog's **Delete file** button is red and focus starts on Cancel, so Enter keeps the file. Clicking Delete file removes it.
- [ ] Delete a file from its trash can. The notice says "Deleted name" with an **Undo** button. Clicking it brings the file back with its text, and the notice says "Undid Delete name.".
- [ ] Upload an image, delete it, and undo: it shows in the viewer again and `\includegraphics` still finds it.
- [ ] Rename a file, move one by dragging, delete a folder with files in it, make a new file and a new folder. Click a row in the Files panel, then press Ctrl+Z once per change: each undoes in reverse order, and Ctrl+Shift+Z (and Ctrl+Y) redoes them.
- [ ] With focus in the Files panel, Edit > Undo says what it'll undo, like **Undo Delete chapter.tex**, and Redo the same. Click in the editor and they say plain **Undo** and **Redo** again, and Ctrl+Z undoes typing only, never a file change.
- [ ] In a shared room, rename or delete a file on one side, then undo it: the other side follows. Undo never removes a file the other person made. Make a new file, have the other person type in it, then undo: the file stays with their text and the notice says "Kept name because someone else edited it." Delete a file, have the other person make a new file with that name, then undo: yours comes back as `name (restored).ext` next to theirs.
- [ ] On a project saved to Google Drive, delete a file, wait for the save, then undo: after the next save the same file is back in the Drive folder (not a copy), and it's gone from the Drive trash.
- [ ] Every one of these dialogs closes on Escape and on a click outside the box, gives focus back to the button that opened it (or a row in the Files panel after a rename or delete), and looks right in light and dark mode and in a narrow window.
- [ ] No browser `prompt`/`confirm` box shows anywhere, except the browser's own "Leave site?" box.
- [ ] Set main file on another `.tex` file. The preview compiles from that file instead.
- [ ] Upload Files adds a file, and an image you upload can be used with `\includegraphics`.
- [ ] A file over 10 MB is refused with a message.
- [ ] On a project saved in the browser, the upload dialog shows Add Files from Drive turned off, with a line saying to save to Drive first. File > Add Files from Drive is turned off too.
- [ ] Download Current File saves the open file.
- [ ] Download Project .zip (Ctrl+Shift+S) saves a zip with every file and folder.
- [ ] Open the downloaded .zip in your OS or with `unzip -l`: each file shows today's date and time, not a blank or 1980 date.
- [ ] Add an empty folder (like `figures/`), download the .zip, and upload it as a new project: the empty folder is still in the file tree.
- [ ] Upload .zip as New Project opens that zip as a project, with the right main file.
- [ ] Rename Project (or clicking the title) opens a **Rename project** dialog. A name over 200 characters shows an error under the box. Rename project changes the name in the header.
- [ ] New Project (from the File menu, or its key) asks first in a **Replace the whole project?** dialog that says every file and folder closes and points to File > New File, even with nobody connected. Focus starts on **Cancel**, so Enter closes it and nothing changes. Start new project opens a starter `main.tex`.
- [ ] In a normal Chrome or Edge tab: the File menu and palette show **Alt+N** on New File, **Alt+Shift+N** on New Project, Ctrl+Shift+E on Export, and no key on New Folder. Alt+N, Alt+Shift+N and Alt+Shift+E open their dialogs. Ctrl+N and Ctrl+Shift+N open a browser window (that's the browser, not a bug).
- [ ] Install the app (Chrome: ⋮ > Cast, save, and share > Install page as app; Edge: … > Apps > Install this site as an app) and open it. The menus show **Ctrl+N** and **Ctrl+Shift+N**, both open their dialogs with no new window, and Alt+N still works. Pressing F11 in a tab does the same until you leave full screen, and the menu labels switch back.
- [ ] In Firefox on Windows or Linux, Export shows **Alt+Shift+E**, and Alt+Shift+E opens it. On a Mac (any browser) New File shows ⌥⌘N in a tab, and ⌥⌘N opens it.
- [ ] Settings > Keyboard shortcuts, in a tab: the hint says shortcuts are saved in this browser profile only and "Keys shown are for Chrome in a browser tab." New File shows Ctrl+N and Alt+N, with "Chrome uses Ctrl+N to open a new window, so Alt+N is used here instead…". Adding Ctrl+T to a command warns that Chrome uses it to open a new tab.
- [ ] With keybinds saved by the previous version that turned Ctrl+N off for New Project, Settings shows Ctrl+N crossed out on New File, Ctrl+N does nothing in the app, and New Project has Ctrl+Shift+N. A keybind you added on Ctrl+Shift+N still wins over New Project.
- [ ] Pressing Alt+N or Alt+Shift+N (or Ctrl+N in an installed app) while a dialog is open doesn't open a second one.

## Export

- [ ] File > Export… (Ctrl+Shift+E, or Alt+Shift+E), the toolbar Export button, and the palette's Export all open the Export dialog, the first press included (the dialog loads on first use). Guests can open it too.
- [ ] The Format menu lists Project .zip, PDF, HTML, Flattened .tex, and Single file. PDF and HTML say "(preview quality)" and show a "Preview quality" badge in the box under the menus.
- [ ] With no main file, PDF, HTML and Flattened .tex say "(unavailable)", the box says why, and Export is off. With an image still coming from a peer, Project .zip warns about it.
- [ ] The Save to menu has Download and Google Drive. The choice is remembered after a reload (Settings > Reset > Where exports go puts it back to Download).
- [ ] On a site with no Google keys, Google Drive says "(not set up)" and can't be picked. As a guest in a room, it says "(host only)" and the line under the menus says guests can't use the host's Drive.
- [ ] With PDF picked, Google Drive says "(not for PDF)", Download is used, and the line under the menus says why. Picking HTML again goes back to Google Drive if that was the choice.
- [ ] Not signed in to Drive: Google Drive says "(sign-in needed)". Export with it opens Google's sign-in, then uploads. Closing the sign-in shows "Google Drive sign-in didn't finish..." in the dialog and nothing is exported.
- [ ] **Live Drive (maintainer):** with a project saved in Drive, HTML to Google Drive makes an `exports` folder in the project folder and uploads `<name>.html` as an HTML file, with an upload bar and an "Open <name>.html" link that opens it in Drive. Reopening the project doesn't show `exports` in the file tree. A local project uploads to the top of My Drive. **Choose folder…** opens the Picker in folder mode and the next export goes there. Flattened .tex is stored as `text/x-tex` and Project .zip as a zip.
- [ ] Project .zip downloads `<project name>.zip`. Uploading it as a new project gives the same files and folders, empty folders included.
- [ ] Single file starts on the open file, and downloads the file picked in its list.
- [ ] Flattened .tex on the regression test project downloads `main-flat.tex` with the chapters in place, and `\clearpage` around `chapters/figures`. With Remove comments on, the `% Expect:` lines are gone and `\%` is kept.
- [ ] HTML with Work offline downloads one file (about 5 MB) that opens with the right fonts with the network off. With Work offline off it's small and loads styles from the CDN.
- [ ] In the HTML file, the `\newpage` before Citations shows as a dashed line labeled "page break". Printing the HTML file from the browser starts Citations on a new page and doesn't draw the line. The preview shows the same line.
- [ ] PDF opens the print dialog with the document only (no app UI). Save as PDF: A4 or Letter as picked, no dark background, and Citations starts on a new page (the `\newpage` in the test project).
- [ ] A document with an error (like `\begin{itemize}` with no end) makes PDF and HTML show the error in the dialog, and nothing downloads.
- [ ] Cancel export during an HTML export stops it, says "Export canceled.", and keeps the dialog open. Escape closes the dialog.
- [ ] Download Project .zip (Ctrl+Shift+S) still downloads right away, without the dialog.

## Saving in the browser

- [ ] The save status in the header says when the project last saved.
- [ ] Reloading the page brings back the same project and files.
- [ ] Save Now (Ctrl+S) saves right away.
- [ ] View > Pause Saving stops autosave and Save Now, the menu shows it checked, and the status says "Saving paused".
- [ ] While paused, the palette shows Resume Saving, and leaving the page warns about unsaved edits.
- [ ] On a named project saved in this browser, type and reload within 4 seconds. No "Leave site?" box shows, the edit is still there, and the autosave saves it again after the reload.
- [ ] With Google Drive connected, type and close the tab within 4 seconds. The "Leave site?" box shows.
- [ ] An error from a library in the background (dev tools console: `Promise.reject(new Error('test'))`) only shows in the console. No red notice replaces the one in the header. A failed command (like a Drive action with the network blocked) still shows its red notice.
- [ ] Resuming saves the edits made while paused, and the paused setting survives a reload.
- [ ] Open Local Project (Ctrl+O) lists saved projects and opens the one you pick.
- [ ] Clear Local Projects asks first, then removes the saved projects. Templates saved in this browser stay.

## Templates and profile

- [ ] File > New Project (Ctrl+Shift+N, or Alt+Shift+N in a browser tab) opens the New project picker: Built-in (Empty project, Blank article, Technical report, Letter, Beamer slides, Thesis), My templates in this browser, and My templates in Google Drive ("Connect Google Drive..." when it isn't).
- [ ] Empty project is picked at first. Create project gives the old starter `main.tex`, unnamed.
- [ ] Arrow keys, Home and End move through the list. Enter only picks; it never creates a project.
- [ ] Each built-in template, created from the picker, previews with no error in the footer, in light and dark. The ⓘ list says what the preview approximated (Beamer: one page per frame).
- [ ] Edit > Profile… saves your name, affiliation and email. The picker fills them in, and typing `R&D_#1` as a name puts `R\&D\_\#1` in the new `main.tex`.
- [ ] Ticking "Save changed details to my profile" saves what you typed back into the profile.
- [ ] A project name typed in the picker names the new project and it saves right away; left empty, the project waits for a name.
- [ ] With a guest in the room, the picker says everyone gets the new project, and Create project is red.
- [ ] File > Save as Template… saves the project (with an image and a `.bib`) as a template. With your name in the project, "Turn my profile details into placeholders" is ticked, and the template has `{{name}}` where your name was.
- [ ] The saved template shows under My templates, and a project made from it has every file, image included.
- [ ] Edit opens the template like a project, and edits save into the template. Rename and Delete (with a confirm) work.
- [ ] Export .zip downloads `name.template.zip` with a `template.json`. Import .zip in the picker adds it back.
- [ ] Customize on a built-in template saves "My letter" (or similar) and opens it.
- [ ] The profile dialog's "Name in shared rooms" changes the name peers see. Clear profile empties the profile but leaves that name.
- [ ] Offline before the picker ever loaded (dev tools, Network: Offline, on a fresh load), New Project asks to start an empty project instead.

## Google Drive

These need Google dev keys in `.env.development.local` and a Google sign-in.

- [ ] Save as Template with Save to: Google Drive makes a `Templates` folder at the top of My Drive with the template in a subfolder and a `template.json`. It shows under My templates in Google Drive, and not in Open from Google Drive's project list.
- [ ] Saving the profile with Drive connected makes `Templates/profile.json`. Clear profile deletes it (not just to the trash).

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
- [ ] New link asks in a **Start a new link?** dialog with Keep current link (focused) and a red Start new link. Start new link starts a different room, and the old link stops working.
- [ ] Closing the guest window makes the host badge go back to Shared, waiting for others.
- [ ] Closing the host window makes the guest badge say Can't reach the host, with a notice that has help links.
- [ ] No WebRTC (issue #205): in a window where `RTCPeerConnection` is missing (Firefox with `media.peerconnection.enabled` off in `about:config`, or the Linux desktop app), the badge says Can't connect in this window. Share opens **Can't share from this window** with "This window can't make peer-to-peer connections, so it can't share or join a room." and a supported-browser suggestion, and no link shows. Opening a `?room=` link shows **Can't join from this window**, and the Files panel says so instead of Waiting for the host. The Network tab shows no `p2pTransport` chunk and no tracker connection, even after hovering Share.
- [ ] Guests can't use New Project, Open Local Project, Open from Google Drive, Upload .zip, or the Drive commands (Add Files from Drive included), from the menus, the palette or shortcuts. The upload dialog's Add Files from Drive button is off and says only the host can use it.
- [ ] Guests can still add, edit and upload files in the host's project.
- [ ] With a guest connected, the host's Open Local Project, Open from Google Drive, and Upload .zip as New Project ask first in an in-app dialog with a red button (Choose a project, Choose a .zip), saying it replaces the project for everyone in the room. Cancel opens no dialog or file picker and leaves both windows unchanged.
- [ ] With a guest connected, New Project's Start new project button is red and focus starts on Cancel.
- [ ] With a guest connected, Choose a project on Open Local Project and then Upload .zip in that dialog asks only once and opens the file picker.
- [ ] With nobody connected, those three open straight away without asking.
- [ ] With a guest connected, leaving the Upload .zip dialog open for more than 5 seconds and then clicking Choose a .zip (or Tab to it and Enter) still opens the file picker. If the browser ever blocks it, a notice says so and the next Upload .zip opens the picker without asking.
- [ ] The guest's header shows the project name and where the host saves.
- [ ] Presence: after Share, an avatar with your initials shows left of Share. Hovering it says "You (name) · click to rename". The first time, the name is an animal name like "Curious Otter".
- [ ] Presence: clicking your avatar opens **Your name in shared rooms**. A blank name is refused; a new name shows on the other window's avatar within a second.
- [ ] Presence: each window shows the other person's avatar in their colour. Its tooltip names them and the file they have open, and the file tree has a dot in their colour on that file.
- [ ] Presence: clicking into the editor on one side shows a caret with the name label on the other, in the same colour, and selecting text highlights it there. Moving to another file moves the dot and the caret goes away in the old file.
- [ ] Presence: clicking the other person's avatar opens their file and scrolls to their cursor. If they have no file open, a notice says so.
- [ ] Presence: two windows of the same browser (which share settings) still get different colours, and both windows agree on who has which. Reloading the guest gives it the same colour as before.
- [ ] Presence: with the other person's caret on line 1, its name label shows below the caret, not cut off at the top of the editor. On later lines it shows above.
- [ ] Presence: in the light and dark themes the initials, carets and name labels are readable. With a touch screen (or dev tools' touch emulation) the avatars are 44px.
- [ ] Presence: closing the guest window removes its avatar, dot and caret on the host right away. If the guest's network drops instead, they go within 30 seconds.
- [ ] Presence: a guest on a build from before presence still syncs with this one (it ignores the presence messages), and just doesn't show up in the avatars.
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
- [ ] Resting the mouse on a menu item for about a second opens a preview card beside the menu (never on top of its items), with the item's name, its shortcut, and what it does. View > Split View, Editor Only and Preview Only show the pane layout; New File, New Folder, Upload, Save Now, Export, Compile Now, Command Palette and the theme toggles show a small picture too; Help > Documentation shows only text. Moving to the next item swaps the card after a short wait. Moving off the menu closes it at once, and hovering never runs the command.
- [ ] Opening a menu with Enter or the arrow keys and resting on an item shows the same card, and arrowing on moves it. Enter hides the card and runs the item. Opening a menu with a click doesn't show a card until you hover an item.
- [ ] Toolbar buttons show their tooltip at once, then after about a second the preview card replaces it, under the button. Share shows the link being copied. Tabbing into the toolbar shows it too. Near the right edge of a narrow window the card stays on screen, and it reads well in the light and dark app themes.
- [ ] On a phone or tablet (touch), tapping a menu item or toolbar button never shows the preview card.
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
- [ ] Added keybinds are still there after a reload, and Reset to defaults asks in a **Reset keyboard shortcuts?** dialog (red Reset shortcuts, focus on Cancel) over Settings, then puts everything back. Escape closes only that dialog, not Settings.
- [ ] Upgrading keeps your settings: with keybinds, tour seen and themes saved by the previous version, the new version shows the same themes and keybinds and no tour. DevTools > Application > Local Storage then has `latex-editor.settings`, and `latex-editor.keybinds` and `latex-editor.tour-seen` are gone.
- [ ] Open the app in two tabs. Changing the theme, a keybind or the layout (View > Editor Only, or dragging the splitter) in one shows up in the other right away, Settings included if it's open.
- [ ] The layout mode and splitter position survive a reload.
- [ ] As a guest (a `?room=` link), change the theme and reload: the theme stays. The host's theme doesn't change.
- [ ] Settings > Export settings downloads `latex-editor-settings-YYYY-MM-DD.json`. In a private window, Import settings with that file brings back the themes, layout and keybinds, and the status line says how many were imported.
- [ ] Importing a file that isn't a settings file (any other `.json`, or a `.tex`) says so and changes nothing. A settings file with an unknown key imports the rest and names what it skipped.
- [ ] Settings > Reset to defaults turns red and says Click again to reset, and resets nothing until the second click. It lets go after a few seconds or when you pick another section. Resetting Themes leaves keybinds alone. Resetting Tour shows the tour again on the next load.
- [ ] With site data blocked for the page, Settings shows the note that settings only last for this tab, and changing them still works.
- [ ] The Settings dialog scrolls inside when the window is short, so Done and the footer stay on screen, also at phone width.
- [ ] Dialog sizes follow `docs/ui-sizing.md`: confirm and name dialogs (delete a file, New File) are small, Upload, Export, About, Open a project and the conflict dialog are medium, and Settings is large. At 1024px and wider, Settings shows two columns with Keyboard shortcuts on the right. At 1280, 1024 and 768 wide, no dialog, popover or card runs past the window edge or scrolls sideways, and every footer's buttons fit (Open a project's Close button included).
- [ ] At phone width (DevTools at 360 x 640), Upload, Export, About, Open a project, the conflict dialog and Settings fill the whole screen with square corners: the title and X at the top, the buttons at the bottom, and only the middle scrolls. Nothing scrolls sideways, and Settings is one column. Confirm and name dialogs (New File, delete a file) stay a small centred card. At 640px and wider they all look as before.
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
- [ ] Help > About > View changelog opens What's new on top of About. It shows "Unreleased (in this build)" first, then each version newest first with its date, and the running version has a "You're on this version" badge (none in `npm run dev`, which is a dev build). The list scrolls, Tab stays inside the dialog, and Esc or Close goes back to About with focus on View changelog. Links open GitHub in a new tab, and it reads well in the light and dark app themes.
- [ ] The footer ends with a small `vX.Y.Z` link. Hovering it shows the commit and build date, and clicking it opens the commit.
- [ ] The bug form's extra info says `App version: X.Y.Z+abc1234`.
- [ ] The toolbar under the menus runs the same commands as the menus, shows tooltips on hover, and its buttons are disabled in the same cases.
- [ ] Tab moves into the toolbar, the arrow keys move between its buttons, and Home and End jump to the ends.
- [ ] The ? help links next to Share, the save status, the file list and the preview open the matching docs page.
- [ ] A failed save or a blocked popup shows a notice with a Learn more link.
- [ ] In a fresh private window, the first-run tour shows once. Skip tour and Esc close it, and Help > Show Tour runs it again.
- [ ] Each tour card sits next to what it points at without covering it: beside the file list, editor and preview, below the menus and toolbar. In a small window the card stays fully on screen and covers as little of the highlighted part as it can.
- [ ] The page works at phone width without scrolling sideways.

### Phone pass (under 640px)

Use DevTools device mode at 360 x 640 and 390 x 844, or a real phone.

- [ ] The editor and preview never show side by side. A bar under the toolbar has Files, Editor and Preview, each at least 44px tall, and the Split, Editor only and Preview only toolbar buttons are hidden.
- [ ] Tapping Preview shows only the preview, and Editor shows only the editor. The pressed one is highlighted. Reloading the tab keeps the choice, and a new tab starts on the editor.
- [ ] Files opens the file list as a drawer over the editor, with a dimmed backdrop. Picking a file closes the drawer and opens that file in the editor, even if the preview was showing.
- [ ] Tapping the backdrop, tapping Files again or pressing Esc closes the drawer, and focus goes back to Files.
- [ ] With a keyboard, Tab reaches Files, Editor and Preview, and Enter switches. With the drawer open, Tab stays out of the editor and preview behind it. A screen reader reads Editor and Preview as toggle buttons (pressed or not) and Files as expanded or collapsed.
- [ ] View > Editor Only and Preview Only switch the pane on a phone.
- [ ] Nothing scrolls sideways with the editor, the preview or the drawer showing.
- [ ] Widening the window past 640px with the drawer open brings back the normal three-pane layout, and the drawer doesn't come back when you narrow it again. At 768 and 1280 wide the layout looks the same as before.

## Build

- [ ] `npm run build` passes and reports the gzipped size under the budget.
- [ ] `npm run test:e2e` from the repo root passes the two-browser sync test (it uses public relays, so retry once if it times out).
- [ ] `dist/` has `privacy.html` and `tos.html`, and no `regression.html` and no regression test files. `npm run build` checks this and fails if it's wrong.
- [ ] In `npm run preview`, the Privacy and ToS links in the footer and in Help > About open the policy pages, not a 404.
- [ ] The build's lazy chunks list `p2pTransport`, `commandPalette`, `settingsDialog`, `keybindSettings`, `tour`, `projectsDialog`, `uploadDialog`, `aboutDialog`, `conflictDialog`, `driveAddFiles`, `googlePicker` and `zip` chunks, and the initial load is under the budget it prints.
- [ ] In `npm run preview` with the Network tab open and nothing touched, `p2pTransport` doesn't load until you hover or focus Share (or open a `?room=` link, where it loads right away). Ctrl+P, Ctrl+, (Settings), Help > Tour, File > Open Local Project and File > Upload Files each open on the first press, right after a reload too. The lint gutter shows a marker on a broken line, and the editor text doesn't jump sideways when the page finishes loading.
- [ ] In `npm run preview`, block the `commandPalette-*.js` request in dev tools (Network > Block request URL), reload, and press Ctrl+P: a red notice says the command palette couldn't load and to check your connection, then reload. No update card shows, since `version.json` still names this build. Unblock it and reload: Ctrl+P works.
- [ ] Same as above, but first edit `dist/version.json` to another commit: now the update card says part of the app couldn't load because a new version is live, and offers Reload to update.
- [ ] In `npm run preview`, open the app, set dev tools to Offline (Network > No throttling > Offline) and press Ctrl+Shift+E. A notice says "You're offline. Export will load when you're back online." and no update card shows. Go back online: the notice clears and the Export dialog opens by itself. Help > About and Ctrl+P also work after going back online.
- [ ] Offline, choose File > Upload .zip as New Project and pick a zip (before the zip code has loaded): the notice says you're offline and Import .zip will work once you're back online. Online again, the same zip imports.
- [ ] The build's lazy chunks list a `changelogView` chunk, and the changelog text isn't in the initial `index-*.js`. In `npm run preview`, Help > About > View changelog loads it with no CSP errors in the console.
- [ ] `dist/CHANGELOG.md` matches the repo-root `CHANGELOG.md`. In `npm run preview`, edit `dist/CHANGELOG.md` to add a `## [9.9.9]` section, then show the update card (dev tools: remove `hidden` from `#update-prompt`) and click What's new: 9.9.9 says "New in the update" and the running version says "You're on this version". With `dist/CHANGELOG.md` deleted, it shows this build's changelog with a note linking to GitHub.
- [ ] `npm run preview` serves the built app, and the palette has no regression commands.
- [ ] `dist/version.json` has the `version` from `package.json`, the short commit, the build time and `"env": "production"`. `/version.json` also works in `npm run dev`, with `"env": "dev"`.
- [ ] A plain `npm run build` shows no Staging badge, and `dist/` has no `robots.txt` and no `noindex` meta tag.
- [ ] `VITE_DEPLOY_ENV=staging npm run build`, then `npm run preview`: a small grey **Staging** badge sits next to the project name in the header, its tooltip says it's a staging build, and it doesn't push the menus onto another line at 1280 wide (at 360 wide it fits next to the name). It reads well in the light and dark app themes. `dist/version.json` says `"env": "staging"`, every page has `<meta name="robots" content="noindex">`, and `dist/robots.txt` disallows everything.
- [ ] `VITE_DEPLOY_ENV=stage npm run build` fails with a message listing production, staging and dev.
- [ ] On the staging site, Share and join from a second tab: they sync. A tab on the production site with the same room link never sees the staging peer.
- [ ] In `npm run preview`, open the app, then edit `dist/version.json` to another commit and switch to another tab and back (or wait 15 minutes). The "A new version of the app is available" card shows in the bottom corner without taking focus from the editor, in light and dark themes.
- [ ] Type something, then click Reload to update. The autosave pill shows Saving, then Saved, then the page reloads with no "Leave site?" box, and the edit is still there.
- [ ] Later hides the card, and it doesn't come back for the same version. It shows again for another version.
- [ ] `npm run dev` never fetches `version.json` on its own.

## Desktop app (experimental)

Needs the desktop build (`npm run build` in `desktop/`, or an artifact from the **Desktop app** workflow). See `docs/desktop.md`.

- [ ] `npm run check` in `desktop/` passes, and the app opens on the editor with no network page in between (it loads the bundled build).
- [ ] The File menu shows Ctrl+N for New File and Ctrl+Shift+N for New Project (⌘N and ⇧⌘N on a Mac), and both work. Settings > Keyboard shortcuts says "Keys shown are for the desktop app".
- [ ] Ctrl+W (⌘W on a Mac) doesn't close the window when it's bound to a command. On a Mac, ⌘Q still quits and ⌘C, ⌘V and ⌘Z work in the editor.
- [ ] Projects made in the app are still there after quitting and opening it again, and are separate from the browser's.
- [ ] On Windows and macOS, Share in the app and join from a browser with the link: text and an uploaded image sync both ways. On Linux, where the system WebKitGTK has no WebRTC, Share opens **Can't share from this window** with **Open in browser** and **Not now**. Open in browser opens the web app in the system browser. A build without an https `VITE_DOCS_BASE_URL` only explains, with a Close button.
