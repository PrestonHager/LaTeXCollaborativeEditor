/**
 * Preview stand-ins for math packages KaTeX doesn't have: physics, derivative and braket. Their
 * commands are rewritten to plain KaTeX math (`\dv{f}{x}` becomes `\frac{\mathrm{d} f}{\mathrm{d} x}`).
 * LaTeX.js can't take \newcommand with arguments, so the preview can't just define them.
 *
 * Only run each one when its package is loaded: physics' \div is the divergence, but without
 * physics it's the ÷ sign. Like every adapter step, each rewrite keeps the line breaks of what it replaces.
 */

import { escapeRegExp, matcher, outside, replaceCommand, skipSpaces, type Matcher, type Parsed } from './packageShims';

const starred = (whole: string) => /^\\[A-Za-z]+\*/.test(whole);

/** Swap commands that take no arguments for their math, like \grad for a bold nabla. */
function renameCommands(source: string, names: Record<string, string>): string {
  const pattern = new RegExp(`\\\\(${Object.keys(names).map(escapeRegExp).join('|')})(?![A-Za-z@])`, 'g');
  // A space after the new text keeps it from running into a letter that follows, like \grad f.
  return source.replace(pattern, (_whole, name: string) => `${names[name]} `);
}

type Delimited = { open: string; body: string; close: string; end: number };

type Delimiters = { paren: (start: number) => number; bar: (from: number) => number };

/**
 * Where each ( closes, and the next unescaped | from any point, found in one pass like matcher(),
 * so many unclosed \qty( or \eval( can't make the rewrite quadratic. Both give -1 for none.
 */
function delimiters(source: string): Delimiters {
  let closes: Map<number, number> | null = null;
  let bars: Int32Array | null = null;
  const scan = () => {
    closes = new Map();
    const isBar = new Uint8Array(source.length);
    const parens: number[] = [];
    for (let i = 0; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '\\') i += 1;
      else if (ch === '(') parens.push(i);
      else if (ch === ')' && parens.length) closes.set(parens.pop()!, i);
      else if (ch === '|') isBar[i] = 1;
    }
    bars = new Int32Array(source.length + 1).fill(-1);
    for (let i = source.length - 1; i >= 0; i -= 1) bars[i] = isBar[i] ? i : bars[i + 1];
  };
  return {
    paren: (start) => {
      if (!closes) scan();
      return closes!.get(start) ?? -1;
    },
    bar: (from) => {
      if (!bars) scan();
      return bars![from] ?? -1;
    },
  };
}

/**
 * Read the argument physics takes in any brackets, like \qty(x), \qty[x], \qty{x} or \qty|x|,
 * from `i` (just past the name and any `*`). With `bar`, ( and [ close at a |, like \eval(x|.
 */
function readDelimited(source: string, i: number, matching: Matcher, found: Delimiters, bar = false): Delimited | null {
  const j = skipSpaces(source, i);
  const open = source[j];
  let close = -1;
  if (bar && (open === '(' || open === '[')) close = found.bar(j + 1);
  else if (open === '{' || open === '[') close = matching(j);
  else if (open === '(') close = found.paren(j);
  else if (open === '|') close = found.bar(j + 1);
  if (close === -1) return null;
  return { open, body: source.slice(j + 1, close), close: source[close], end: close + 1 };
}

/** Replace `\name` (and `\name*`) followed by a bracketed argument, see readDelimited. */
function replaceDelimited(
  source: string,
  names: string[],
  replace: (arg: Delimited, whole: string, star: boolean) => string,
  bar = false,
): string {
  const pattern = new RegExp(`\\\\(?:${names.map(escapeRegExp).join('|')})(?![A-Za-z@])(\\*?)`, 'g');
  const matching = matcher(source);
  const found = delimiters(source);
  let out = '';
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index < last) continue;
    const arg = readDelimited(source, match.index + match[0].length, matching, found, bar);
    if (!arg) continue;
    const whole = source.slice(match.index, arg.end);
    out += source.slice(last, match.index) + replace(arg, whole, match[1] === '*');
    last = arg.end;
  }
  return out + source.slice(last);
}

