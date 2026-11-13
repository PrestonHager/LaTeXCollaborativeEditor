// The templates that ship with the app (#74). They load with the template picker, not with the page.
//
// The preambles follow the r/LaTeX "gold standard" package list, updated for current LaTeX (see the
// maintainer's notes on #74): T1 + Latin Modern, microtype, babel + csquotes, geometry, the AMS math
// packages with mathtools, graphicx, xcolor, booktabs, enumitem, and hyperref then cleveref last.
// Nothing obsolete: no inputenc (UTF-8 is the default since 2018), no epsfig, subfigure, times,
// a4wide, physics or nth. Each package has a comment saying why it's there.
//
// The live preview is LaTeX.js, which ignores most packages and approximates some commands. The
// comments say so where it matters; docs/getting-started.md lists what the preview approximates.
import type { PlaceholderDef } from './placeholders';

export type BuiltinTemplate = {
  id: string;
  name: string;
  description: string;
  mainFile: string;
  placeholders: PlaceholderDef[];
  files: { path: string; text: string }[];
};

const title = (fallback: string): PlaceholderDef => ({ key: 'title', label: 'Title', default: fallback });

// The packages every template but the letter and slides starts with. %PAPER% and %EXTRA% are
// filled in per template.
const corePreamble = (extra: string) => String.raw`% --- Fonts and encoding (pdfLaTeX) ---------------------------------------
% With LuaLaTeX or XeLaTeX, replace these two lines with \usepackage{fontspec}.
\usepackage[T1]{fontenc}        % Hyphenates accented words and copies them right from the PDF
\usepackage{lmodern}            % Latin Modern, a sharp scalable version of the default font
\usepackage{microtype}          % Finer spacing and fewer bad line breaks

% --- Language -----------------------------------------------------------
\usepackage[{{language}}]{babel} % Hyphenation rules and words like "Contents" for your language
\usepackage{csquotes}           % \enquote{...} gives the right quotation marks for that language

% --- Page layout --------------------------------------------------------
\usepackage[margin=1in]{geometry} % Margins. The paper size comes from the class options.
\usepackage{enumitem}           % Control list spacing, like \begin{itemize}[nosep]

% --- Math ---------------------------------------------------------------
\usepackage{amsmath}            % align, equation*, \text and more
\usepackage{mathtools}          % Fixes and extends amsmath
\usepackage{amssymb}            % Extra symbols like \mathbb{R}

% --- Figures and tables -------------------------------------------------
\usepackage{graphicx}           % \includegraphics
\usepackage{xcolor}             % \textcolor and named colors
\usepackage{booktabs}           % Good-looking table rules: \toprule, \midrule, \bottomrule
${extra}`;

const linksLast = String.raw`% --- Links and references (load these last) -------------------------------
\usepackage[hidelinks]{hyperref} % Clickable references and URLs. Remove hidelinks for colored links.
\usepackage[noabbrev]{cleveref}  % \cref{fig:x} writes "Figure 1" for you. Must come after hyperref.`;

const blankArticle: BuiltinTemplate = {
  id: 'builtin:article',
  name: 'Blank article',
  description: 'A short article with a title, an abstract and one section. A clean place to start.',
  mainFile: 'main.tex',
  placeholders: [title('Title of the article')],
  files: [
    {
      path: 'main.tex',
      text: String.raw`% Blank article. Compile with pdfLaTeX (or LuaLaTeX, see the font note below).
\documentclass[11pt,{{paper}}]{article}

${corePreamble('')}
${linksLast}

\title{{{title}}}
\author{{{name}}\\ {{affiliation}}\\ \texttt{{{email}}}}
\date{{{date}}}

\begin{document}

\maketitle

\begin{abstract}
One paragraph that says what this article is about and what it finds.
\end{abstract}

\section{Introduction}
\label{sec:intro}
Start writing here. Use \enquote{quotes} for quotation marks, and refer to sections with
\cref{sec:intro}.

\end{document}
`,
    },
  ],
};

