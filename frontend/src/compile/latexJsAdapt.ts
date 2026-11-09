/**
 * Adapt real-world LaTeX for LaTeX.js in the browser. LaTeX.js tries to load many
 * \usepackage{} modules via Node require(), which fails under Vite/ESM; we strip
 * unsupported packages and inject minimal shims so common academic documents still preview.
 *
 * Every step keeps the line breaks of whatever it removes, so line N of the adapted source
 * is still line N of the editor. LaTeX.js error locations can then be used as-is.
 */

const UNSUPPORTED_USEPACKAGES = new Set([
  'geometry',
  'indentfirst',
  'gensymb',
  'fontspec',
  'fancyhdr',
  'nomencl',
  'authblk',
  'textcomp',
  'float',
]);

/** Find index of closing `}` matching `{` at openIdx (brace depth, ignore escaped braces loosely). */
function findClosingBrace(source: string, openIdx: number): number {
  let depth = 0;
  for (let k = openIdx; k < source.length; k++) {
    const ch = source[k];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/** Keep only the line breaks of removed text, so later lines don't shift. */
function keepLineBreaks(removed: string): string {
  return removed.replace(/[^\n]/g, '');
}

/** Remove first `\name{...}` with balanced braces. Returns original if not found. */
function stripMacroGroup(source: string, name: string): string {
  const needle = `\\${name}`;
  const i = source.indexOf(needle);
  if (i === -1) return source;
  let j = i + needle.length;
  while (j < source.length && /\s/.test(source[j])) j += 1;
  if (source[j] !== '{') return source;
  const close = findClosingBrace(source, j);
  if (close === -1) return source;
  return source.slice(0, i) + keepLineBreaks(source.slice(i, close + 1)) + source.slice(close + 1);
}

function stripAllMacroGroups(source: string, name: string): string {
  let s = source;
  let prev = '';
  while (s !== prev) {
    prev = s;
    s = stripMacroGroup(s, name);
  }
  return s;
}

/** Remove lines that are only \usepackage{unsupported} (optional [...] args). */
function stripUnsupportedUsePackages(source: string): string {
  const re = /^\s*\\usepackage(?:\[[^\]]*])?\s*\{\s*([^}\s]+)\s*\}\s*(?:%[^\n]*)?\s*$/gm;
  return source.replace(re, (line, pkg: string) =>
    UNSUPPORTED_USEPACKAGES.has(pkg.trim()) ? keepLineBreaks(line) : line,
  );
}

/** Blank out single-line preamble commands that break or duplicate stubs. */
function stripLinesMatching(source: string, patterns: RegExp[]): string {
  const lines = source.split(/\r?\n/);
  return lines.map((line) => (patterns.some((p) => p.test(line)) ? '' : line)).join('\n');
}

/** authblk: \author[1,2]{Name} -> \author{Name} */
function normalizeAuthblkAuthor(source: string): string {
  return source.replace(/\\author\s*\[[^\]]*]\s*/g, (m) => `\\author ${keepLineBreaks(m)}`);
}

/**
 * authblk \affil[opt]{body} -> paragraph with body (affil macro removed with package).
 */
function replaceAffilCommands(source: string): string {
  let s = source;
  const needle = '\\affil';
  let guard = 0;
  while (guard++ < 500) {
    const i = s.indexOf(needle);
    if (i === -1) break;
    let j = i + needle.length;
    while (j < s.length && /\s/.test(s[j])) j += 1;
    if (s[j] === '[') {
      const closeBr = s.indexOf(']', j);
      if (closeBr === -1) break;
      j = closeBr + 1;
      while (j < s.length && /\s/.test(s[j])) j += 1;
    }
    if (s[j] !== '{') break;
    const close = findClosingBrace(s, j);
    if (close === -1) break;
    const body = s.slice(j + 1, close);
    // Use \par on both sides instead of adding new lines.
    const replacement = `${keepLineBreaks(s.slice(i, j + 1))}\\par {\\small ${body}}\\par `;
    s = s.slice(0, i) + replacement + s.slice(close + 1);
  }
  return s;
}

/** float package [H] -> default figure (LaTeX.js has no float package). */
function normalizeFigurePlacement(source: string): string {
  return source.replace(
    /\\begin\s*\{\s*figure\s*\}\s*\[\s*H\s*]/gi,
    (m) => `\\begin{figure}${keepLineBreaks(m)}`,
  );
}

/** LaTeX.js has no `figure` environment; use `center` so captions and graphics still typeset. */
function normalizeFigureEnvironment(source: string): string {
  return source
    .replace(/\\begin\s*\{\s*figure\s*\}/gi, (m) => `\\begin{center}${keepLineBreaks(m)}`)
    .replace(/\\end\s*\{\s*figure\s*\}/gi, (m) => `\\end{center}${keepLineBreaks(m)}`);
}

const LINE_REMOVE_PATTERNS = [
  /^\s*\\makenomenclature\s*(?:%[^\n]*)?\s*$/,
  /^\s*\\pagestyle\s*\{\s*fancy\s*\}\s*(?:%[^\n]*)?\s*$/,
  /^\s*\\fancyhf\s*\{\s*\}\s*(?:%[^\n]*)?\s*$/,
  /^\s*\\fancyhead\s*\[[^\]]*]\s*\{[^}]*\}\s*(?:%[^\n]*)?\s*$/,
  /^\s*\\renewcommand\s*\{\\headrulewidth\}\s*\{[^}]*\}\s*(?:%[^\n]*)?\s*$/,
];

