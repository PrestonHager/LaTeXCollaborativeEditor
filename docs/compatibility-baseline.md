# Overleaf compatibility baseline

How the browser preview copes with the kinds of documents people bring over from Overleaf
(issue #197, part of #43). Later engine work is measured against this page: when a change
moves a result, the baseline below changes in the same PR.

## The corpus

Seven small documents live in `frontend/dev/corpus/`, one folder each, with `main.tex` as the main file:
an article, a beamer deck, a TikZ figure, a biblatex document, a document with a custom `.cls`,
a XeLaTeX document using `fontspec`, and a multi-file thesis. They were written for this
repository and compile on Overleaf with the compiler listed for each. See the corpus `README.md`.

The corpus is dev-only. Nothing in production imports it, so `npm run build` leaves it out
(`src/dev/compatCorpus.test.ts` checks that no production module imports it).

## How it runs

`frontend/src/dev/compatCorpus.ts` sends each document through `projectToPreviewHtml`
(`frontend/src/compile/`), the same call the compile worker makes. That includes the adapter's
unsupported-package diagnostics (#196), the bibliography builder and `\input`/`\include` expansion.

Each document gets one result:

- **Pass**: the preview shows the document, with info notes at most (a package left out or stood in for).
- **Warning**: the preview shows it, but something is missing: a warning diagnostic (a package
  whose features don't show, an unknown citation) or a file it couldn't find.
- **Fail**: the preview shows nothing. LaTeX.js stops at the first error, so a failing document
  lists only the first thing that stopped it; fixing that can uncover the next one.

Long parse errors are cut to 160 characters. "What the preview changed" lists what the adapter
removed or rewrote for LaTeX.js, which the preview pane also shows.

In `frontend/`:

- `npm run test:corpus` runs the corpus and checks it against the baseline below. The regular
  `npm run test:run` and `npm run test:coverage` run this check too, so CI fails when a result moves.
- `npm run corpus:update` rewrites the baseline below from a fresh run. Commit it with the change that moved it.

## Baseline

Recorded on 2026-11-14 against `staging` at version 0.1.1.

<!-- corpus-report:start -->
**1 pass, 0 warning, 6 fail** out of 7 documents.

| Document | Overleaf compiler | Result | Errors | Warnings | Info | Missing files |
|----------|-------------------|--------|--------|----------|------|---------------|
| `article` Article | pdfLaTeX | Fail | 1 | 0 | 6 | 0 |
| `beamer` Beamer deck | pdfLaTeX | Fail | 1 | 0 | 1 | 0 |
| `tikz` TikZ figure | pdfLaTeX | Fail | 1 | 1 | 0 | 0 |
| `biblatex` biblatex document | pdfLaTeX + Biber | Pass | 0 | 0 | 4 | 0 |
| `custom-class` Custom .cls | pdfLaTeX | Fail | 1 | 0 | 0 | 0 |
| `xelatex` XeLaTeX with fontspec | XeLaTeX | Fail | 1 | 0 | 1 | 0 |
| `thesis` Multi-file thesis | pdfLaTeX | Fail | 1 | 0 | 7 | 0 |

### `article`: Fail

| Severity | Where | Message |
|----------|-------|---------|
| error | `main.tex:36` | SyntaxError: unknown macro: \eqref |
| info | `main.tex:3` | The preview leaves out the inputenc package. The preview reads Unicode already. |
| info | `main.tex:4` | The preview leaves out the fontenc package. The preview reads Unicode already. |
| info | `main.tex:5` | The preview leaves out the geometry package. The preview uses its own page size and margins. |
| info | `main.tex:6` | The preview uses a stand-in for the amsmath package. KaTeX draws the math; numbered equations show without their numbers. |
| info | `main.tex:6` | The preview leaves out the amssymb package. KaTeX draws the math, and has most of these commands. |
| info | `main.tex:8` | The preview uses a stand-in for the booktabs package. Tables the preview can't draw show as a note. |

What the preview changed:

- Removed packages the preview can't load: inputenc, fontenc, geometry, amsmath, amssymb, booktabs.
- Showed numbered equations without their numbers.
- Put a note in place of tables the preview can't show.
- Showed \caption as bold text.
- Showed footnotes inline in parentheses.

### `beamer`: Fail

| Severity | Where | Message |
|----------|-------|---------|
| error | `main.tex:8` | SyntaxError: expected \begin{document} |
| info | `main.tex:5` | The preview uses a stand-in for the amsmath package. KaTeX draws the math; numbered equations show without their numbers. |

What the preview changed:

- Removed packages the preview can't load: amsmath.
- Showed Beamer frames as pages, without the theme.
- Ignored commands the preview has no use for: \usetheme, \usecolortheme, \institute, \pause.

### `tikz`: Fail

| Severity | Where | Message |
|----------|-------|---------|
| error | `main.tex:13` | SyntaxError: unknown environment: tikzpicture |
| warning | `main.tex:3` | The preview can't load the tikz package. The preview can't draw TikZ pictures; the first tikzpicture stops it with an error. |

What the preview changed:

- Removed packages the preview can't load: tikz.
- Showed figures in place instead of floating.
- Showed \caption as bold text.
- Ignored commands the preview has no use for: \usetikzlibrary.

### `biblatex`: Pass

| Severity | Where | Message |
|----------|-------|---------|
| info | `main.tex:3` | The preview leaves out the inputenc package. The preview reads Unicode already. |
| info | `main.tex:4` | The preview leaves out the babel package. Hyphenation and names like "Contents" stay in English. |
| info | `main.tex:5` | The preview uses a stand-in for the csquotes package. \enquote shows plain quotation marks. |
| info | `main.tex:6` | The preview uses a stand-in for the biblatex package. The preview builds the bibliography itself, in an approximate style. |

What the preview changed:

- Removed packages the preview can't load: inputenc, babel, csquotes, biblatex.

### `custom-class`: Fail

| Severity | Where | Message |
|----------|-------|---------|
| error | `main.tex:1` | Error: error loading documentclass "report-note" |

### `xelatex`: Fail

| Severity | Where | Message |
|----------|-------|---------|
| error | `main.tex:5` | SyntaxError: expected \begin{document} |
| info | `main.tex:3` | The preview leaves out the fontspec package. The preview uses its own fonts. |

What the preview changed:

- Removed packages the preview can't load: fontspec.
- Removed \setmainfont.

### `thesis`: Fail

| Severity | Where | Message |
|----------|-------|---------|
| error | `main.tex:14` | SyntaxError: expected \begin{document} |
| info | `main.tex:3` | The preview leaves out the inputenc package. The preview reads Unicode already. |
| info | `main.tex:4` | The preview leaves out the fontenc package. The preview reads Unicode already. |
| info | `main.tex:5` | The preview leaves out the geometry package. The preview uses its own page size and margins. |
| info | `main.tex:6` | The preview leaves out the setspace package. Line spacing and indents use the preview defaults. |
| info | `main.tex:7` | The preview uses a stand-in for the amsmath package. KaTeX draws the math; numbered equations show without their numbers. |
| info | `main.tex:7` | The preview uses a stand-in for the amsthm package. Theorems and proofs show without numbers. |
| info | `main.tex:10` | The preview uses a stand-in for the natbib package. The preview builds the bibliography itself, in an approximate style. |

What the preview changed:

- Removed packages the preview can't load: inputenc, fontenc, geometry, setspace, amsmath, amsthm, natbib.
- Showed theorems and proofs without numbers.
- Showed numbered equations without their numbers.
- Put a note in place of tables the preview can't show.
- Showed \caption as bold text.
- Removed \vspace.
- Ignored commands the preview has no use for: \newtheorem.
<!-- corpus-report:end -->