// KaTeX pairs for each bracket, \left( ... \right).
const LEFT: Record<string, string> = { '(': '(', '[': '[', '{': '\\{', '|': '|' };
const RIGHT: Record<string, string> = { ')': ')', ']': ']', '}': '\\}', '|': '|' };

const sized = (open: string, body: string, close: string, star: boolean) => (star ? `${open} ${body} ${close}` : `\\left${open} ${body} \\right${close}`);

// --- Derivatives (physics and derivative) ---------------------------------------------------------

/**
 * A derivative fraction: `d` is the derivative sign, `order` the [n] option, then the function
 * (if any) and the variables. \pdv{f}{x}{y} has two, as does derivative's \pdv{f}{x,y}.
 */
function derivative(d: string, order: string | undefined, f: string, variables: string[], star: boolean): string {
  const n = order?.trim();
  const total = n ?? (variables.length > 1 ? String(variables.length) : '');
  const power = (p: string) => (p && p !== '1' ? `^{${p}}` : '');
  const top = `${d}${power(total)}${f ? ` ${f}` : ''}`;
  const bottom = variables.map((v) => `${d} ${v.trim()}${power(variables.length === 1 ? (n ?? '') : '')}`).join(' \\, ');
  return star ? `${top} / ${bottom}` : `\\frac{${top}}{${bottom}}`;
}

/**
 * \dv{x}, \dv{f}{x} and \dv[n]{f}{x} as fractions, with `d` for the sign. physics' \pdv{f}{x}{y}
 * takes a third group; derivative's \pdv{f}{x,y} lists the variables in the second instead.
 */
function rewriteDerivatives(source: string, names: Record<string, [sign: string, groups: number]>, commas: boolean): string {
  let s = source;
  for (const [name, [d, maxGroups]] of Object.entries(names)) {
    s = replaceCommand(
      s,
      name,
      maxGroups,
      ({ optional, groups }: Parsed, whole) => {
        const [f, ...rest] = groups.length === 1 ? ['', groups[0]] : groups;
        const variables = commas ? rest.flatMap((v) => v.split(',')) : rest;
        return `${derivative(d, optional[0], f, variables, starred(whole))}${outside(whole, ...groups)}`;
      },
      1,
    );
  }
  return s;
}

// --- physics ------------------------------------------------------------------------------------

const PHYSICS_NAMES: Record<string, string> = {
  grad: '\\boldsymbol{\\nabla}',
  div: '\\boldsymbol{\\nabla}\\cdot',
  curl: '\\boldsymbol{\\nabla}\\times',
  laplacian: '\\nabla^2',
  vnabla: '\\boldsymbol{\\nabla}',
  vdot: '\\cdot',
  cross: '\\times',
  cp: '\\times',
  tr: '\\operatorname{tr}',
  Tr: '\\operatorname{Tr}',
  rank: '\\operatorname{rank}',
  erf: '\\operatorname{erf}',
  Res: '\\operatorname{Res}',
  pv: '\\mathcal{P}',
  PV: '\\operatorname{P.V.}',
  var: '\\delta',
  qc: ',\\quad',
  qcc: '\\quad\\text{c.c.}',
};

// \qand, \qif and so on: the word, with a quad either side.
const PHYSICS_WORDS = ['and', 'or', 'if', 'then', 'else', 'otherwise', 'unless', 'given', 'using', 'assume', 'since', 'let', 'for', 'all', 'even', 'odd', 'integer', 'as', 'in'];

// \mqty(...) and friends: the matrix environment for each bracket.
const MATRIX: Record<string, string> = { '(': 'pmatrix', '[': 'bmatrix', '|': 'vmatrix', '{': 'matrix' };

