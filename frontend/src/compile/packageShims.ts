/**
 * Preview stand-ins for packages that modern documents (and the built-in templates, #74) load:
 * cleveref, csquotes, siunitx, amsmath's numbered environments, amsthm, appendix, booktabs tables
 * and Beamer. LaTeX.js has none of them, and one unknown command stops the whole preview, so these
 * rewrite each to something LaTeX.js can typeset. They're approximations; the preview lists each
 * one it used (latexJsAdapt.ts).
 *
 * Like every adapter step, each rewrite keeps the line breaks of what it replaces.
 */

const keepLineBreaks = (removed: string) => removed.replace(/[^\n]/g, '');

/** The line breaks of `whole` that aren't in the parts of it that are kept. */
const outside = (whole: string, ...kept: string[]) => keepLineBreaks(whole).slice(kept.reduce((count, part) => count + keepLineBreaks(part).length, 0));

/** Escape every character a regular expression treats as special, so a string matches only itself. */
export const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Escape the characters LaTeX treats as special, for text we put into the source. */
const LATEX_SPECIALS: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
};
export const escapeLatexText = (text: string) => text.replace(/[\\{}&%$#_~^]/g, (char) => LATEX_SPECIALS[char]);

type Matcher = (start: number) => number;

/**
 * Where each { and [ in a source closes, found in one pass, so reading many commands' arguments
 * stays linear even when braces never close. A backslash skips the next character, so \{ and \[
 * don't count. The result is -1 for an opener with no match.
 */
function matcher(source: string): Matcher {
  let closes: Map<number, number> | null = null;
  return (start) => {
    if (!closes) {
      closes = new Map();
      const braces: number[] = [];
      const brackets: number[] = [];
      for (let i = 0; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '\\') i += 1;
        else if (ch === '{') braces.push(i);
        else if (ch === '[') brackets.push(i);
        else if (ch === '}' && braces.length) closes.set(braces.pop()!, i);
        else if (ch === ']' && brackets.length) closes.set(brackets.pop()!, i);
      }
    }
    return closes.get(start) ?? -1;
  };
}

const skipSpaces = (source: string, i: number) => {
  while (i < source.length && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n')) i += 1;
  return i;
};

type Parsed = { end: number; optional: string[]; groups: string[] };

/**
 * Read a command's arguments from `i` (just past its name): a `*`, then [options] and {groups}
 * until `groups` mandatory ones are read. [options] right after the last group are read too.
 */
function readArgs(source: string, i: number, groups: number, matching: Matcher = matcher(source)): Parsed | null {
  const optional: string[] = [];
  const found: string[] = [];
  if (source[i] === '*') i += 1;
  for (;;) {
    const j = skipSpaces(source, i);
    if (source[j] === '[' && found.length < groups) {
      const close = matching(j);
      if (close === -1) return null;
      optional.push(source.slice(j + 1, close));
      i = close + 1;
    } else if (source[j] === '{' && found.length < groups) {
      const close = matching(j);
      if (close === -1) return null;
      found.push(source.slice(j + 1, close));
      i = close + 1;
    } else break;
  }
  if (found.length < groups) return null;
  // Trailing [options] only count when they follow right away, like \newtheorem{thm}{Theorem}[chapter].
  while (source[i] === '[') {
    const close = matching(i);
    if (close === -1) break;
    optional.push(source.slice(i + 1, close));
    i = close + 1;
  }
  return { end: i, optional, groups: found };
}

/** Replace every `\name` for the given names (not longer names) with what `replace` returns for its arguments. */
function replaceCommand(source: string, names: string | string[], groups: number, replace: (args: Parsed, whole: string) => string): string {
  const alternatives = (Array.isArray(names) ? names : [names]).map(escapeRegExp).join('|');
  const pattern = new RegExp(`\\\\(?:${alternatives})(?![A-Za-z@])`, 'g');
  let out = '';
  let last = 0;
  const matching = matcher(source);
  for (const match of source.matchAll(pattern)) {
    const start = match.index;
    if (start < last) continue;
    const args = readArgs(source, start + match[0].length, groups, matching);
    if (!args) continue;
    const whole = source.slice(start, args.end);
    out += source.slice(last, start) + replace(args, whole);
    last = args.end;
  }
  return out + source.slice(last);
}

// \begin{name} or \end{name}. Linear: no nested quantifiers.
const ENVIRONMENT_TAG = /\\(begin|end)\s*\{([^{}]*)\}/g;

type Pair = { start: number; beginEnd: number; endStart: number; end: number; name: string };

/**
 * Replace `\begin{env}...\end{env}` for each env in `names`. Inner ones are replaced first, and
 * their result is what the outer one sees. A scanner with a stack, not one big regex, so a
 * document with unclosed environments can't make it backtrack.
 */
function replaceEnvironment(
  source: string,
  names: string[],
  replace: (name: string, args: Parsed, body: string, begin: string, end: string) => string,
  argGroups = 0,
): string {
  const wanted = new Set(names);
  const open: { name: string; start: number; beginEnd: number }[] = [];
  const pairs: Pair[] = [];
  for (const match of source.matchAll(ENVIRONMENT_TAG)) {
    const name = match[2];
    if (!wanted.has(name)) continue;
    if (match[1] === 'begin') {
      open.push({ name, start: match.index, beginEnd: match.index + match[0].length });
      continue;
    }
    // Pair it with the nearest open one of the same name. Unclosed ones in between are left as they are.
    const at = open.map((entry) => entry.name).lastIndexOf(name);
    if (at === -1) continue;
    const begin = open[at];
    open.length = at;
    pairs.push({ ...begin, endStart: match.index, end: match.index + match[0].length });
  }
  if (!pairs.length) return source;
  pairs.sort((a, b) => a.start - b.start);

  // Write out [from, to), replacing each pair in it; a pair's body is written the same way first.
  const render = (from: number, to: number, index: { next: number }): string => {
    let out = '';
    let at = from;
    while (index.next < pairs.length && pairs[index.next].start < to) {
      const pair = pairs[index.next];
      index.next += 1;
      if (pair.start < at || pair.end > to) continue;
      const inner = render(pair.beginEnd, pair.endStart, index);
      out += source.slice(at, pair.start) + renderPair(pair, inner);
      at = pair.end;
    }
    return out + source.slice(at, to);
  };
  const renderPair = (pair: Pair, inner: string): string => {
    const beginTag = source.slice(pair.start, pair.beginEnd);
    const endTag = source.slice(pair.endStart, pair.end);
    const whole = beginTag + inner;
    const args = readArgs(whole, beginTag.length, argGroups) ?? { end: beginTag.length, optional: [], groups: [] };
    return replace(pair.name, args, whole.slice(args.end), whole.slice(0, args.end), endTag);
  };
  return render(0, source.length, { next: 0 });
}

// --- cleveref ---------------------------------------------------------------------------------

// What cleveref would call a reference, guessed from the label's prefix (sec:intro is a section).
const REFERENCE_NAMES: Record<string, string> = {
  sec: 'section',
  ssec: 'section',
  subsec: 'section',
  ch: 'chapter',
  chap: 'chapter',
  fig: 'figure',
  tab: 'table',
  eq: 'equation',
  eqn: 'equation',
  thm: 'theorem',
  lem: 'lemma',
  def: 'definition',
  cor: 'corollary',
  prop: 'proposition',
  app: 'appendix',
  lst: 'listing',
};

/** \cref{sec:a,sec:b} becomes "sections \ref{sec:a} and \ref{sec:b}"; \Cref capitalizes. */
export function rewriteCleveref(source: string): string {
  return source.replace(/\\(c|C)ref\*?\s*\{([^{}]*)\}/g, (_whole, c: string, keys: string) => {
    const labels = keys.split(',').map((key) => key.trim()).filter(Boolean);
    const kind = REFERENCE_NAMES[labels[0]?.split(':')[0] ?? ''];
    const refs = labels.map((key) => `\\ref{${key}}`);
    const list = refs.length > 1 ? `${refs.slice(0, -1).join(', ')} and ${refs[refs.length - 1]}` : (refs[0] ?? '');
    if (!kind) return list;
    const word = `${kind}${labels.length > 1 ? 's' : ''}`;
    return `${c === 'C' ? word.charAt(0).toUpperCase() + word.slice(1) : word}~${list}`;
  });
}

// --- csquotes -----------------------------------------------------------------------------------

export function rewriteEnquote(source: string): string {
  return replaceCommand(source, 'enquote', 1, ({ groups: [text] }, whole) =>
    whole.startsWith('\\enquote*') ? `\`${text}'${outside(whole, text)}` : `\`\`${text}''${outside(whole, text)}`,
  );
}

// --- siunitx ------------------------------------------------------------------------------------

const PREFIXES: Record<string, string> = {
  yocto: 'y', zepto: 'z', atto: 'a', femto: 'f', pico: 'p', nano: 'n', micro: 'µ', milli: 'm', centi: 'c', deci: 'd',
  deca: 'da', deka: 'da', hecto: 'h', kilo: 'k', mega: 'M', giga: 'G', tera: 'T', peta: 'P', exa: 'E',
};
const UNITS: Record<string, string> = {
  metre: 'm', meter: 'm', second: 's', gram: 'g', kilogram: 'kg', ampere: 'A', kelvin: 'K', mole: 'mol', candela: 'cd',
  hertz: 'Hz', newton: 'N', pascal: 'Pa', joule: 'J', watt: 'W', coulomb: 'C', volt: 'V', ohm: 'Ω', farad: 'F',
  siemens: 'S', weber: 'Wb', tesla: 'T', henry: 'H', celsius: '°C', degreeCelsius: '°C', lumen: 'lm', lux: 'lx',
  becquerel: 'Bq', gray: 'Gy', sievert: 'Sv', katal: 'kat', radian: 'rad', steradian: 'sr', litre: 'L', liter: 'L',
  minute: 'min', hour: 'h', day: 'd', degree: '°', arcminute: '′', arcsecond: '″', hectare: 'ha', tonne: 't',
  electronvolt: 'eV', dalton: 'Da', bar: 'bar', decibel: 'dB', percent: '%', angstrom: 'Å', bel: 'B', neper: 'Np',
};
const POWERS: Record<string, string> = { squared: '²', cubed: '³' };
const SUPERSCRIPT: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

/** \kilo\metre\per\second\squared becomes km/s². Literal units like m.s^{-1} keep their text. */
export function formatUnit(unit: string): string {
  const text = unit.trim();
  if (!text.includes('\\')) {
    return text
      .replace(/\^\{?(-?\d+)\}?/g, (_m, power: string) => [...power].map((ch) => SUPERSCRIPT[ch] ?? ch).join(''))
      .replace(/[~.]/g, '·');
  }
  const above: string[] = [];
  const below: string[] = [];
  let prefix = '';
  let per = false;
  // The list the last unit went into, so a power after it (\per\second\squared) lands on that unit.
  let last: string[] = above;
  for (const [, name, arg] of text.matchAll(/\\([A-Za-z]+)(?:\s*\{([^{}]*)\})?/g)) {
    if (name === 'per') per = true;
    else if (PREFIXES[name] !== undefined) prefix += PREFIXES[name];
    else if (POWERS[name] || name === 'tothe' || name === 'raiseto') {
      const list = last;
      const power = POWERS[name] ?? [...(arg ?? '')].map((ch) => SUPERSCRIPT[ch] ?? ch).join('');
      if (list.length) list[list.length - 1] += power;
    } else if (name === 'square' || name === 'cubic') {
      // \square\metre puts the power before the unit.
      prefix = `${prefix}${name === 'square' ? '\u0002' : '\u0003'}`;
    } else {
      let symbol = `${prefix.replace(/[\u0002\u0003]/g, '')}${UNITS[name] ?? name}`;
      if (prefix.includes('\u0002')) symbol += '²';
      if (prefix.includes('\u0003')) symbol += '³';
      last = per ? below : above;
      last.push(symbol);
      prefix = '';
      per = false;
    }
  }
  const top = above.join('·') || '1';
  return below.length ? `${top}/${below.length > 1 ? `(${below.join('·')})` : below[0]}` : top;
}

/** 6.022e23 becomes 6.022 × 10²³, and a plain number stays as it is. */
export function formatNumber(number: string): string {
  const match = /^\s*([-+]?[\d.,]*)\s*[eE]\s*([-+]?\d+)\s*$/.exec(number);
  if (!match) return number.trim();
  const exponent = [...match[2].replace(/^\+/, '')].map((ch) => SUPERSCRIPT[ch] ?? ch).join('');
  return match[1] ? `${match[1]} × 10${exponent}` : `10${exponent}`;
}

export function rewriteSiunitx(source: string): string {
  let s = source;
  const unitText = (unit: string) => escapeLatexText(formatUnit(unit));
  s = replaceCommand(s, ['qtyrange', 'SIrange'], 3, ({ groups: [a, b, unit] }, whole) => `${formatNumber(a)}--${formatNumber(b)}~${unitText(unit)}${keepLineBreaks(whole)}`);
  s = replaceCommand(s, ['qty', 'SI'], 2, ({ groups: [value, unit] }, whole) => `${formatNumber(value)}~${unitText(unit)}${keepLineBreaks(whole)}`);
  s = replaceCommand(s, 'numrange', 2, ({ groups: [a, b] }, whole) => `${formatNumber(a)}--${formatNumber(b)}${keepLineBreaks(whole)}`);
  s = replaceCommand(s, 'num', 1, ({ groups: [value] }, whole) => `${formatNumber(value)}${keepLineBreaks(whole)}`);
  s = replaceCommand(s, ['unit', 'si'], 1, ({ groups: [unit] }, whole) => `${unitText(unit)}${keepLineBreaks(whole)}`);
  s = replaceCommand(s, 'ang', 1, ({ groups: [value] }, whole) => `${value.trim()}°${keepLineBreaks(whole)}`);
  return s;
}

// --- amsmath ------------------------------------------------------------------------------------

const DISPLAY_MATH: Record<string, [string, string]> = {
  equation: ['\\[', '\\]'],
  'equation*': ['\\[', '\\]'],
  align: ['\\[\\begin{aligned}', '\\end{aligned}\\]'],
  'align*': ['\\[\\begin{aligned}', '\\end{aligned}\\]'],
  flalign: ['\\[\\begin{aligned}', '\\end{aligned}\\]'],
  'flalign*': ['\\[\\begin{aligned}', '\\end{aligned}\\]'],
  gather: ['\\[\\begin{gathered}', '\\end{gathered}\\]'],
  'gather*': ['\\[\\begin{gathered}', '\\end{gathered}\\]'],
  multline: ['\\[\\begin{gathered}', '\\end{gathered}\\]'],
  'multline*': ['\\[\\begin{gathered}', '\\end{gathered}\\]'],
};

/** Numbered math environments become \[ ... \] for KaTeX, without \label, \nonumber and \notag. */
export function rewriteDisplayMath(source: string): string {
  return replaceEnvironment(source, Object.keys(DISPLAY_MATH), (name, _args, body, begin, end) => {
    const [open, close] = DISPLAY_MATH[name];
    const cleaned = body.replace(/\\label\s*\{[^{}]*\}|\\nonumber\b|\\notag\b/g, keepLineBreaks);
    return `${open}${keepLineBreaks(begin)}${cleaned}${close}${keepLineBreaks(end)}`;
  });
}

// --- amsthm -------------------------------------------------------------------------------------

/** The theorem-like environments \newtheorem defines, with their printed names. */
export function theoremNames(source: string): Map<string, string> {
  const names = new Map<string, string>();
  replaceCommand(source, 'newtheorem', 2, ({ groups: [name, title] }) => {
    names.set(name.trim(), title.trim());
    return '';
  });
  return names;
}

export function rewriteTheorems(source: string): string {
  const names = theoremNames(source);
  names.set('proof', 'Proof');
  return replaceEnvironment(source, [...names.keys()], (name, args, body, begin, end) => {
    const title = names.get(name)!;
    const head =
      name === 'proof'
        ? `\\par\\noindent\\textit{${args.optional[0] ?? title}.} `
        : `\\par\\noindent\\textbf{${title}${args.optional[0] ? ` (${args.optional[0]})` : ''}.} `;
    const tail = name === 'proof' ? ' $\\square$\\par ' : '\\par ';
    return `${head}${keepLineBreaks(begin)}${body}${tail}${keepLineBreaks(end)}`;
  });
}

// --- tables -------------------------------------------------------------------------------------

const TABLE_NOTE = "\\par\\noindent\\textit{(A table goes here. The preview can't show tables yet.)}\\par ";

/** LaTeX.js has no tabular. Put a note in its place, like a figure the browser can't show. */
export function placeholderTables(source: string): string {
  let s = replaceEnvironment(source, ['tabular', 'tabular*', 'tabularx', 'tabulary', 'longtable', 'tblr', 'longtblr'], (_name, _args, body, begin, end) => `${TABLE_NOTE}${keepLineBreaks(begin + body + end)}`);
  // A table float shows in place, like figures do.
  s = s.replace(/\\begin\s*\{\s*table\*?\s*\}(\s*\[[^\]]*\])?/g, (m) => `\\begin{center}${keepLineBreaks(m)}`).replace(/\\end\s*\{\s*table\*?\s*\}/g, (m) => `\\end{center}${keepLineBreaks(m)}`);
  return s;
}

// --- Setup commands and lists the preview has no use for ------------------------------------------

// Setup commands with how many {groups} each takes. Their [options] go with them.
const SETUP_COMMANDS: Record<string, number> = {
  newtheorem: 2,
  theoremstyle: 1,
  sisetup: 1,
  setlist: 1,
  DeclareMathOperator: 2,
  graphicspath: 1,
  pgfplotsset: 1,
  usetikzlibrary: 1,
  captionsetup: 1,
  crefname: 3,
  Crefname: 3,
  pagenumbering: 1,
  usetheme: 1,
  usecolortheme: 1,
  usefonttheme: 1,
  useinnertheme: 1,
  useoutertheme: 1,
  setbeamertemplate: 2,
  setbeamercolor: 2,
  setbeamerfont: 2,
  institute: 1,
  beamertemplatenavigationsymbolsempty: 0,
  listoffigures: 0,
  listoftables: 0,
  pause: 0,
};

/** Drop setup commands. Returns the names it dropped, for the preview's notes. */
export function stripSetupCommands(source: string, dropped: Set<string>): string {
  let s = source;
  for (const [name, groups] of Object.entries(SETUP_COMMANDS)) {
    s = replaceCommand(s, name, groups, (_args, whole) => {
      dropped.add(`\\${name}`);
      return keepLineBreaks(whole);
    });
  }
  return s;
}

/** The appendix package's environment. The standard \appendix does the same job. */
export function rewriteAppendices(source: string): string {
  return source.replace(/\\begin\s*\{\s*appendices\s*\}/g, (m) => `\\appendix${keepLineBreaks(m)}`).replace(/\\end\s*\{\s*appendices\s*\}/g, keepLineBreaks);
}

// --- Beamer -------------------------------------------------------------------------------------

const BEAMER_CLASS = /\\documentclass\s*(\[[^\]]*\])?\s*\{\s*beamer\s*\}/;