const technicalReport: BuiltinTemplate = {
  id: 'builtin:report',
  name: 'Technical report',
  description: 'A numbered report with a summary, figures, a table, units and a biblatex bibliography.',
  mainFile: 'main.tex',
  placeholders: [title('Title of the report'), { key: 'report_number', label: 'Report number', default: 'TR-001' }],
  files: [
    {
      path: 'main.tex',
      text: String.raw`% Technical report. Compile with pdfLaTeX, then biber, then pdfLaTeX twice
% (most editors and latexmk do this for you).
\documentclass[11pt,{{paper}}]{article}

${corePreamble(String.raw`\usepackage{caption}            % Caption styling
\usepackage{subcaption}         % Side-by-side subfigures (replaces subfigure and subfig)
\usepackage{siunitx}            % Numbers and units: \qty{9.81}{\metre\per\second\squared}
\sisetup{range-phrase = --, range-units = single}
\usepackage[title]{appendix}    % Appendices with "Appendix A" headings

% --- Bibliography ---------------------------------------------------------
% biblatex with the biber backend. Change style= to suit your field (authoryear, ieee, apa, ...).
\usepackage[backend=biber, style=numeric]{biblatex}
\addbibresource{refs.bib}
`)}
${linksLast}

\title{{{title}}\\ \large Report {{report_number}}}
\author{{{name}}\\ {{affiliation}}\\ \texttt{{{email}}}}
\date{{{date}}}

\begin{document}

\maketitle

\begin{abstract}
A summary of the problem, the method and the main result, in a few sentences.
\end{abstract}

\tableofcontents

\section{Introduction}
\label{sec:intro}
Say what the report is about and why it matters. Cite sources from refs.bib like this:
\autocite{knuth1984}. \Cref{sec:results} has the results.

\section{Method}
\label{sec:method}
Describe what you did. Equations get numbers you can refer to, like \cref{eq:energy}:
\begin{equation}
  E = m c^2 .
  \label{eq:energy}
\end{equation}
Write quantities with siunitx, so numbers and units are spaced right: a speed of
\qty{3.0e8}{\metre\per\second}, or a range of \qtyrange{10}{20}{\celsius}.

\section{Results}
\label{sec:results}
\Cref{tab:results} lists the measurements.

\begin{table}[htbp]
  \centering
  \caption{Measurements. booktabs rules, no vertical lines.}
  \label{tab:results}
  \begin{tabular}{lS[table-format=2.1]}
    \toprule
    Sample & {Temperature (\unit{\celsius})} \\
    \midrule
    A      & 21.4 \\
    B      & 19.8 \\
    \bottomrule
  \end{tabular}
\end{table}

\begin{figure}[htbp]
  \centering
  % Upload an image (File > Upload Files), then replace the box with an
  % \includegraphics line for it, like [width=0.6\linewidth] and the file name in braces.
  \fbox{Your figure goes here}
  \caption{A figure. Its label lets the text refer to it.}
  \label{fig:example}
\end{figure}

\section{Conclusion}
What the results mean, and what comes next.

\printbibliography[heading=bibintoc]

\begin{appendices}
\section{Extra data}
Material that supports the report but would interrupt it.
\end{appendices}

\end{document}
`,
    },
    {
      path: 'refs.bib',
      text: String.raw`@book{knuth1984,
  author    = {Donald E. Knuth},
  title     = {The {\TeX}book},
  publisher = {Addison-Wesley},
  address   = {Reading, MA},
  year      = {1984}
}

@book{lamport1994,
  author    = {Leslie Lamport},
  title     = {{\LaTeX}: A Document Preparation System},
  edition   = {2},
  publisher = {Addison-Wesley},
  year      = {1994}
}
`,
    },
  ],
};

const letter: BuiltinTemplate = {
  id: 'builtin:letter',
  name: 'Letter',
  description: 'A formal letter with your address, the date, the recipient and a signature.',
  mainFile: 'letter.tex',
  placeholders: [
    { key: 'recipient', label: 'Recipient', multiline: true, default: 'Recipient Name\nStreet and number\nCity and postcode', hint: 'Name and address, one per line.' },
    { key: 'salutation', label: 'Greeting', default: 'Dear Recipient,' },
    { key: 'subject', label: 'Subject', default: 'Subject of the letter' },
  ],
  files: [
    {
      path: 'letter.tex',
      text: String.raw`% A formal letter. Compile with pdfLaTeX.
% It uses the article class rather than the letter class, so every part of the layout is plain
% LaTeX you can move around. For a full letter class, look at KOMA-Script's scrlttr2.
\documentclass[11pt,{{paper}}]{article}

\usepackage[T1]{fontenc}        % Hyphenates accented words and copies them right from the PDF
\usepackage{lmodern}            % Latin Modern, a sharp scalable version of the default font
\usepackage{microtype}          % Finer spacing and fewer bad line breaks
\usepackage[{{language}}]{babel} % Hyphenation rules for your language
\usepackage{csquotes}           % \enquote{...} gives the right quotation marks
\usepackage[margin=1in]{geometry} % Margins. The paper size comes from the class options.
\usepackage{parskip}            % A blank line between paragraphs instead of an indent
\usepackage[hidelinks]{hyperref} % Clickable email and web addresses

\pagestyle{empty}               % No page number on a one-page letter

\begin{document}

% Each line ends with \par, so a line you leave empty doesn't break the layout.
\begin{flushright}
{{name}}\par
{{address}}\par
\texttt{{{email}}}\par
\end{flushright}

{{date}}\par
\bigskip
{{recipient}}\par

\textbf{{{subject}}}

{{salutation}}

Start the letter here. Keep each paragraph to one point.

A second paragraph, if you need one.

Yours sincerely,

\bigskip
{{name}}

\end{document}
`,
    },
  ],
};