/** physics: derivatives, brackets, vectors, Dirac notation, matrices and operators, as KaTeX math. */
export function rewritePhysics(source: string, options: { qty?: boolean } = {}): string {
  let s = source;

  // Brackets. siunitx has a \qty of its own; when both are loaded, siunitx's goes first and wins.
  if (options.qty !== false) {
    s = replaceDelimited(s, ['qty', 'quantity'], ({ open, body, close }, whole, star) => `${sized(LEFT[open], body, RIGHT[close], star)}${outside(whole, body)}`);
  }
  const fixed: [string[], string, string][] = [
    [['pqty'], '(', ')'],
    [['bqty'], '[', ']'],
    [['Bqty'], '\\{', '\\}'],
    [['vqty'], '|', '|'],
    [['abs', 'absolutevalue'], '\\lvert', '\\rvert'],
    [['norm'], '\\lVert', '\\rVert'],
  ];
  for (const [names, open, close] of fixed) {
    s = replaceCommand(s, names, 1, ({ groups: [x] }, whole) => `${sized(open, x, close, starred(whole))}${outside(whole, x)}`);
  }
  s = replaceDelimited(s, ['order'], ({ body }, whole) => `\\mathcal{O}\\left( ${body} \\right)${outside(whole, body)}`);
  // \eval{x}_a^b and \eval(x|_a^b: the bar, with the limits that follow it.
  s = replaceDelimited(
    s,
    ['eval', 'evaluated'],
    ({ open, body }, whole) => `\\left${open === '{' ? '.' : open} ${body} \\right|${outside(whole, body)}`,
    true,
  );
  s = replaceCommand(s, ['comm', 'commutator'], 2, ({ groups: [a, b] }, whole) => `\\left[ ${a}, ${b} \\right]${outside(whole, a, b)}`);
  s = replaceCommand(s, ['acomm', 'anticommutator', 'pb', 'poissonbracket'], 2, ({ groups: [a, b] }, whole) => `\\left\\{ ${a}, ${b} \\right\\}${outside(whole, a, b)}`);

  // Vectors.
  s = replaceCommand(s, ['vb', 'vectorbold'], 1, ({ groups: [x] }, whole) => `${starred(whole) ? '\\boldsymbol' : '\\mathbf'}{${x}}${outside(whole, x)}`);
  s = replaceCommand(s, ['va', 'vectorarrow'], 1, ({ groups: [x] }, whole) => `\\vec{${starred(whole) ? `\\boldsymbol{${x}}` : `\\mathrm{${x}}`}}${outside(whole, x)}`);
  s = replaceCommand(s, ['vu', 'vectorunit'], 1, ({ groups: [x] }, whole) => `\\hat{${starred(whole) ? '\\boldsymbol' : '\\mathbf'}{${x}}}${outside(whole, x)}`);

  // Derivatives and differentials.
  const d: [string, number] = ['\\mathrm{d}', 2];
  const partial: [string, number] = ['\\partial', 3];
  const delta: [string, number] = ['\\delta', 2];
  s = rewriteDerivatives(s, { dv: d, derivative: d, pdv: partial, partialderivative: partial, fdv: delta, functionalderivative: delta }, false);
  s = replaceCommand(
    s,
    ['dd', 'differential'],
    1,
    ({ optional, groups }, whole) => `\\,\\mathrm{d}${optional[0] ? `^{${optional[0]}}` : ''}${groups[0] ?? ''}${outside(whole, ...groups)}`,
    0,
  );

  // Dirac notation.
  s = rewriteDirac(s);

  // Matrices, like \mqty(a & b \\ c & d) and \pmqty{a & b}.
  s = replaceDelimited(s, ['mqty', 'matrixquantity'], ({ open, body }, whole) => `\\begin{${MATRIX[open]}}${body}\\end{${MATRIX[open]}}${outside(whole, body)}`);
  const matrices: Record<string, string> = { pmqty: 'pmatrix', bmqty: 'bmatrix', vmqty: 'vmatrix', Pmqty: 'pmatrix', Bmqty: 'Bmatrix' };
  for (const [name, env] of Object.entries(matrices)) {
    s = replaceCommand(s, name, 1, ({ groups: [x] }, whole) => `\\begin{${env}}${x}\\end{${env}}${outside(whole, x)}`);
  }

  // Words between equations, like \qq{for all} or \qand.
  s = replaceCommand(s, 'qq', 1, ({ groups: [x] }, whole) => `\\quad\\text{${x}}\\quad ${outside(whole, x)}`);
  s = s.replace(new RegExp(`\\\\q(${PHYSICS_WORDS.join('|')})(?![A-Za-z@])\\*?`, 'g'), (_whole, word: string) => `\\quad\\text{${word}}\\quad `);

  return renameCommands(s, PHYSICS_NAMES);
}