/** `\renewcommand{\nomname}{...}` — second argument may contain nested `{` (e.g. `\large{...}`). */
function stripRenewcommandNomname(source: string): string {
  const key = '\\renewcommand{\\nomname}';
  let idx = 0;
  let s = source;
  while (true) {
    const i = s.indexOf(key, idx);
    if (i === -1) return s;
    let j = i + key.length;
    while (j < s.length && /\s/.test(s[j])) j += 1;
    if (s[j] !== '{') {
      idx = i + key.length;
      continue;
    }
    const end = findClosingBrace(s, j);
    if (end === -1) return s;
    s = s.slice(0, i) + keepLineBreaks(s.slice(i, end + 1)) + s.slice(end + 1);
    idx = i;
  }
}

/** `\nomenclature{first}{second}` → `first` (preview only; no `\\def` — LaTeX.js does not implement it). */
function expandNomenclatureCalls(source: string): string {
  const needle = '\\nomenclature';
  let s = source;
  let guard = 0;
  while (guard++ < 5000) {
    const i = s.indexOf(needle);
    if (i === -1) break;
    let j = i + needle.length;
    while (j < s.length && /\s/.test(s[j])) j += 1;
    if (s[j] !== '{') break;
    const c1 = findClosingBrace(s, j);
    if (c1 === -1) break;
    let k = c1 + 1;
    while (k < s.length && /\s/.test(s[k])) k += 1;
    if (s[k] !== '{') break;
    const c2 = findClosingBrace(s, k);
    if (c2 === -1) break;
    const first = s.slice(j + 1, c1);
    s = s.slice(0, i) + first + keepLineBreaks(s.slice(i, j) + s.slice(c1, c2 + 1)) + s.slice(c2 + 1);
  }
  return s;
}

function stripPrintNomenclature(source: string): string {
  return source.replace(/\\printnomenclature\s*/g, keepLineBreaks);
}

function expandTextCopyright(source: string): string {
  return source
    .replace(/\\textcopyright\s*\{\s*\}/g, (m) => `©${keepLineBreaks(m)}`)
    .replace(/\\textcopyright\b/g, '©');
}

/**
 * Leave project images (already swapped for lcimg tokens by projectSource.ts) for LaTeX.js to place.
 * Anything else is missing or a format the browser can't show, like PDF or EPS, so put in a note instead.
 */
function placeholderIncludeGraphics(source: string): string {
  return source.replace(/\\includegraphics(?:\[[^\]]*])?\s*\{([^}]*)\}/g, (m, name: string) => {
    if (/^lcimg\d+$/.test(name)) return m;
    // Drop characters that mean something to LaTeX, so a strange file name can't break the preview.
    const shown = name.replace(/[\\{}$&#^_%~]/g, '');
    return `\\par\\noindent\\textit{Figure \\texttt{${shown}} can't be shown in the browser preview.}\\par${keepLineBreaks(m)}`;
  });
}

/** Outside `figure`, `\\caption` is unavailable in LaTeX.js; turn into bold heading text. */
function rewriteCaption(source: string): string {
  return source.replace(
    /\\caption(\s*)\{([^}]*)\}/g,
    (_m, gap: string, text: string) => `\\par\\noindent\\textbf{${text}}\\par${keepLineBreaks(gap)}`,
  );
}

/** LaTeX.js does not implement vertical spacing primitives used for title-page centering. */
function stripVspace(source: string): string {
  return source
    .replace(/\\vspace\*\s*\{[^}]*\}/g, keepLineBreaks)
    .replace(/\\vspace\s*\{[^}]*\}/g, keepLineBreaks);
}

function stripAddContentsLine(source: string): string {
  return source.replace(/\\addcontentsline\s*\{[^}]*\}\s*\{[^}]*\}\s*\{[^}]*\}\s*/g, keepLineBreaks);
}

/** LaTeX.js has no footnotes; inline parenthetical so layout continues. */
function inlineFootnotes(source: string): string {
  const needle = '\\footnote';
  let s = source;
  let guard = 0;
  while (guard++ < 500) {
    const i = s.indexOf(needle);
    if (i === -1) break;
    let j = i + needle.length;
    while (j < s.length && /\s/.test(s[j])) j += 1;
    if (s[j] !== '{') break;
    const end = findClosingBrace(s, j);
    if (end === -1) break;
    const inner = s.slice(j + 1, end);
    s = `${s.slice(0, i)}${keepLineBreaks(s.slice(i, j))}\\textit{(${inner})}${s.slice(end + 1)}`;
  }
  return s;
}

export function adaptLatexSourceForLatexJs(source: string): string {
  let s = source;
  s = stripUnsupportedUsePackages(s);
  s = stripLinesMatching(s, LINE_REMOVE_PATTERNS);
  s = stripRenewcommandNomname(s);
  s = stripAllMacroGroups(s, 'hypersetup');
  s = stripAllMacroGroups(s, 'geometry');
  s = stripAllMacroGroups(s, 'setmainfont');
  s = normalizeAuthblkAuthor(s);
  s = replaceAffilCommands(s);
  s = normalizeFigurePlacement(s);
  s = normalizeFigureEnvironment(s);
  s = stripPrintNomenclature(s);
  s = expandNomenclatureCalls(s);
  s = expandTextCopyright(s);
  s = placeholderIncludeGraphics(s);
  s = rewriteCaption(s);
  s = inlineFootnotes(s);
  s = stripVspace(s);
  s = stripAddContentsLine(s);
  return s;
}