const slides: BuiltinTemplate = {
  id: 'builtin:beamer',
  name: 'Beamer slides',
  description: 'A widescreen talk with a title slide, an outline, bullet points, a block and two columns.',
  mainFile: 'slides.tex',
  placeholders: [title('Title of the talk'), { key: 'event', label: 'Event', default: 'Conference or seminar' }],
  files: [
    {
      path: 'slides.tex',
      text: String.raw`% Beamer slides. Compile with pdfLaTeX.
% The live preview can't draw slides. It shows each frame as a page with its title, which is
% enough to check the text; the real look comes from compiling with Beamer.
\documentclass[aspectratio=169]{beamer}

\usetheme{Madrid}               % Try Boadilla, CambridgeUS or default for other looks
\usepackage[T1]{fontenc}        % Hyphenates accented words and copies them right from the PDF
\usepackage{lmodern}            % Latin Modern, a sharp scalable version of the default font
\usepackage{microtype}          % Finer spacing
\usepackage[{{language}}]{babel} % Hyphenation rules for your language
\usepackage{csquotes}           % \enquote{...} gives the right quotation marks
\usepackage{booktabs}           % Good-looking table rules
% Beamer already loads graphicx, xcolor and hyperref.

\title{{{title}}}
\author{{{name}}}
\institute{{{affiliation}}}
\date{{{event}}, {{date}}}

\begin{document}

\begin{frame}
  \titlepage
\end{frame}

\begin{frame}{Outline}
  \tableofcontents
\end{frame}

\section{Motivation}

\begin{frame}{Why this matters}
  \begin{itemize}
    \item The problem in one line
    \pause
    \item What was known before
    \pause
    \item What this talk adds
  \end{itemize}
\end{frame}

\section{Results}

\begin{frame}{The main result}
  \begin{block}{Result}
    State it in one sentence.
  \end{block}
  \begin{columns}
    \begin{column}{0.5\textwidth}
      Left column: the evidence.
    \end{column}
    \begin{column}{0.5\textwidth}
      Right column: what it means.
    \end{column}
  \end{columns}
\end{frame}

\begin{frame}{Thank you}
  Questions? Write to \texttt{{{email}}}.
\end{frame}

\end{document}
`,
    },
  ],
};