/** physics' bra-ket commands. \braket{a} is ⟨a|a⟩ and \expval{A}{psi} is ⟨psi|A|psi⟩. */
function rewriteDirac(source: string): string {
  let s = source;
  s = replaceCommand(s, 'bra', 1, ({ groups: [x] }, whole) => `${sized('\\langle', x, '\\rvert', starred(whole))}${outside(whole, x)}`);
  s = replaceCommand(s, 'ket', 1, ({ groups: [x] }, whole) => `${sized('\\lvert', x, '\\rangle', starred(whole))}${outside(whole, x)}`);
  const angle = (parts: string[]) => `\\left\\langle ${parts.join(' \\middle\\vert ')} \\right\\rangle`;
  s = replaceCommand(s, ['braket', 'ip', 'innerproduct'], 2, ({ groups }, whole) => `${angle(groups.length === 1 ? [groups[0], groups[0]] : groups)}${outside(whole, ...groups)}`, 1);
  s = replaceCommand(s, ['expval', 'expectationvalue', 'ev'], 2, ({ groups: [a, psi] }, whole) => `${angle(psi === undefined ? [a] : [psi, a, psi])}${outside(whole, a, psi ?? '')}`, 1);
  s = replaceCommand(s, ['mel', 'matrixelement', 'matrixel'], 3, ({ groups }, whole) => `${angle(groups)}${outside(whole, ...groups)}`);
  s = replaceCommand(
    s,
    ['ketbra', 'outerproduct', 'dyad', 'op'],
    2,
    ({ groups: [a, b] }, whole) => `\\lvert ${a} \\rangle\\langle ${b ?? a} \\rvert${outside(whole, a, b ?? '')}`,
    1,
  );
  return s;
}

// --- derivative ---------------------------------------------------------------------------------

/** The derivative package: \odv, \pdv, \mdv and \fdv, with comma lists of variables. */
export function rewriteDerivativePackage(source: string): string {
  return rewriteDerivatives(source, { odv: ['\\mathrm{d}', 2], pdv: ['\\partial', 2], mdv: ['\\mathrm{D}', 2], fdv: ['\\delta', 2], adv: ['\\Delta', 2] }, true);
}

// --- braket -------------------------------------------------------------------------------------

/** The braket package: \bra, \ket, \braket{a|b} and \set{x | x > 0}. Capitalized ones grow with what's inside. */
export function rewriteBraketPackage(source: string): string {
  let s = source;
  const pairs: [string, string, string][] = [
    ['bra', '\\langle', '\\rvert'],
    ['ket', '\\lvert', '\\rangle'],
    ['braket', '\\langle', '\\rangle'],
    ['set', '\\{', '\\}'],
  ];
  for (const [name, open, close] of pairs) {
    s = replaceCommand(s, name, 1, ({ groups: [x] }, whole) => `${open} ${x} ${close}${outside(whole, x)}`);
    const big = name.charAt(0).toUpperCase() + name.slice(1);
    s = replaceCommand(s, big, 1, ({ groups: [x] }, whole) => `\\left${open} ${x} \\right${close}${outside(whole, x)}`);
  }
  return s;
}
