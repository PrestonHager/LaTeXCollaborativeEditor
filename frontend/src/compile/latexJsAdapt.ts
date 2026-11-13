/**
 * Adapt real-world LaTeX for LaTeX.js in the browser. LaTeX.js tries to load many
 * \usepackage{} modules via Node require(), which fails under Vite/ESM; we strip
 * unsupported packages and inject minimal shims so common academic documents still preview.
 *
 * Every step keeps the line breaks of whatever it removes, so line N of the adapted source
 * is still line N of the editor. LaTeX.js error locations can then be used as-is.
 */

import {
  placeholderTables,
  rewriteAppendices,
  rewriteBeamer,
  rewriteCleveref,
  rewriteDisplayMath,
  rewriteEnquote,
  rewriteSiunitx,
  rewriteTheorems,
  stripSetupCommands,
} from './packageShims';

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

/** Remove lines that are only \usepackage{unsupported} (optional [...] args), and note which ones went. */
function stripUnsupportedUsePackages(source: string, removed: Set<string>): string {
  const re = /^\s*\\usepackage(?:\[[^\]]*])?\s*\{\s*([^}\s]+)\s*\}\s*(?:%[^\n]*)?\s*$/gm;
  return source.replace(re, (line, pkg: string) => {
    if (!UNSUPPORTED_USEPACKAGES.has(pkg.trim())) return line;
    removed.add(pkg.trim());
    return keepLineBreaks(line);
  });
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

