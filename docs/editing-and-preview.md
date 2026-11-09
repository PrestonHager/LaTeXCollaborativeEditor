# Editing and preview

## Editor

The editor is built for **LaTeX source**: environments, macros, and plain text. Standard **Edit** menu actions apply: undo, redo, cut, copy, paste, and select all. Undo history is kept in memory for your session (up to a limited depth).

Collaborative sessions use a shared text model: edits from other participants appear in the same buffer you are editing.

## Live preview

The **preview** turns your source into **HTML** using a LaTeX-oriented renderer in the browser. It is meant for a quick, readable approximation of your document—not a full TeX engine with every package and font your thesis might rely on.

- Preview updates on a **short delay** after you stop typing so the UI stays responsive.
- There is also a **minimum interval** between heavy preview passes so rapid changes do not queue unbounded work.
- While a pass is running, the preview may show a **loading** state.

Use **View → Compile Now** (or the shortcut in [Keyboard shortcuts](keyboard-shortcuts.md)) if you want to trigger a refresh without waiting for the debounced run.

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

When the preview step reports problems (for example parse issues), the editor can show **diagnostics** tied to lines in your source, and the **footer** may summarize the first issue.

If there are no problems, the diagnostics line in the footer stays **empty** so it does not clutter the UI.

## Layout

You can show **only the editor**, **only the preview**, or **split** both—see [Interface and layout](interface-layout.md).

## Tips

- Start from a minimal `\documentclass` … `\begin{document}` … `\end{document}` block and grow your file.
- Very large documents may feel slower in preview; consider splitting work or compiling heavy sections elsewhere if you hit limits.
