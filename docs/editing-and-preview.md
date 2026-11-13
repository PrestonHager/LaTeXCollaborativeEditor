# Editing and preview

## Editor

The editor is made for LaTeX source.
It has syntax highlighting, line numbers, bracket matching, and auto-closing brackets.
**Tab** indents the line.

The **Edit** menu has Undo, Redo, Cut, Copy, Paste, and Select All.

- Undo and redo only undo your own typing, not a collaborator's.
- Each file has its own undo history, and it starts over when you switch files.
- File operations like delete and rename can't be undone.

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
- `\includegraphics` shows PNG, JPG, GIF, WebP, and SVG images from the project. It follows `\graphicspath`, and widths like `width=0.5\textwidth`.
- `\cite` and `\bibliography` become a numbered reference list built from your `.bib` files.

When it runs:

- After you stop typing for half a second.
- At most about once a second while you keep typing, so the page stays smooth.
- When an image arrives from a peer.
- When you choose **View > Compile Now** (**Ctrl+Shift+C**).

The compile pill in the header says **Waiting**, **Compiling**, then **Compiled**.
While it runs, the preview shows "Updating preview...".

The preview builds in a background worker, so typing doesn't freeze on a big document.
If you type again while it's still building, the old build gets thrown away and a new one starts.
If the browser can't start the worker, or the project uses the `picture` environment (it needs real page layout), the build runs on the page itself instead.
The pill text is the same either way.

The preview runs in a locked-down frame, so a collaborator's links or code can't reach the app.
Its fonts and styles load from a CDN.
Your LaTeX stays in your browser.

For what doesn't work, like PDF figures and BibTeX styles, see [What's supported](whats-supported.md).

## What the preview supports

The preview uses [LaTeX.js](https://latex.js.org/), which covers the basics of the `article` class: sections, lists, math, `\href` and `\url`, and text formatting.
It can't load most packages, so before typesetting, the editor strips or rewrites the things below.
Your source isn't changed, only the copy sent to the preview.

When something gets stripped or rewritten, a small "Preview is approximate" note shows at the top of the preview.
Click it to see the list.

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
- `\includegraphics` shows images from the project, and anything else (like a PDF or EPS figure, or a missing file) gets a short note instead.
- `\nomenclature{symbol}{meaning}` shows just the symbol.
- authblk's `\author[...]{...}` drops the option, and `\affil{...}` becomes a small line of text.
- `\textcopyright` becomes ©.

Comments, `\verb`, and the `verbatim`, `verbatim*`, `Verbatim`, `lstlisting`, `minted`, and `comment` environments are left alone.
Anything not listed here goes to LaTeX.js as is, and if it doesn't know a command, the error shows up in the diagnostics.

## Diagnostics

When the preview hits a problem, you see it in two places:

- The **footer** says how many problems there are and shows the first one, with its file and line, like `1 diagnostic(s). ... (chapters/intro.tex line 4)`.
- The **editor** puts a red mark on that line, if that file is open.

If a file named in `\input`, `\includegraphics`, or `\bibliography` isn't in the project, the footer says **Not found in the project:** and lists it.

If there are no problems, the footer is empty.

![A preview error in the footer and the editor](assets/screenshots/diagnostics-light.png#only-light)
![A preview error in the footer and the editor](assets/screenshots/diagnostics-dark.png#only-dark)

For help fixing errors, see [Preview errors](troubleshooting.md#preview-errors).

## Layout

You can show only the editor, only the preview, or both side by side.
See [Interface and layout](interface-layout.md#layout-modes).

## Tips

- Start from a small `\documentclass` ... `\begin{document}` ... `\end{document}` file and grow it.
- Split big documents into chapters with `\input`, so each file stays easy to work on.
- Very large documents can make the preview slow.
