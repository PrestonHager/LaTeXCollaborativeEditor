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

## Diagnostics

When the preview step reports problems (for example parse issues), the editor can show **diagnostics** tied to lines in your source, and the **footer** may summarize the first issue.

If there are no problems, the diagnostics line in the footer stays **empty** so it does not clutter the UI.

## Layout

You can show **only the editor**, **only the preview**, or **split** both—see [Interface and layout](interface-layout.md).

## Tips

- Start from a minimal `\documentclass` … `\begin{document}` … `\end{document}` block and grow your file.
- Very large documents may feel slower in preview; consider splitting work or compiling heavy sections elsewhere if you hit limits.