/** Placement options like [H] or [htbp] -> default figure (LaTeX.js has no floats, so they'd show as text). */
function normalizeFigurePlacement(source: string): string {
  return source.replace(
    /\\begin\s*\{\s*figure\s*\}\s*\[\s*[htbpH!]*\s*]/g,
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

/** What a page break becomes in the source, so markPageBreaks (latexJsPreview.ts) can find it in the output. */
export const PAGE_BREAK_TOKEN = 'lcpagebreak';

/**
 * LaTeX.js ignores \newpage and friends. When one sits on a line of its own, put a marker
 * paragraph there instead, which becomes a page break when the preview is printed.
 */
function markPageBreakLines(source: string): string {
  return source.replace(
    /^([ \t]*)\\(?:newpage|clearpage|cleardoublepage|pagebreak(?:\[[0-4]\])?)[ \t]*(%.*)?$/gm,
    (_whole, indent: string, comment: string | undefined) => `${indent}\\par\\texttt{${PAGE_BREAK_TOKEN}}\\par${comment ?? ''}`,
  );
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

// Environments whose body LaTeX reads as plain text, so the rewrites must leave them alone.
const VERBATIM_ENVIRONMENTS = [
  'verbatim',
  'verbatim*',
  'Verbatim',
  'Verbatim*',
  'BVerbatim',
  'BVerbatim*',
  'LVerbatim',
  'LVerbatim*',
  'lstlisting',
  'minted',
  'comment',
];

// Commands whose first {argument} names a new verbatim-like environment
// (listings, fancyvrb and tcolorbox).
const VERBATIM_DEFINERS =
  /\\(?:lstnewenvironment|DefineVerbatimEnvironment|CustomVerbatimEnvironment|newtcblisting|renewtcblisting|DeclareTCBListing|NewTCBListing)\s*\{([^{}]+)\}/g;

// minted: \newminted{lang}{opts} makes `langcode` and `langcode*`, or `name` when given as [name].
const NEWMINTED = /\\newminted\s*(?:\[([^\]]+)]\s*)?\{([^{}]+)\}/g;

// \newenvironment{name}[n][default]{begin code}: the start, up to the { of the begin code.
const NEWENVIRONMENT = /\\(?:re)?newenvironment\s*\*?\s*\{([^{}]+)\}\s*(?:\[[^\]]*]\s*){0,2}\{/g;

// Begin code that starts a verbatim reader directly, like `\verbatim` or fancyvrb's `\VerbatimEnvironment`.
const VERBATIM_STARTERS = /\\(?:verbatim|Verbatim|BVerbatim|LVerbatim|VerbatimEnvironment|lstlisting|minted|comment)(?![a-zA-Z@])/;

/** Drop comments, so a commented-out definition doesn't count. `\%` is kept. */
function stripComments(source: string): string {
  return source.replace(/(^|[^\\])((?:\\\\)*)%[^\n]*/g, '$1$2');
}

/**
 * Find every environment whose body LaTeX reads as plain text: the built-in ones, plus any
 * the source defines with \lstnewenvironment, \DefineVerbatimEnvironment, \newminted, or a
 * \newenvironment whose begin code starts a verbatim environment.
 */
export function findVerbatimEnvironments(source: string): Set<string> {
  const text = stripComments(source);
  const found = new Set(VERBATIM_ENVIRONMENTS);
  for (const m of text.matchAll(VERBATIM_DEFINERS)) found.add(m[1].trim());
  for (const m of text.matchAll(NEWMINTED)) {
    if (m[1]) {
      found.add(m[1].trim());
    } else {
      found.add(`${m[2].trim()}code`);
      found.add(`${m[2].trim()}code*`);
    }
  }

  // A \newenvironment can wrap another one, so repeat until nothing new turns up.
  const wrappers = [...text.matchAll(NEWENVIRONMENT)].flatMap((m) => {
    const open = m.index + m[0].length - 1;
    const close = findClosingBrace(text, open);
    return close === -1 ? [] : [{ name: m[1].trim(), begin: text.slice(open + 1, close) }];
  });
  let grew = true;
  while (grew) {
    grew = false;
    for (const { name, begin } of wrappers) {
      if (found.has(name)) continue;
      const inner = [...begin.matchAll(/\\begin\s*\{([^{}]*)\}/g)].some((b) => found.has(b[1].trim()));
      if (inner || VERBATIM_STARTERS.test(begin)) {
        found.add(name);
        grew = true;
      }
    }
  }
  return found;
}

// Private-use characters mark a hidden piece of text. Real documents don't use them.
const MASK_OPEN = '';
const MASK_CLOSE = '';
const MASK_PATTERN = /(\d+)/g;

/**
 * Hide comments, \verb text, and verbatim-like environment bodies behind tokens, so the
 * rewrites can't touch them. Tokens never hold a line break, so line numbers stay put.
 */
function maskProtectedText(source: string): { masked: string; unmask: (text: string) => string } {
  const verbatimEnvironments = findVerbatimEnvironments(source);
  const saved: string[] = [];
  const hide = (text: string) => {
    if (!text) return '';
    saved.push(text);
    return `${MASK_OPEN}${saved.length - 1}${MASK_CLOSE}`;
  };
  let environment: string | null = null;

  const lines = source.split('\n').map((line) => {
    let out = '';
    let i = 0;
    while (i < line.length) {
      // Inside a verbatim block, hide everything up to its \end.
      if (environment) {
        const end = line.indexOf(`\\end{${environment}}`, i);
        if (end === -1) {
          out += hide(line.slice(i));
          break;
        }
        out += hide(line.slice(i, end));
        i = end;
        environment = null;
        continue;
      }
      const rest = line.slice(i);
      // Keep the % so line-based patterns still see a comment, but hide what follows it.
      if (rest[0] === '%') {
        out += `%${hide(rest.slice(1))}`;
        break;
      }
      if (rest[0] !== '\\') {
        out += rest[0];
        i += 1;
        continue;
      }
      const begin = /^\\begin\s*\{([^}]*)\}/.exec(rest);
      if (begin && verbatimEnvironments.has(begin[1].trim())) {
        out += begin[0];
        i += begin[0].length;
        environment = begin[1].trim();
        continue;
      }
      const verb = /^\\verb\*?([^a-zA-Z\s])/.exec(rest);
      if (verb) {
        // Hide the whole \verb, up to its closing delimiter or the end of the line.
        const close = rest.indexOf(verb[1], verb[0].length);
        const length = close === -1 ? rest.length : close + 1;
        out += hide(rest.slice(0, length));
        i += length;
        continue;
      }
      // Copy the backslash and the next character together, so \% isn't read as a comment.
      out += rest.slice(0, 2);
      i += 2;
    }
    return out;
  });

  return {
    masked: lines.join('\n'),
    unmask: (text) => text.replace(MASK_PATTERN, (m, n: string) => saved[Number(n)] ?? m),
  };
}

type Rewrite = { note: string | null; apply: (source: string) => string };

// Each rewrite in order, with the note to show in the preview when it changes something.
const REWRITES: Rewrite[] = [
  // Stand-ins for packages LaTeX.js lacks (packageShims.ts). Theorems go before their \newtheorem lines are dropped.
  { note: 'Showed Beamer frames as pages, without the theme.', apply: rewriteBeamer },
  { note: 'Showed theorems and proofs without numbers.', apply: rewriteTheorems },
  { note: 'Showed numbered equations without their numbers.', apply: rewriteDisplayMath },
  { note: 'Showed \\cref as a plain reference.', apply: rewriteCleveref },
  { note: null, apply: rewriteEnquote },
  { note: 'Wrote siunitx quantities as plain text.', apply: rewriteSiunitx },
  { note: "Put a note in place of tables the preview can't show.", apply: placeholderTables },
  { note: null, apply: rewriteAppendices },
  { note: 'Removed fancyhdr and nomencl setup commands.', apply: (s) => stripRenewcommandNomname(stripLinesMatching(s, LINE_REMOVE_PATTERNS)) },
  { note: 'Removed \\hypersetup.', apply: (s) => stripAllMacroGroups(s, 'hypersetup') },
  { note: 'Removed \\geometry.', apply: (s) => stripAllMacroGroups(s, 'geometry') },
  { note: 'Removed \\setmainfont.', apply: (s) => stripAllMacroGroups(s, 'setmainfont') },
  { note: 'Showed authblk \\author and \\affil as plain text.', apply: (s) => replaceAffilCommands(normalizeAuthblkAuthor(s)) },
  { note: 'Showed figures in place instead of floating.', apply: (s) => normalizeFigureEnvironment(normalizeFigurePlacement(s)) },
  { note: 'Showed \\nomenclature entries as plain text and dropped \\printnomenclature.', apply: (s) => expandNomenclatureCalls(stripPrintNomenclature(s)) },
  // The copyright sign looks the same either way, so there's nothing to note.
  { note: null, apply: expandTextCopyright },
  { note: "Put a note in place of images the browser can't show.", apply: placeholderIncludeGraphics },
  { note: 'Showed \\caption as bold text.', apply: rewriteCaption },
  { note: 'Showed footnotes inline in parentheses.', apply: inlineFootnotes },
  { note: 'Removed \\vspace.', apply: stripVspace },
  { note: 'Removed \\addcontentsline.', apply: stripAddContentsLine },
  // A page break shows nothing on screen, so there's nothing to note.
  { note: null, apply: markPageBreakLines },
];

export type AdaptedSource = {
  source: string;
  /** Short notes on what was removed or rewritten, for showing with the preview. */
  changes: string[];
};

/**
 * Adapt LaTeX for LaTeX.js and say what changed. Comments and verbatim-like text are
 * left exactly as they were.
 */
export function adaptLatexSource(source: string): AdaptedSource {
  const { masked, unmask } = maskProtectedText(source);
  const changes: string[] = [];

  // First, drop the packages LaTeX.js can't load.
  const packages = new Set<string>();
  let s = stripUnsupportedUsePackages(masked, packages);
  if (packages.size) changes.push(`Removed packages the preview can't load: ${[...packages].join(', ')}.`);

  // Then run each rewrite and note the ones that did something.
  for (const rewrite of REWRITES) {
    const next = rewrite.apply(s);
    if (next !== s && rewrite.note) changes.push(rewrite.note);
    s = next;
  }

  // Setup commands with nothing to show, like \sisetup, go last, after the theorems were read from \newtheorem.
  const dropped = new Set<string>();
  s = stripSetupCommands(s, dropped);
  if (dropped.size) changes.push(`Ignored commands the preview has no use for: ${[...dropped].join(', ')}.`);

  // Finally, put the hidden text back.
  return { source: unmask(s), changes };
}

export function adaptLatexSourceForLatexJs(source: string): string {
  return adaptLatexSource(source).source;
}