const thesis: BuiltinTemplate = {
  id: 'builtin:thesis',
  name: 'Thesis',
  description: 'A thesis skeleton with a title page, front matter, chapters in their own files, appendices and a bibliography.',
  mainFile: 'main.tex',
  placeholders: [
    title('Title of the thesis'),
    { key: 'degree', label: 'Degree', default: 'Doctor of Philosophy' },
    { key: 'department', label: 'Department', default: 'Department of Physics' },
    { key: 'supervisor', label: 'Supervisor', default: 'Prof. Supervisor Name' },
    { key: 'year', label: 'Year', default: String(new Date().getFullYear()) },
  ],
  files: [
    {
      path: 'main.tex',
      text: String.raw`% Thesis. Compile with pdfLaTeX, then biber, then pdfLaTeX twice (latexmk does all of it).
% Each chapter is its own file in chapters/. Check your university's rules for margins,
% spacing and the title page, and change those parts to match.
\documentclass[11pt,{{paper}},oneside]{report}

${corePreamble(String.raw`\usepackage{caption}            % Caption styling
\usepackage{subcaption}         % Side-by-side subfigures (replaces subfigure and subfig)
\usepackage{siunitx}            % Numbers and units: \qty{9.81}{\metre\per\second\squared}
\usepackage{amsthm}             % Theorem, lemma and definition environments
\usepackage[title,toc]{appendix} % Appendices with "Appendix A" headings

% --- Bibliography ---------------------------------------------------------
% biblatex with the biber backend. Change style= to suit your field (authoryear, ieee, apa, ...).
\usepackage[backend=biber, style=authoryear]{biblatex}
\addbibresource{refs.bib}
`)}
${linksLast}

% Theorems come after cleveref, so \cref knows their names.
\newtheorem{theorem}{Theorem}[chapter]
\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}

\title{{{title}}}
\author{{{name}}}
\date{{{year}}}

\begin{document}

\begin{titlepage}
  \centering
  {\Large {{affiliation}}\par}
  {\large {{department}}\par}
  \vspace{3cm}
  {\huge\bfseries {{title}}\par}
  \vspace{2cm}
  {\Large {{name}}\par}
  \vfill
  A thesis submitted for the degree of\par
  {\large {{degree}}\par}
  \vspace{1cm}
  Supervisor: {{supervisor}}\par
  {{year}}
\end{titlepage}

\pagenumbering{roman}

\chapter*{Abstract}
\addcontentsline{toc}{chapter}{Abstract}
A one-page summary of the question, the method, the results and why they matter.

\chapter*{Acknowledgements}
Thank the people who helped.

\tableofcontents
\listoffigures
\listoftables

\cleardoublepage
\pagenumbering{arabic}

\include{chapters/introduction}
\include{chapters/background}
\include{chapters/conclusion}

% \include can't go inside an environment, so the appendix chapter comes in with \input.
\begin{appendices}
\input{chapters/appendix}
\end{appendices}

\printbibliography[heading=bibintoc]

\end{document}
`,
    },
    {
      path: 'chapters/introduction.tex',
      text: String.raw`\chapter{Introduction}
\label{ch:intro}

State the question this thesis answers, and why it's worth answering \autocite{lamport1994}.
\Cref{ch:background} covers what was known before.

\section{Contributions}
\begin{itemize}
  \item The first thing this thesis adds.
  \item The second.
\end{itemize}

\section{Outline}
Say what each chapter does.
`,
    },
    {
      path: 'chapters/background.tex',
      text: String.raw`\chapter{Background}
\label{ch:background}

\begin{definition}
  \label{def:example}
  A term this thesis uses, defined once here.
\end{definition}

\begin{theorem}
  \label{thm:example}
  A result from earlier work.
\end{theorem}

\begin{proof}
  A sketch, or a pointer to where the full proof is.
\end{proof}

Numbered equations go in \texttt{equation} or \texttt{align}:
\begin{align}
  f(x) &= x^2 + 1 , \label{eq:f} \\
  f'(x) &= 2x .
\end{align}
\Cref{thm:example} and \cref{eq:f} link to where they're defined.

Quantities use siunitx: \qty{1.5}{\kilo\gram}, \num{6.022e23}.
`,
    },
    {
      path: 'chapters/conclusion.tex',
      text: String.raw`\chapter{Conclusion}
\label{ch:conclusion}

Sum up what the thesis found, its limits, and what to try next.
`,
    },
    {
      path: 'chapters/appendix.tex',
      text: String.raw`\chapter{Extra material}
\label{ch:appendix}

Derivations, data and code listings that would interrupt the main text.
`,
    },
    {
      path: 'refs.bib',
      text: String.raw`@book{lamport1994,
  author    = {Leslie Lamport},
  title     = {{\LaTeX}: A Document Preparation System},
  edition   = {2},
  publisher = {Addison-Wesley},
  year      = {1994}
}

@book{knuth1984,
  author    = {Donald E. Knuth},
  title     = {The {\TeX}book},
  publisher = {Addison-Wesley},
  address   = {Reading, MA},
  year      = {1984}
}
`,
    },
    {
      path: 'extra-packages.tex',
      text: String.raw`% Optional packages, for when you need them. Nothing here is loaded.
% Copy a line into the preamble of main.tex (before hyperref) to use it.
%
% Science
% \usepackage{bm}               % Bold math symbols: \bm{\alpha}
% \usepackage{derivative}       % Derivatives: \odv{f}{x}, \pdv{f}{x}. Replaces the unmaintained physics package.
% \usepackage{braket}           % Dirac notation: \braket{\phi|\psi}
% \usepackage[version=4]{mhchem} % Chemistry: \ce{H2O}
% \usepackage[makeroom]{cancel} % Strike out terms in equations
% \usepackage{nicematrix}       % Matrices with labels and dashed lines
%
% Drawing and plots (heavy, so only load them if you use them)
% \usepackage{tikz}
% \usetikzlibrary{arrows.meta, calc, positioning}  % arrows.meta replaces the old arrows library
% \usepackage{pgfplots}
% \pgfplotsset{compat=1.18}
%
% Tables
% \usepackage{array}            % More column types
% \usepackage{tabularx}         % Columns that stretch to a given width
% \usepackage{multirow}         % Cells spanning rows
% \usepackage{tabularray}       % A modern alternative to tabularx and multirow
%
% Layout
% \usepackage{multicol}         % Several columns of text
% \usepackage{pdflscape}        % Landscape pages
% \usepackage{pdfpages}         % Include pages from other PDFs
% \usepackage{parskip}          % A blank line between paragraphs instead of an indent
%
% Misc
% \usepackage{datetime2}        % Format dates
% \usepackage{fmtcount}         % Ordinals: \ordinalnum{3}. Replaces the unmaintained nth package.
% \usepackage{etoolbox}         % Programming helpers for package writers
% \usepackage{iftex}            % \ifPDFTeX ... to support several engines
`,
    },
  ],
};

export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = [blankArticle, technicalReport, letter, slides, thesis];
