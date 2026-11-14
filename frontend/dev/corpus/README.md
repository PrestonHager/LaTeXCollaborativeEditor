# Overleaf-style compatibility corpus

Seven small documents of the kinds people bring over from Overleaf (issue #197, part of #43).
Each one compiles on Overleaf with the compiler noted at the top of its main file.
They were written for this repository and are under its license (GPL-3.0, see `LICENSE`).

| Folder | Main file | Overleaf compiler | What it covers |
|--------|-----------|-------------------|----------------|
| `article/` | `main.tex` | pdfLaTeX | A plain article: sections, lists, math, a table, footnotes, cross-references |
| `beamer/` | `main.tex` | pdfLaTeX | A beamer deck: frames, blocks, columns, overlays |
| `tikz/` | `main.tex` | pdfLaTeX | A TikZ figure inside a figure environment |
| `biblatex/` | `main.tex` | pdfLaTeX (Biber) | biblatex with `\addbibresource`, `\textcite`, `\parencite`, `\printbibliography` |
| `custom-class/` | `main.tex` | pdfLaTeX | A local `report-note.cls` with its own commands |
| `xelatex/` | `main.tex` | XeLaTeX | `fontspec` with `\setmainfont` and non-Latin text |
| `thesis/` | `main.tex` | pdfLaTeX | A multi-file thesis: `\include` chapters, front matter, a `.bib`, `\appendix` |

`frontend/src/dev/compatCorpus.ts` runs each one through the preview pipeline and
`npm run test:corpus` (in `frontend/`) checks the result against the baseline in
`docs/compatibility-baseline.md`. `npm run corpus:update` rewrites that baseline.

None of this is imported by production code, so `npm run build` leaves it out.
