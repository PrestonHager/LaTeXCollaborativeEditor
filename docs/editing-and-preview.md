# Editing and preview

## Editor

The editor is made for LaTeX source.
It has syntax highlighting, line numbers, bracket matching, and auto-closing brackets.
**Tab** indents the line.

The **Edit** menu has Undo, Redo, Cut, Copy, Paste, and Select All.

- Undo and redo only undo your own typing, not a collaborator's.
- Each file has its own undo history, and it starts over when you switch files.
- File operations have a history of their own. See [Undoing file operations](#undoing-file-operations).

### Undoing file operations

Creating, renaming, moving, deleting and uploading files and folders, and **Add Files from Drive**, can be undone.
This history is apart from the editor's, like the Explorer in VS Code:

- With focus in the editor, **Ctrl+Z** (**⌘Z** on a Mac) undoes typing in the open file, as always.
- With focus in the **Files** panel, **Ctrl+Z** undoes your last file operation, and **Ctrl+Shift+Z** or **Ctrl+Y** redoes it.
- **Edit > Undo** and **Redo** follow the same rule. While the Files panel has focus or was the last thing you used, they say what they'll do, like **Undo Delete chapter.tex**.
- After a delete, rename or move, the notice at the top says what happened and has an **Undo** button, so you don't have to find the Files panel first.

What it covers:

- Only your own file operations, never a collaborator's. If someone else renamed or deleted the same file since, that part of your undo is skipped and a notice says so.
- Undoing a delete brings the file back with its text, including edits a collaborator made to it before the delete reached them. Deleted images and PDFs come back too: the app keeps their bytes for as long as the operation can be undone.
- If someone made a new file at the same path since, yours comes back next to it as `name (restored).ext`, and theirs stays as it was. A folder someone made again just merges with yours, and only files that clash get the `(restored)` name.
- The history keeps your last 50 file operations, and it starts over when you open, import or start another project.
- In a project saved to Google Drive, undoing a delete takes the same Drive file out of the trash on the next save, instead of making a copy. After a reload, or once the Drive trash is emptied, the next save writes it as a new file. Undoing **Add Files from Drive** moves those files to the Drive trash, and Redo takes them back out.

The bar above the editor shows the open file's path, and a **main** badge if it's the main file.
Images and PDFs open in a viewer instead of the editor. See [Projects and files](projects.md#viewing-images-and-pdfs).

In a shared room, everyone types into the same files, and you see their edits as they happen.

## Live preview

The preview turns your project into a web page, right in your browser, using LaTeX.js.
It's a quick, readable version of your document, not a full TeX engine.

![The preview next to the editor](assets/screenshots/overview-light.png#only-light)
![The preview next to the editor](assets/screenshots/overview-dark.png#only-dark)

What it reads:

- It starts from the [main file](projects.md#main-file).
- It pulls in `\input` and `\include` files from the project.
- `\includegraphics` shows PNG, JPG, GIF, WebP, SVG and PDF figures from the project. It follows `\graphicspath` and the size options `width`, `height`, `scale` and `keepaspectratio`, with relative sizes like `0.5\textwidth` and absolute ones like `5cm` or `2in`. With only a width or a height, the image keeps its proportions. A height relative to `\textheight` is ignored, since the preview has no page height. See [Figures](#figures) for PDF and EPS.
- `\cite` and `\bibliography` become citations and a reference list built from your `.bib` files, in the style set by `\bibliographystyle`. See [Bibliography](#bibliography).

When it runs:

- After you stop typing for half a second.
- At most about once a second while you keep typing, so the page stays smooth.
- When an image arrives from a peer.
- When you choose **View > Compile Now** (**Ctrl+Enter**).

The compile pill in the header says **Waiting**, **Compiling**, then **Compiled**.
While it runs, the preview shows "Updating preview...".

The preview builds in a background worker, so typing doesn't freeze on a big document.
If you type again while it's still building, the old build gets thrown away and a new one starts.
If the browser can't start the worker, or the project uses the `picture` environment (it needs real page layout), the build runs on the page itself instead.
The pill text is the same either way.

The preview runs in a locked-down frame, so a collaborator's links or code can't reach the app.
Its fonts and styles load from a CDN.
Your LaTeX stays in your browser.

When the preview updates, it keeps your scroll position instead of jumping back to the top.

### Links in the preview

- Clicking a cross-reference made with `\ref` scrolls the preview to that section, figure or equation.
  It works across files too, since the preview is one combined document.
- A `\ref` to a label that doesn't exist shows `??` as plain text, not a link.
- Clicking an `\href` or `\url` link to an `http`, `https` or `mailto` address opens it in a new tab (or your mail app).
  The new tab has no connection back to the editor.
- Links with any other scheme do nothing when clicked.
  `javascript:` and `data:` links are removed before the preview shows, so they appear as plain text.

How it works: the editor adds a small script of its own to the preview frame.
Clicks on in-page links scroll inside the frame.
Clicks on other links never load anything in the frame.
The frame asks the editor to open the link. The editor checks that the request came from the preview frame, that the address is `http`, `https` or `mailto`, and that you just clicked (the browser's user activation). Without a click, nothing opens. Browsers without user activation tracking open at most one link every 1.5 seconds.
The frame itself still can't open windows or reach the app.

For what doesn't work, like EPS figures, see [What's supported](whats-supported.md).

### Figures

Which figure formats the preview can show:

| Format | In the preview |
| --- | --- |
| PNG, JPG, GIF, WebP, SVG | Shown as they are. |
| PDF | One page, drawn as an image. |
| EPS | An empty box the size of the figure, with its name. |

**PDF figures.** The preview draws the page with [pdf.js](https://mozilla.github.io/pdf.js/), which loads the first time a document uses a PDF figure.
It shows page 1, or the page you pick with `page=`, like `\includegraphics[page=2]{plots.pdf}`.
With no size options, the figure shows at its own size, like in LaTeX. `width`, `height`, `scale` and `keepaspectratio` work as they do for images.
`trim=left bottom right top` and `viewport=llx lly urx ury` cut the figure down, in `bp` unless you give a unit.
In the preview they always cut it off, as if `clip` were set. Without `clip`, LaTeX would let the figure spill past the edges, so the ⓘ list says the preview cut it.
Each page is drawn once and kept until you reload, so typing doesn't redraw it. Changing the file draws it again.
If a page can't be drawn, like `page=5` in a 2-page file, the preview shows a box with the reason, and the ⓘ list says so too.
The figure is a picture of the page, so its text can't be selected or searched.

**EPS figures.** The browser can't draw PostScript, and the converters that can, like Ghostscript, aren't part of the editor.
So the preview shows a dashed box the size of the figure, read from the file's `%%BoundingBox`, with the file name and "EPS can't be previewed; convert it to PDF."
Size options work on the box like on an image. A file with no `%%BoundingBox` gets a 4 by 3 inch box.
To see the figure, convert it to PDF, for example with `epstopdf figure.eps` on a computer with TeX installed, and upload the PDF.
A full TeX engine in the browser would draw EPS too; that's planned.

## What the preview supports

The preview uses [LaTeX.js](https://latex.js.org/), which covers the basics of the `article` class: sections, lists, math, `\href` and `\url`, and text formatting.
It can't load most packages, so before typesetting, the editor strips or rewrites the things below.
Your source isn't changed, only the copy sent to the preview.

When something gets stripped or rewritten, a small info button (ⓘ) shows in the preview's bar, next to the `?` help link, with the number of changes.
Its tooltip says "Preview is approximate: 3 changes" (or however many there are).
Click it, or press Enter on it, to see the list, with a link to [What's supported](whats-supported.md).
Esc, or a click anywhere else, closes it.
The document itself stays as it is, with no note on top.
When nothing needed changing, the button isn't there.

![The preview's info button, open, listing one change](assets/screenshots/preview-changes-light.png#only-light)
![The preview's info button, open, listing one change](assets/screenshots/preview-changes-dark.png#only-dark)

Stripped:

- These packages: `geometry`, `indentfirst`, `gensymb`, `fontspec`, `fancyhdr`, `nomencl`, `authblk`, `textcomp`, `float`.
- `\hypersetup{...}`, `\geometry{...}`, and `\setmainfont{...}`.
- fancyhdr setup: `\pagestyle{fancy}`, `\fancyhf{}`, `\fancyhead[...]{...}`, and `\renewcommand{\headrulewidth}{...}`.
- nomencl setup: `\makenomenclature`, `\printnomenclature`, and `\renewcommand{\nomname}{...}`.
- `\vspace{...}`, `\vspace*{...}`, and `\addcontentsline{...}{...}{...}`.

Rewritten:

- `figure` (with or without `[H]`) becomes a `center` block, so figures show where they are in the source.
- `\caption{...}` becomes a bold line.
- `\footnote{...}` shows inline, in italics and parentheses.
- `\includegraphics` shows images and PDF figures from the project. An EPS figure becomes an empty box of the same size, and a file that's missing or can't be shown gets a short note instead.
- `\nomenclature{symbol}{meaning}` shows just the symbol.
- authblk's `\author[...]{...}` drops the option, and `\affil{...}` becomes a small line of text.
- `\textcopyright` becomes ©.
- `\newpage`, `\clearpage`, `\cleardoublepage` and `\pagebreak` on a line of their own become a page break when you [export a PDF](#pdf-export) or print the HTML export. On screen, in the preview and the HTML export, they show as a dashed line labeled "page break". The line is never printed. One in the middle of a line is ignored.

Comments, `\verb`, and the `verbatim`, `verbatim*`, `Verbatim`, `lstlisting`, `minted`, and `comment` environments are left alone.
Anything not listed here goes to LaTeX.js as is, and if it doesn't know a command, the error shows up in the diagnostics.

## Bibliography

LaTeX.js has no BibTeX, so the preview reads your `.bib` files and formats the references itself.
It looks for `\bibliography{refs}` (or biblatex's `\addbibresource{refs.bib}`) next to the main file first, then at the top of the project.
The reference list goes where `\bibliography` or `\printbibliography` is.

`\bibliographystyle` picks the style:

| Style | Order | Labels | Names |
| --- | --- | --- | --- |
| `plain` | Sorted by author, year, title | `[1]` | Donald E. Knuth |
| `unsrt` | Order of first citation | `[1]` | Donald E. Knuth |
| `abbrv` | Sorted | `[1]` | D. E. Knuth |
| `alpha` | Sorted | `[Knu84]` | Donald E. Knuth |
| `ieeetr`, `IEEEtran` | Order of first citation | `[1]` | D. E. Knuth, with the title in quotes |
| `apalike` | Sorted | `[Knuth, 1984]` | Knuth, D. E. (1984) |
| `plainnat`, `abbrvnat`, `unsrtnat` | Like `plain`, `abbrv`, `unsrt` | `Knuth (1984)`, or `[1]` with `\usepackage[numbers]{natbib}` | As in `plain` or `abbrv` |

With biblatex, `style=numeric`, `alphabetic`, `authoryear` and `ieee` map to `plain`, `alpha`, `apalike` and `ieeetr`, and `sorting=none` keeps citation order.
With no style at all, the preview uses `plain`.
Any other style also uses `plain`, and an info note on the `\bibliographystyle` line says so.

Article and paper titles are lowercased after the first word, like BibTeX does, so put braces around words that must keep their capitals, like `{BibTeX}`.
`@string` abbreviations and `#` joins work, and month names like `jan` become full or short month names.

Cite commands:

- `\cite`, `\citep`, `\parencite`, `\autocite` and `\footcite` give `[1]` (or `(Knuth, 1984)` for `\citep` in author-year styles).
- `\citet` and `\textcite` give `Knuth [1]` or `Knuth (1984)`.
- `\citealp`, `\citealt`, `\citeauthor` and `\citeyear`, and capitalized forms like `\Citet`.
- Notes, like `\cite[p.~5]{knuth}` for `[1, p. 5]` and `\citep[see][ch.~2]{knuth}` for a note before and after.
- `\nocite{key}` adds an entry to the list without citing it, and `\nocite{*}` adds every entry.

A key that isn't in any `.bib` file shows as `[?]`, with a warning on that line.

## Diagnostics

When the preview hits a problem, you see it in two places:

- The **footer** says how many problems there are and shows the first one, with its file and line, like `1 diagnostic(s). ... (chapters/intro.tex line 4)`.
- The **editor** puts a red mark on that line, if that file is open. Warnings, like a cite key that isn't in the bibliography, and notes, like an unsupported bibliography style, get their own colors.

If a file named in `\input`, `\includegraphics`, or `\bibliography` isn't in the project, the footer says **Not found in the project:** and lists it.

If there are no problems, the footer is empty.

![A preview error in the footer and the editor](assets/screenshots/diagnostics-light.png#only-light)
![A preview error in the footer and the editor](assets/screenshots/diagnostics-dark.png#only-dark)

For help fixing errors, see [Preview errors](troubleshooting.md#preview-errors).

## PDF export

**File > Export…** and then **PDF** makes a PDF from the preview.
It opens your browser's print dialog. Choose **Save as PDF** (or **Microsoft Print to PDF**) as the printer, then save.

It's a preview-quality PDF, so expect it to look like the preview, not like a TeX build:

- Fonts, math and spacing come from LaTeX.js and the browser, so line and page breaks fall in different places than in LaTeX.
- Pages break where the browser runs out of room, plus at `\newpage`, `\clearpage` and `\pagebreak` lines. Headings try not to end a page, and images and tables try not to split.
- The paper size is A4 or US Letter, with 2 cm side margins and 2.5 cm top and bottom ones. `geometry` settings don't apply.
- There are no page numbers, headers or footers. If your browser adds its own date and URL, turn off **Headers and footers** in the print dialog.
- Links in the text work in the PDF. There are no PDF bookmarks.
- Anything the preview can't show, like an EPS figure, shows the same way in the PDF.

The PDF is made in a hidden frame that can't run scripts, so nothing in the document runs while it prints.
A full PDF from a real TeX engine, with bookmarks and metadata, needs an in-browser TeX compiler, which is planned.
For a file to send to a journal, export **Flattened .tex** or **Project .zip** and build it with LaTeX.

The same export menu has an **HTML** format: the preview as a standalone web page. See [Export](saving-and-storage.md#export).

## Layout

You can show only the editor, only the preview, or both side by side.
See [Interface and layout](interface-layout.md#layout-modes).

## Tips

- Start from a small `\documentclass` ... `\begin{document}` ... `\end{document}` file and grow it.
- Split big documents into chapters with `\input`, so each file stays easy to work on.
- Very large documents can make the preview slow.
