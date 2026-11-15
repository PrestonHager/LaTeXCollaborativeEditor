import type { LatexCommand, LatexEnvironment } from './latexCompletionData';

/**
 * Commands and environments that come from a package (issue #194). Completion only offers them
 * when the project loads the package with `\usepackage` or `\RequirePackage`, or a document class
 * that loads it, like `\documentclass{beamer}`. This is static data in a chunk of its own, loaded
 * the first time a completion needs it. Templates are written as in latexCompletionData.ts.
 */
export interface PackageData {
  commands?: readonly LatexCommand[];
  environments?: readonly LatexEnvironment[];
  /** Packages this one loads, so their commands come with it. */
  loads?: readonly string[];
}

const MATRIX = '#{a} & #{b} \\\\\n\t#{c} & #{d}';

export const PACKAGE_DATA: Readonly<Record<string, PackageData>> = {
  amsmath: {
    commands: [
      ['DeclareMathOperator', '{\\#{name}}{#{text}}', 'Define a math operator (amsmath)'],
      ['eqref', '{#{key}}', 'Reference an equation, in parentheses (amsmath)'],
      ['dfrac', '{#{num}}{#{den}}', 'Display-style fraction (amsmath)'],
      ['tfrac', '{#{num}}{#{den}}', 'Text-style fraction (amsmath)'],
      ['cfrac', '{#{num}}{#{den}}', 'Continued fraction (amsmath)'],
      ['binom', '{#{n}}{#{k}}', 'Binomial coefficient (amsmath)'],
      ['iint', '', 'Double integral (amsmath)'],
      ['iiint', '', 'Triple integral (amsmath)'],
      ['text', '{#{text}}', 'Text in math (amsmath)'],
      ['intertext', '{#{text}}', 'Text between aligned lines (amsmath)'],
      ['boldsymbol', '{#{x}}', 'Bold math symbol (amsmath)'],
      ['operatorname', '{#{name}}', 'Operator name (amsmath)'],
      ['overset', '{#{over}}{#{x}}', 'Symbol set over another (amsmath)'],
      ['underset', '{#{under}}{#{x}}', 'Symbol set under another (amsmath)'],
      ['substack', '{#{lines}}', 'Lines stacked under a sum (amsmath)'],
      ['xrightarrow', '{#{label}}', 'Long right arrow with a label (amsmath)'],
      ['xleftarrow', '{#{label}}', 'Long left arrow with a label (amsmath)'],
      ['tag', '{#{label}}', 'Custom equation tag (amsmath)'],
      ['notag', '', 'No number on this line (amsmath)'],
      ['implies', '', 'Implies ⟹ (amsmath)'],
      ['iff', '', 'If and only if ⟺ (amsmath)'],
    ],
    environments: [
      ['equation*', 'Unnumbered equation (amsmath)'],
      ['align', 'Aligned equations (amsmath)'],
      ['align*', 'Unnumbered aligned equations (amsmath)'],
      ['alignat', 'Aligned equations with set columns (amsmath)', '{#{columns}}'],
      ['flalign', 'Equations aligned to the margins (amsmath)'],
      ['gather', 'Centered equations (amsmath)'],
      ['gather*', 'Unnumbered centered equations (amsmath)'],
      ['multline', 'Equation over several lines (amsmath)'],
      ['multline*', 'Unnumbered equation over several lines (amsmath)'],
      ['split', 'Split equation inside another (amsmath)'],
      ['aligned', 'Aligned lines inside an equation (amsmath)'],
      ['gathered', 'Centered lines inside an equation (amsmath)'],
      ['cases', 'Cases (amsmath)', '', '#{value} & #{condition} \\\\\n\t#{} & #{}'],
      ['matrix', 'Matrix without brackets (amsmath)', '', MATRIX],
      ['pmatrix', 'Matrix in parentheses (amsmath)', '', MATRIX],
      ['bmatrix', 'Matrix in square brackets (amsmath)', '', MATRIX],
      ['Bmatrix', 'Matrix in braces (amsmath)', '', MATRIX],
      ['vmatrix', 'Determinant (amsmath)', '', MATRIX],
      ['Vmatrix', 'Matrix in double bars (amsmath)', '', MATRIX],
      ['smallmatrix', 'Matrix in running text (amsmath)'],
    ],
  },
  mathtools: {
    loads: ['amsmath'],
    commands: [
      ['coloneqq', '', 'Defined as ≔ (mathtools)'],
      ['mathclap', '{#{x}}', 'Math with no width (mathtools)'],
      ['DeclarePairedDelimiter', '{\\#{name}}{#{left}}{#{right}}', 'Define a paired delimiter (mathtools)'],
    ],
    environments: [
      ['dcases', 'Cases in display style (mathtools)'],
      ['pmatrix*', 'Matrix in parentheses, with alignment (mathtools)', '[#{r}]'],
    ],
  },
  amsfonts: {
    commands: [
      ['mathbb', '{#{R}}', 'Blackboard bold letter (amsfonts)'],
      ['mathfrak', '{#{g}}', 'Fraktur letter (amsfonts)'],
    ],
  },
  amssymb: {
    loads: ['amsfonts'],
    commands: [
      ['leqslant', '', 'Less than or equal, slanted ⩽ (amssymb)'],
      ['geqslant', '', 'Greater than or equal, slanted ⩾ (amssymb)'],
      ['therefore', '', 'Therefore ∴ (amssymb)'],
      ['because', '', 'Because ∵ (amssymb)'],
      ['varnothing', '', 'Empty set ∅ (amssymb)'],
      ['nexists', '', 'There is no ∄ (amssymb)'],
      ['square', '', 'Square □ (amssymb)'],
      ['blacksquare', '', 'Filled square ■ (amssymb)'],
      ['checkmark', '', 'Check mark ✓ (amssymb)'],
      ['lesssim', '', 'Less than or similar ≲ (amssymb)'],
      ['gtrsim', '', 'Greater than or similar ≳ (amssymb)'],
      ['triangleq', '', 'Defined as ≜ (amssymb)'],
    ],
  },
  amsthm: {
    commands: [
      ['theoremstyle', '{#{plain}}', 'Style for the next \\newtheorem (amsthm)'],
      ['qedhere', '', 'Put the end-of-proof box here (amsthm)'],
      ['qed', '', 'End-of-proof box (amsthm)'],
    ],
    environments: [['proof', 'Proof (amsthm)']],
  },
  graphicx: {
    commands: [
      ['includegraphics', '[width=#{\\linewidth}]{#{file}}', 'Insert an image (graphicx)'],
      ['graphicspath', '{{#{figures/}}}', 'Folders to look for images in (graphicx)'],
      ['rotatebox', '{#{angle}}{#{text}}', 'Rotated box (graphicx)'],
      ['scalebox', '{#{0.5}}{#{text}}', 'Scaled box (graphicx)'],
      ['resizebox', '{#{\\linewidth}}{!}{#{text}}', 'Box resized to a width (graphicx)'],
    ],
  },
  hyperref: {
    commands: [
      ['href', '{#{url}}{#{text}}', 'Link with text (hyperref)'],
      ['url', '{#{url}}', 'URL (hyperref)'],
      ['nolinkurl', '{#{url}}', 'URL that isn\'t a link (hyperref)'],
      ['autoref', '{#{key}}', 'Reference with its type (hyperref)'],
      ['nameref', '{#{key}}', 'Reference by the heading\'s name (hyperref)'],
      ['hyperref', '[#{key}]{#{text}}', 'Link to a label with text (hyperref)'],
      ['hypersetup', '{#{options}}', 'Set link options (hyperref)'],
      ['texorpdfstring', '{#{TeX}}{#{PDF text}}', 'Different text in PDF bookmarks (hyperref)'],
      ['phantomsection', '', 'Link target for \\addcontentsline (hyperref)'],
    ],
  },
  url: { commands: [['url', '{#{url}}', 'URL (url)']] },
  booktabs: {
    commands: [
      ['toprule', '', 'Top rule (booktabs)'],
      ['midrule', '', 'Middle rule (booktabs)'],
      ['bottomrule', '', 'Bottom rule (booktabs)'],
      ['cmidrule', '{#{2-3}}', 'Rule under some columns (booktabs)'],
      ['addlinespace', '', 'Extra space between rows (booktabs)'],
    ],
  },
  xcolor: {
    commands: [
      ['textcolor', '{#{color}}{#{text}}', 'Colored text (xcolor)'],
      ['color', '{#{color}}', 'Color from here on (xcolor)'],
      ['colorbox', '{#{color}}{#{text}}', 'Text on a colored background (xcolor)'],
      ['fcolorbox', '{#{frame}}{#{background}}{#{text}}', 'Framed text on a colored background (xcolor)'],
      ['definecolor', '{#{name}}{#{HTML}}{#{FF8800}}', 'Define a color (xcolor)'],
      ['pagecolor', '{#{color}}', 'Page background color (xcolor)'],
    ],
  },
  siunitx: {
    commands: [
      ['SI', '{#{value}}{#{unit}}', 'Quantity with a unit (siunitx)'],
      ['si', '{#{unit}}', 'Unit (siunitx)'],
      ['qty', '{#{value}}{#{unit}}', 'Quantity with a unit (siunitx 3)'],
      ['num', '{#{number}}', 'Formatted number (siunitx)'],
      ['unit', '{#{unit}}', 'Unit (siunitx 3)'],
      ['ang', '{#{angle}}', 'Angle (siunitx)'],
      ['qtyrange', '{#{from}}{#{to}}{#{unit}}', 'Range of quantities (siunitx 3)'],
      ['numrange', '{#{from}}{#{to}}', 'Range of numbers (siunitx)'],
      ['sisetup', '{#{options}}', 'Set siunitx options (siunitx)'],
    ],
  },
  cleveref: {
    commands: [
      ['cref', '{#{key}}', 'Reference with its type (cleveref)'],
      ['Cref', '{#{key}}', 'Capitalized reference with its type (cleveref)'],
      ['crefrange', '{#{first}}{#{last}}', 'Reference a range (cleveref)'],
      ['cpageref', '{#{key}}', 'Page of a reference (cleveref)'],
      ['crefname', '{#{type}}{#{singular}}{#{plural}}', 'Name used for a type (cleveref)'],
    ],
  },
  tikz: {
    loads: ['xcolor', 'graphicx'],
    commands: [
      ['draw', ' #{(0,0) -- (1,1)};', 'Draw a path (tikz)'],
      ['fill', '[#{color}] #{(0,0) rectangle (1,1)};', 'Fill a path (tikz)'],
      ['filldraw', '[#{fill=color}] #{(0,0) circle (1)};', 'Fill and draw a path (tikz)'],
      ['node', '[#{options}] at (#{0,0}) {#{text}};', 'Node with text (tikz)'],
      ['path', ' #{(0,0) -- (1,1)};', 'Path (tikz)'],
      ['coordinate', ' (#{name}) at (#{0,0});', 'Named coordinate (tikz)'],
      ['clip', ' #{(0,0) rectangle (1,1)};', 'Clip to a path (tikz)'],
      ['foreach', ' \\#{x} in {#{1,2,3}} {#{}}', 'Repeat for each value (tikz)'],
      ['tikz', '{#{\\draw (0,0) -- (1,0);}}', 'Inline drawing (tikz)'],
      ['tikzset', '{#{options}}', 'Set TikZ styles (tikz)'],
      ['usetikzlibrary', '{#{arrows.meta}}', 'Load TikZ libraries (tikz)'],
    ],
    environments: [
      ['tikzpicture', 'TikZ drawing (tikz)'],
      ['scope', 'Scope with its own options (tikz)', '[#{options}]'],
    ],
  },
  pgfplots: {
    loads: ['tikz'],
    commands: [
      ['addplot', ' #{coordinates {(0,0) (1,1)}};', 'Plot (pgfplots)'],
      ['pgfplotsset', '{#{compat=1.18}}', 'Set pgfplots options (pgfplots)'],
    ],
    environments: [['axis', 'Plot axes (pgfplots)', '[#{options}]']],
  },
  natbib: {
    commands: [
      ['citep', '{#{key}}', 'Parenthetical citation (natbib)'],
      ['citet', '{#{key}}', 'Textual citation (natbib)'],
      ['citealt', '{#{key}}', 'Citation without parentheses (natbib)'],
      ['citeauthor', '{#{key}}', 'Author of a source (natbib)'],
      ['citeyear', '{#{key}}', 'Year of a source (natbib)'],
    ],
  },
  biblatex: {
    commands: [
      ['parencite', '{#{key}}', 'Parenthetical citation (biblatex)'],
      ['textcite', '{#{key}}', 'Textual citation (biblatex)'],
      ['autocite', '{#{key}}', 'Citation in the style\'s default form (biblatex)'],
      ['footcite', '{#{key}}', 'Citation in a footnote (biblatex)'],
      ['citeauthor', '{#{key}}', 'Author of a source (biblatex)'],
      ['addbibresource', '{#{file.bib}}', 'Add a .bib file (biblatex)'],
      ['printbibliography', '', 'Print the bibliography (biblatex)'],
    ],
  },
  csquotes: {
    commands: [
      ['enquote', '{#{text}}', 'Quoted text (csquotes)'],
      ['blockquote', '{#{text}}', 'Block quotation (csquotes)'],
    ],
    environments: [['displayquote', 'Displayed quotation (csquotes)']],
  },
  multirow: { commands: [['multirow', '{#{n}}{*}{#{text}}', 'Cell spanning rows (multirow)']] },
  tabularx: { environments: [['tabularx', 'Table with stretching columns (tabularx)', '{#{\\linewidth}}{#{cols}}']] },
  longtable: { environments: [['longtable', 'Table across pages (longtable)', '{#{cols}}']] },
  listings: {
    commands: [
      ['lstinline', '|#{code}|', 'Inline code (listings)'],
      ['lstinputlisting', '{#{file}}', 'Code listing from a file (listings)'],
      ['lstset', '{#{options}}', 'Set listing options (listings)'],
    ],
    environments: [['lstlisting', 'Code listing (listings)']],
  },
  minted: {
    commands: [
      ['mintinline', '{#{language}}|#{code}|', 'Inline highlighted code (minted)'],
      ['inputminted', '{#{language}}{#{file}}', 'Highlighted code from a file (minted)'],
    ],
    environments: [['minted', 'Highlighted code (minted)', '{#{language}}']],
  },
  subcaption: {
    commands: [['subcaption', '{#{text}}', 'Caption of a subfigure (subcaption)']],
    environments: [
      ['subfigure', 'Subfigure (subcaption)', '{#{0.45\\linewidth}}'],
      ['subtable', 'Subtable (subcaption)', '{#{0.45\\linewidth}}'],
    ],
  },
  appendix: { environments: [['appendices', 'Appendices (appendix)']] },
  // Document classes that load packages or add their own commands.
  beamer: {
    loads: ['amsmath', 'amssymb', 'amsthm', 'graphicx', 'hyperref', 'xcolor'],
    commands: [
      ['frametitle', '{#{title}}', 'Frame title (beamer)'],
      ['framesubtitle', '{#{subtitle}}', 'Frame subtitle (beamer)'],
      ['pause', '', 'Pause before the next part (beamer)'],
      ['only', '<#{2-}>{#{text}}', 'Text only on some slides (beamer)'],
      ['onslide', '<#{2-}>', 'Show from some slides on (beamer)'],
      ['alert', '{#{text}}', 'Highlighted text (beamer)'],
      ['usetheme', '{#{theme}}', 'Set the presentation theme (beamer)'],
      ['usecolortheme', '{#{theme}}', 'Set the color theme (beamer)'],
    ],
    environments: [
      ['frame', 'Slide (beamer)', '', '\\frametitle{#{title}}\n\t#{}'],
      ['columns', 'Columns (beamer)'],
      ['column', 'Column (beamer)', '{#{0.5\\textwidth}}'],
      ['block', 'Block (beamer)', '{#{title}}'],
      ['alertblock', 'Highlighted block (beamer)', '{#{title}}'],
      ['exampleblock', 'Example block (beamer)', '{#{title}}'],
    ],
  },
  amsart: { loads: ['amsmath', 'amsthm', 'amsfonts'] },
  amsbook: { loads: ['amsmath', 'amsthm', 'amsfonts'] },
};

