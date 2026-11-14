% A small class for internal technical notes, built on article.
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{report-note}[2026/11/14 Technical note class]

\DeclareOption*{\PassOptionsToClass{\CurrentOption}{article}}
\ProcessOptions\relax
\LoadClass[11pt]{article}

\RequirePackage{xcolor}
\RequirePackage{fancyhdr}

\definecolor{notecolor}{RGB}{0,82,147}

\newcommand{\notenumber}[1]{\def\@notenumber{#1}}
\notenumber{TN-000}

\renewcommand{\maketitle}{%
  \begin{center}
    {\color{notecolor}\Large\bfseries \@title}\\[0.5em]
    {\small Note \@notenumber{} \quad \@author \quad \@date}
  \end{center}
}

\newenvironment{summarybox}{\par\noindent\textbf{Summary.}\ }{\par}

\pagestyle{fancy}
\fancyhf{}
\rhead{\@notenumber}
\cfoot{\thepage}