export const isBeamer = (source: string) => BEAMER_CLASS.test(source);

/**
 * Beamer slides as article pages: each frame starts with its title in bold and ends with a page
 * break, and blocks become bold headings. Overlays, themes and columns go.
 */
export function rewriteBeamer(source: string): string {
  if (!isBeamer(source)) return source;
  let s = source.replace(BEAMER_CLASS, (m) => `\\documentclass{article}${keepLineBreaks(m)}`);
  s = s.replace(/\\titlepage\b/g, '\\maketitle');
  const heading = (title: string) => `\\par\\noindent{\\large\\textbf{${title}}}\\par `;
  s = replaceCommand(s, 'frametitle', 1, ({ groups: [title] }, whole) => `${heading(title)}${outside(whole, title)}`);
  s = replaceCommand(s, 'framesubtitle', 1, ({ groups: [title] }, whole) => `\\par\\noindent\\textit{${title}}\\par ${outside(whole, title)}`);
  // \begin{frame}<overlay>[options]{Title}{Subtitle}. The title and subtitle have to follow right away.
  s = replaceEnvironment(s, ['frame'], (_name, _args, body, begin, end) => {
    const titles = /^(?:<[^>]*>)?(?:\[[^\]]*\])?(?:\{([^{}]*)\})?(?:\{([^{}]*)\})?/.exec(body)!;
    const [taken, title, subtitle] = titles;
    const head = `${title ? heading(title) : ''}${subtitle ? `\\noindent\\textit{${subtitle}}\\par ` : ''}`;
    return `${head}${keepLineBreaks(begin + taken)}${body.slice(taken.length)}\\par\\texttt{lcpagebreak}\\par ${keepLineBreaks(end)}`;
  });
  s = replaceEnvironment(
    s,
    ['block', 'alertblock', 'exampleblock'],
    (_name, args, body, begin, end) => `\\par\\noindent\\textbf{${args.groups[0] ?? ''}}\\par ${outside(begin, args.groups[0] ?? '')}${body}\\par ${keepLineBreaks(end)}`,
    1,
  );
  s = replaceEnvironment(s, ['columns'], (_name, _args, body, begin, end) => `${keepLineBreaks(begin)}${body}${keepLineBreaks(end)}`);
  s = replaceEnvironment(s, ['column'], (_name, _args, body, begin, end) => `${keepLineBreaks(begin)}${body}\\par ${keepLineBreaks(end)}`, 1);
  s = replaceCommand(s, 'alert', 1, ({ groups: [text] }, whole) => `\\emph{${text}}${outside(whole, text)}`);
  // Overlay specs like \item<2-> mean nothing on a static page.
  s = s.replace(/(\\item)\s*<[^>]*>/g, '$1');
  return s;
}
