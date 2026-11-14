import {
  escapeLatexText,
  escapeRegExp,
  formatNumber,
  formatUnit,
  placeholderTables,
  rewriteAppendices,
  rewriteBeamer,
  rewriteCleveref,
  rewriteDisplayMath,
  rewriteEnquote,
  rewriteFillerText,
  rewriteSiunitx,
  rewriteSubfigures,
  rewriteTheorems,
  rewriteTodos,
  rewriteUnderlines,
  rewriteWrapFigures,
  stripFloatBarrier,
  stripListOptions,
  stripSetupCommands,
  stripXspace,
  theoremNames,
} from './packageShims';
import { adaptLatexSource } from './latexJsAdapt';
import { latexSourceToPreviewHtml, PAGE_BREAK_CLASS } from './latexJsPreview';

const lines = (text: string) => text.split('\n').length;

describe('package stand-ins for the preview', () => {
  it('writes \\cref and \\Cref as a named \\ref, guessing the name from the label prefix', () => {
    expect(rewriteCleveref('see \\cref{sec:intro} and \\Cref{fig:a,fig:b}, \\cref{eq:x}, \\cref{other}')).toBe(
      'see section~\\ref{sec:intro} and Figures~\\ref{fig:a} and \\ref{fig:b}, equation~\\ref{eq:x}, \\ref{other}',
    );
  });

  it('writes \\enquote with TeX quotes', () => {
    expect(rewriteEnquote('\\enquote{hi} \\enquote*{yo}')).toBe("``hi'' `yo'");
    expect(rewriteEnquote('\\enquote{a\nb}')).toBe("``a\nb''");
  });

  it('writes siunitx numbers and units as text', () => {
    expect(rewriteSiunitx('\\qty{9.81}{\\metre\\per\\second\\squared}')).toBe('9.81~m/s²');
    expect(rewriteSiunitx('\\SI{3}{\\kilo\\gram} \\num{6.022e23} \\num{1e-3} \\unit{\\celsius}')).toBe('3~kg 6.022 × 10²³ 1 × 10⁻³ °C');
    expect(rewriteSiunitx('\\qtyrange{10}{20}{\\percent} \\numrange{1}{2} \\ang{30} \\si{m.s^{-1}}')).toBe('10--20~\\% 1--2 30° m·s⁻¹');
    expect(rewriteSiunitx('\\qty{1}{\\square\\metre}')).toBe('1~m²');
    expect(rewriteSiunitx('\\sisetup{x}')).toBe('\\sisetup{x}');
  });

  it('formats units and numbers', () => {
    expect(formatUnit('\\joule\\per\\mole\\per\\kelvin')).toBe('J/(mol·K)');
    expect(formatUnit('\\metre\\tothe{3}')).toBe('m³');
    expect(formatUnit('\\per\\second')).toBe('1/s');
    expect(formatUnit('\\furlong')).toBe('furlong');
    expect(formatNumber(' 12 ')).toBe('12');
    expect(formatNumber('e5')).toBe('10⁵');
  });

  it('turns numbered math environments into display math without labels', () => {
    const source = '\\begin{equation}\n  E = mc^2 \\label{eq:e}\n\\end{equation}\n\\begin{align*}a&=b\\\\c&=d\\nonumber\\end{align*}';
    const out = rewriteDisplayMath(source);
    expect(out).toBe('\\[\n  E = mc^2 \n\\]\n\\[\\begin{aligned}a&=b\\\\c&=d\\end{aligned}\\]');
    expect(lines(out)).toBe(lines(source));
  });

  it('turns theorems and proofs into bold and italic headings', () => {
    const source = '\\newtheorem{thm}{Theorem}[section]\n\\newtheorem*{rem}{Remark}\n\\begin{thm}[Euler]\nx\n\\end{thm}\n\\begin{rem}y\\end{rem}\\begin{proof}z\\end{proof}';
    expect([...theoremNames(source)]).toEqual([
      ['thm', 'Theorem'],
      ['rem', 'Remark'],
    ]);
    const out = rewriteTheorems(source);
    expect(out).toContain('\\par\\noindent\\textbf{Theorem (Euler).} \nx\n\\par \n');
    expect(out).toContain('\\textbf{Remark.} y\\par ');
    expect(out).toContain('\\textit{Proof.} z $\\square$\\par ');
    expect(lines(out)).toBe(lines(source));
  });

  it('puts a note in place of tables, and shows table floats in place', () => {
    const source = '\\begin{table}[htbp]\n\\begin{tabular}{ll}\na & b \\\\\n\\end{tabular}\n\\end{table}';
    const out = placeholderTables(source);
    expect(out).toContain("The preview can't show tables yet.");
    expect(out).toContain('\\begin{center}');
    expect(out).not.toContain('tabular');
    expect(out).not.toContain('[htbp]');
    expect(lines(out)).toBe(lines(source));
  });

  it('turns the appendices environment into \\appendix', () => {
    expect(rewriteAppendices('\\begin{appendices}\nx\n\\end{appendices}')).toBe('\\appendix\nx\n');
  });

  it('drops setup commands with their arguments, and says which', () => {
    const dropped = new Set<string>();
    const source = '\\sisetup{a = {b}, c}\n\\newtheorem{thm}{Theorem}[chapter]\n\\setlist[itemize]{\nnosep}\n\\listoffigures\n\\pause\n\\sisetupx';
    const out = stripSetupCommands(source, dropped);
    expect(out).toBe('\n\n\n\n\n\n\\sisetupx');
    expect([...dropped]).toEqual(['\\newtheorem', '\\sisetup', '\\setlist', '\\listoffigures', '\\pause']);
  });

  it('shows Beamer frames as pages with their titles', () => {
    const source = [
      '\\documentclass[aspectratio=169]{beamer}',
      '\\begin{document}',
      '\\begin{frame}\\titlepage\\end{frame}',
      '\\begin{frame}[t]{Title}{Sub}',
      '\\begin{block}{B}x\\end{block}',
      '\\begin{columns}\\begin{column}{0.5\\textwidth}L\\end{column}\\end{columns}',
      '\\item<2-> \\alert{hot}',
      '\\end{frame}',
      '\\begin{frame}\\frametitle{Other}y\\end{frame}',
      '\\end{document}',
    ].join('\n');
    const out = rewriteBeamer(source);
    expect(out).toContain('\\documentclass{article}');
    expect(out).toContain('\\maketitle');
    expect(out).toContain('{\\large\\textbf{Title}}');
    expect(out).toContain('\\textit{Sub}');
    expect(out).toContain('\\textbf{B}\\par x');
    expect(out).toContain('\\item \\emph{hot}');
    expect(out).toContain('{\\large\\textbf{Other}}');
    expect(out).not.toMatch(/frame|column|0\.5/);
    expect(out.match(/lcpagebreak/g)).toHaveLength(3);
    expect(lines(out)).toBe(lines(source));
    // Not a Beamer document: nothing changes.
    expect(rewriteBeamer('\\documentclass{article}\\begin{frame}')).toBe('\\documentclass{article}\\begin{frame}');
  });

  it('lets a document using these packages preview, and lists what it approximated', () => {
    const source = [
      '\\documentclass{article}',
      '\\usepackage{siunitx}',
      '\\sisetup{range-units = single}',
      '\\newtheorem{theorem}{Theorem}',
      '\\begin{document}',
      '\\section{A}\\label{sec:a}',
      '\\enquote{Hi}, see \\cref{sec:a}. \\qty{2}{\\metre}.',
      '\\begin{theorem}x\\end{theorem}',
      '\\begin{equation}a=b\\label{eq:a}\\end{equation}',
      '\\begin{table}[h]\\begin{tabular}{l}a\\end{tabular}\\end{table}',
      '\\begin{itemize}\\item x\\end{itemize}',
      '\\newpage',
      'after',
      '\\end{document}',
    ].join('\n');
    const adapted = adaptLatexSource(source);
    expect(lines(adapted.source)).toBe(lines(source));
    expect(adapted.changes).toEqual([
      "Removed packages the preview can't load: siunitx.",
      'Showed theorems and proofs without numbers.',
      'Showed numbered equations without their numbers.',
      'Showed \\cref as a plain reference.',
      'Wrote siunitx quantities as plain text.',
      "Put a note in place of tables the preview can't show.",
      'Ignored commands the preview has no use for: \\newtheorem, \\sisetup.',
    ]);
    const { html, errors } = latexSourceToPreviewHtml(source);
    expect(errors.map((e) => [e.line, e.severity])).toEqual([[2, 'info']]);
    const doc = new DOMParser().parseFromString(html!, 'text/html');
    // ~ is a no-break space.
    expect(doc.body.textContent).toMatch(/“Hi”, see section\s1\. 2\sm\./);
    // The \newpage right after a list still becomes a page break (its paragraph is marked "continue").
    expect(doc.querySelectorAll(`.${PAGE_BREAK_CLASS}`)).toHaveLength(1);
    expect(doc.body.textContent).not.toContain('lcpagebreak');
  });

  it('escapes every regex special character, including backslash and slash', () => {
    const special = '.*+?^${}()|[]\\/';
    expect(new RegExp(`^${escapeRegExp(special)}$`).test(special)).toBe(true);
    expect(escapeRegExp('a.b')).toBe('a\\.b');
    expect(new RegExp(escapeRegExp('a.b')).test('axb')).toBe(false);
  });

  it('escapes LaTeX specials in unit text, backslash included', () => {
    expect(escapeLatexText('\\{}&%$#_~^')).toBe('\\textbackslash{}\\{\\}\\&\\%\\$\\#\\_\\textasciitilde{}\\textasciicircum{}');
    expect(rewriteSiunitx('\\unit{a_b}')).toBe('a\\_b');
  });

  it('treats theorem names with regex characters as plain names', () => {
    const source = '\\newtheorem{th(m)*+}{Odd}\\begin{th(m)*+}x\\end{th(m)*+}\\begin{thm}y\\end{thm}';
    const out = rewriteTheorems(source);
    expect(out).toContain('\\textbf{Odd.} x\\par ');
    expect(out).toContain('\\begin{thm}y\\end{thm}');
  });

  it('pairs nested environments of the same name from the inside out, and leaves unclosed ones', () => {
    expect(rewriteAppendices('\\begin{appendices}a\\begin{appendices}b\\end{appendices}c\\end{appendices}')).toBe('\\appendixa\\appendixbc');
    expect(rewriteDisplayMath('\\begin{equation}a\\begin{equation}b\\end{equation}')).toBe('\\begin{equation}a\\[b\\]');
    expect(rewriteDisplayMath('\\end{equation}x')).toBe('\\end{equation}x');
  });

  it('stays fast on long hostile input', () => {
    const inputs = [
      '\\begin{equation}'.repeat(20_000),
      '\\begin{tabular}{'.repeat(20_000),
      '\\qty{'.repeat(20_000),
      `\\cref{${'a'.repeat(100_000)}`,
      `\\enquote{${'{'.repeat(50_000)}`,
      `\\begin{frame}${'{'.repeat(50_000)}\\end{frame}`,
      `{{${' '.repeat(100_000)}`,
    ];
    const started = performance.now();
    for (const input of inputs) adaptLatexSource(`\\documentclass{beamer}\n${input}`);
    // About 0.2 s here; the bound leaves room for slow CI machines, and quadratic code takes far longer.
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('small text package stand-ins', () => {
  it('drops enumitem list options, keeping line breaks', () => {
    expect(stripListOptions('\\begin{enumerate}[label=(\\alph*),\n  nosep]\\item a\\end{enumerate}')).toBe('\\begin{enumerate}\n\\item a\\end{enumerate}');
    expect(stripListOptions('\\begin{itemize*} [x] \\begin{description}\\begin{itemize}[')).toBe('\\begin{itemize} \\begin{description}\\begin{itemize}[');
  });

  it('drops \\xspace and \\FloatBarrier', () => {
    expect(stripXspace('\\newcommand{\\eg}{e.g.\\xspace} \\xspaceafter')).toBe('\\newcommand{\\eg}{e.g.} \\xspaceafter');
    expect(stripFloatBarrier('a\\FloatBarrier b')).toBe('a b');
  });

  it('puts one paragraph of filler text for each \\lipsum and \\blindtext', () => {
    const out = rewriteFillerText('\\lipsum[1-3]\n\\blindtext');
    expect(out.match(/Lorem ipsum/g)).toHaveLength(2);
    expect(lines(out)).toBe(2);
  });

  it('shows \\todo notes inline and drops \\listoftodos', () => {
    expect(rewriteTodos('a\\todo[inline]{fix} \\missingfigure{plot}\\listoftodos')).toBe(
      'a\\textit{(To do: fix)} \\par\\noindent\\textit{(Missing figure: plot)}\\par ',
    );
  });

  it('keeps underlines and shows strike-outs and highlights as plain text', () => {
    expect(rewriteUnderlines('\\uline{a} \\ul{b} \\sout{c} \\hl{d} \\caps{e}')).toBe('\\underline{a} \\underline{b} {c} {d} \\textsc{e}');
  });

  it('shows wrapped figures and subfigures in place', () => {
    expect(rewriteWrapFigures('\\begin{wrapfigure}[10]{r}{0.5\\textwidth}\nx\\end{wrapfigure}')).toBe('\\begin{center}\nx\\end{center}');
    expect(rewriteSubfigures('\\begin{subfigure}[b]{0.4\\textwidth}x\\subcaption{a}\\end{subfigure}')).toBe('x\\caption{a}\\par ');
  });
});
