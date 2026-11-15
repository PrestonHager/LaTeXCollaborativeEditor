/**
 * Verbatim text and code listings for the preview. LaTeX.js has no verbatim, lstlisting or
 * minted, so before it runs we take each block out of the source and leave a token in its place
 * (`\texttt{lcverbN}`). Once LaTeX.js is done, insertVerbatimBlocks swaps every token for a
 * <pre> or <code> that holds the text exactly as written. The text only ever goes into text
 * nodes, never into markup.
 *
 * Every rewrite keeps the line breaks of what it replaces, so line N stays line N.
 */
import { findVerbatimEnvironments } from './latexJsAdapt';
import { dirname, joinPath, normalizePath } from '../project/paths';

export const VERBATIM_TOKEN_PREFIX = 'lcverb';
/** The counter listing captions number with. Its own name, so it can't clash with the document's. */
const LISTING_COUNTER = 'lclisting';
export const LISTING_CLASS = 'lc-listing';
export const LISTING_STYLE_ID = 'lc-listing-style';

export type VerbatimBlock = {
  inline: boolean;
  text: string;
  /** The language the source named, for a data-language attribute. */
  language: string | null;
  /** Number of the first line, or null for no line numbers. */
  firstNumber: number | null;
};

export type VerbatimSource = {
  /** Each file with its verbatim text swapped for tokens. */
  texts: Map<string, string>;
  /** What each token stands for: token N is blocks[N]. */
  blocks: VerbatimBlock[];
  /** Notes for the preview's list of changes. */
  changes: string[];
  /** Listing files \lstinputlisting or \inputminted asked for that aren't in the project. */
  missing: string[];
};

type Kind = 'verbatim' | 'fancyvrb' | 'listings' | 'minted' | 'comment' | 'alltt';
type EnvironmentKind = { kind: Kind; language?: string };
type Options = Map<string, string>;

const BUILT_IN: Record<string, EnvironmentKind> = {
  verbatim: { kind: 'verbatim' },
  'verbatim*': { kind: 'verbatim' },
  Verbatim: { kind: 'fancyvrb' },
  'Verbatim*': { kind: 'fancyvrb' },
  BVerbatim: { kind: 'fancyvrb' },
  'BVerbatim*': { kind: 'fancyvrb' },
  LVerbatim: { kind: 'fancyvrb' },
  'LVerbatim*': { kind: 'fancyvrb' },
  lstlisting: { kind: 'listings' },
  minted: { kind: 'minted' },
  comment: { kind: 'comment' },
  alltt: { kind: 'alltt' },
};

// Setup commands LaTeX.js doesn't know, with how many {groups} each takes. [options] are skipped too.
const SETUP_COMMANDS: Record<string, number> = {
  lstset: 1,
  lstdefinestyle: 2,
  lstdefinelanguage: 3,
  lstloadlanguages: 1,
  lstnewenvironment: 3,
  lstlistoflistings: 0,
  listoflistings: 0,
  setminted: 1,
  setmintedinline: 1,
  usemintedstyle: 1,
  newminted: 2,
  newmint: 2,
  newmintinline: 2,
  fvset: 1,
  DefineVerbatimEnvironment: 3,
  CustomVerbatimEnvironment: 3,
  RecustomVerbatimEnvironment: 3,
  newtcblisting: 2,
  renewtcblisting: 2,
  DeclareTCBListing: 3,
  NewTCBListing: 3,
};

// Quick check for anything this file handles, so most files skip the scan.
const VERBATIM_HINT =
  /\\(?:begin|verb|Verb|lst|mint|inputminted|newminted|setminted|usemintedstyle|fvset|DefineVerbatim|CustomVerbatim|RecustomVerbatim|newtcblisting|renewtcblisting|DeclareTCBListing|NewTCBListing|listoflistings|(?:re)?newenvironment)/;

const keepLineBreaks = (text: string) => text.replace(/[^\n]/g, '');

/** Where the group opened at `open` ({ or [) closes, counting nested braces. -1 if it doesn't. */
function groupEnd(source: string, open: number): number {
  const closer = source[open] === '[' ? ']' : '}';
  let depth = 0;
  for (let k = open; k < source.length; k += 1) {
    const ch = source[k];
    if (ch === '\\') {
      k += 1;
    } else if (ch === '{') {
      depth += 1;
      if (closer === '}' && depth === 0) return k;
    } else if (ch === '}') {
      depth -= 1;
      if (closer === '}' && depth === 0) return k;
    } else if (ch === ']' && closer === ']' && depth === 0) {
      return k;
    }
  }
  return -1;
}

/** Skip spaces and at most one line break: what TeX allows between a command and its argument. */
function skipSpace(source: string, i: number): number {
  let breaks = 0;
  while (i < source.length && /\s/.test(source[i])) {
    if (source[i] === '\n' && ++breaks > 1) break;
    i += 1;
  }
  return i;
}

/** Read an optional [group] or a required {group} at i (after spaces). */
function readGroup(source: string, i: number, open: '[' | '{'): { body: string; end: number } | null {
  const at = skipSpace(source, i);
  if (source[at] !== open) return null;
  const close = groupEnd(source, at);
  if (close === -1) return null;
  return { body: source.slice(at + 1, close), end: close + 1 };
}

/** Split `a=1, b={x, y}, c` at top-level commas, into keys and values without their outer braces. */
export function parseOptions(text: string): Options {
  const options: Options = new Map();
  let depth = 0;
  let start = 0;
  const add = (part: string) => {
    const eq = part.indexOf('=');
    const key = (eq === -1 ? part : part.slice(0, eq)).trim();
    if (!key) return;
    options.set(key, eq === -1 ? 'true' : unbrace(part.slice(eq + 1).trim()));
  };
  for (let k = 0; k < text.length; k += 1) {
    const ch = text[k];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      add(text.slice(start, k));
      start = k + 1;
    }
  }
  add(text.slice(start));
  return options;
}

function unbrace(value: string): string {
  return value.startsWith('{') && groupEnd(value, 0) === value.length - 1 ? value.slice(1, -1).trim() : value;
}

const positive = (value: string | undefined): number | null => {
  const n = value === undefined ? NaN : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Only letters, digits and a few signs, so a language name is safe as an attribute value. */
function cleanLanguage(value: string | undefined): string | null {
  if (!value) return null;
  const name = value.replace(/^\[[^\]]*]/, '').replace(/[^A-Za-z0-9+#._-]/g, '');
  return name ? name.toLowerCase() : null;
}

/** The kind of each verbatim-like environment in the project, including ones it defines itself. */
function environmentKinds(allText: string): Map<string, EnvironmentKind> {
  const kinds = new Map<string, EnvironmentKind>(Object.entries(BUILT_IN));
  const code = allText.replace(/(^|[^\\])((?:\\\\)*)%[^\n]*/g, '$1$2');
  for (const m of code.matchAll(/\\newminted\s*(?:\[([^\]]+)]\s*)?\{([^{}]+)\}/g)) {
    const language = m[2].trim();
    if (m[1]) kinds.set(m[1].trim(), { kind: 'minted', language });
    else for (const name of [`${language}code`, `${language}code*`]) kinds.set(name, { kind: 'minted', language });
  }
  for (const m of code.matchAll(/\\(?:lstnewenvironment|newtcblisting|renewtcblisting|DeclareTCBListing|NewTCBListing)\s*(?:\[[^\]]*]\s*)?\{([^{}]+)\}/g)) {
    if (!kinds.has(m[1].trim())) kinds.set(m[1].trim(), { kind: 'listings' });
  }
  for (const name of findVerbatimEnvironments(code)) if (!kinds.has(name)) kinds.set(name, { kind: 'fancyvrb' });
  return kinds;
}

/** Lines firstline to lastline, with `gobble` characters (or the common indent, for autogobble) taken off each. */
function shapeLines(text: string, options: Options): { lines: string[]; first: number } {
  let lines = text.split('\n');
  const first = positive(options.get('firstline')) ?? 1;
  const last = positive(options.get('lastline')) ?? lines.length;
  lines = lines.slice(first - 1, last);
  const gobble = positive(options.get('gobble'));
  if (gobble) lines = lines.map((line) => line.slice(gobble));
  if (options.get('autogobble') === 'true') {
    const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => /^[ \t]*/.exec(line)![0].length));
    if (Number.isFinite(indent) && indent > 0) lines = lines.map((line) => line.slice(indent));
  }
  return { lines, first };
}

/** Whether these options ask for line numbers, and the number of the first line. */
function lineNumbers(kind: Kind, options: Options, first: number): number | null {
  const on =
    kind === 'minted'
      ? options.get('linenos') === 'true'
      : ['left', 'right'].includes(options.get('numbers') ?? '');
  if (!on) return null;
  return positive(options.get('firstnumber')) ?? first;
}

/** alltt keeps \ { } as commands and shows everything else as typed. Say that in LaTeX.js's terms. */
function allttToLatex(body: string): string {
  const special: Record<string, string> = { $: '36', '&': '38', '#': '35', '^': '94', _: '95', '~': '126', '%': '37' };
  const lines = body.split('\n').map((line) => {
    let out = '';
    for (let k = 0; k < line.length; k += 1) {
      const ch = line[k];
      if (ch === '\\') {
        const name = /^\\(?:[A-Za-z@]+|.)?/.exec(line.slice(k))![0];
        out += name;
        k += name.length - 1;
      } else if (ch in special) out += `\\symbol{${special[ch]}}`;
      else if (ch === ' ') out += '~';
      else if (ch === '\t') out += '~'.repeat(8);
      else out += ch;
    }
    return out || '\\mbox{}';
  });
  return lines.join('\\\\\n');
}

type Context = {
  kinds: Map<string, EnvironmentKind>;
  defaults: { listings: Options; minted: Options };
  blocks: VerbatimBlock[];
  notes: Set<string>;
  missing: Set<string>;
  readFile: (name: string) => string | null;
  captions: number;
};

const NOTE_LISTING = 'Showed code listings as plain text, without syntax highlighting or style options.';
const NOTE_SETUP = 'Removed listings, minted and fancyvrb setup commands.';
const NOTE_ALLTT = 'Showed alltt as monospaced text.';

function token(ctx: Context, block: VerbatimBlock): string {
  ctx.blocks.push(block);
  return `\\texttt{${VERBATIM_TOKEN_PREFIX}${ctx.blocks.length - 1}}`;
}

/** The LaTeX for a listing caption: "Listing N: text", numbered so \label and \ref work. */
function captionLatex(ctx: Context, caption: string | undefined, label: string | undefined, title: string | undefined): string {
  const labelPart = label ? `\\label{${label.replace(/[{}\\]/g, '')}}` : '';
  if (caption !== undefined) {
    ctx.captions += 1;
    const text = caption.replace(/^\[[^\]]*]/, '');
    return `\\par\\noindent\\refstepcounter{${LISTING_COUNTER}}${labelPart}\\textbf{Listing \\the${LISTING_COUNTER}:} ${text}\\par`;
  }
  if (title !== undefined) return `\\par\\noindent${labelPart}${title}\\par`;
  return labelPart ? `\\par\\noindent${labelPart}` : '';
}

/** A display block: caption, then the token on a paragraph of its own. */
function blockLatex(ctx: Context, kind: Kind, body: string, options: Options, language: string | null): string {
  const { lines, first } = shapeLines(body, options);
  let text = lines.join('\n');
  if (options.get('showspaces') === 'true') text = text.replace(/ /g, '␣');
  const caption = kind === 'listings' ? captionLatex(ctx, options.get('caption'), options.get('label'), options.get('title')) : '';
  return `${caption}\\par${token(ctx, { inline: false, text, language, firstNumber: lineNumbers(kind, options, first) })}\\par `;
}

function withDefaults(kind: Kind, ctx: Context, options: Options): Options {
  const defaults = kind === 'listings' ? ctx.defaults.listings : kind === 'minted' ? ctx.defaults.minted : null;
  return defaults ? new Map([...defaults, ...options]) : options;
}

/** Read an inline argument: |text| with any delimiter, or {text} where braces are allowed. */
function inlineArgument(source: string, i: number, braces: boolean): { text: string; end: number } | null {
  const delimiter = source[i];
  if (delimiter === undefined || /[A-Za-z\s*]/.test(delimiter)) return null;
  if (delimiter === '{' && braces) {
    const close = groupEnd(source, i);
    if (close === -1 || source.slice(i, close).includes('\n')) return null;
    return { text: source.slice(i + 1, close), end: close + 1 };
  }
  const close = source.indexOf(delimiter, i + 1);
  const lineEnd = source.indexOf('\n', i + 1);
  const end = close === -1 || (lineEnd !== -1 && lineEnd < close) ? null : close;
  if (end === null) return null;
  return { text: source.slice(i + 1, end), end: end + 1 };
}

/** Replace verbatim-like text in one file. */
function rewriteFile(source: string, ctx: Context): string {
  let out = '';
  let i = 0;
  let listingFloats = 0;
  const at = (pattern: RegExp) => {
    pattern.lastIndex = i;
    return pattern.exec(source);
  };

  while (i < source.length) {
    const ch = source[i];
    if (ch === '%') {
      const lineEnd = source.indexOf('\n', i);
      const end = lineEnd === -1 ? source.length : lineEnd;
      out += source.slice(i, end);
      i = end;
      continue;
    }
    if (ch !== '\\') {
      out += ch;
      i += 1;
      continue;
    }

    // \begin{name} of a verbatim-like environment: take everything up to its \end{name}.
    const begin = at(/\\begin\s*\{([^{}]*)\}/y);
    const environment = begin ? ctx.kinds.get(begin[1].trim()) : undefined;
    if (begin && environment) {
      const name = begin[1].trim();
      const endTag = `\\end{${name}}`;
      let j = i + begin[0].length;
      let options: Options = new Map();
      let language = environment.language ?? null;
      if (environment.kind !== 'verbatim' && environment.kind !== 'comment' && environment.kind !== 'alltt') {
        const opt = /^[ \t]*\[/.test(source.slice(j)) ? readGroup(source, j, '[') : null;
        if (opt) {
          options = parseOptions(opt.body);
          j = opt.end;
        }
        if (name === 'minted') {
          const lang = readGroup(source, j, '{');
          if (lang) {
            language = lang.body.trim();
            j = lang.end;
          }
        } else if (environment.kind === 'minted' && name.endsWith('*')) {
          // \newminted's starred environment takes its options in braces.
          const opt2 = readGroup(source, j, '{');
          if (opt2) {
            options = parseOptions(opt2.body);
            j = opt2.end;
          }
        }
      }
      const close = source.indexOf(endTag, j);
      if (close === -1) {
        // No \end: leave it, so LaTeX.js reports the problem.
        out += source.slice(i, j);
        i = j;
        continue;
      }
      let body = source.slice(j, close);
      // The rest of the \begin line is dropped when blank, and always for listings, as LaTeX does.
      const firstBreak = body.indexOf('\n');
      if (firstBreak !== -1 && (!body.slice(0, firstBreak).trim() || environment.kind === 'listings' || environment.kind === 'minted')) {
        body = body.slice(firstBreak + 1);
      } else if (firstBreak === -1 && !body.trim()) {
        body = '';
      }
      // Spaces before \end on its own line aren't part of the text.
      body = body.replace(/\n[ \t]*$/, '');
      const whole = source.slice(i, close + endTag.length);
      out += replacement(ctx, environment.kind, name, body, withDefaults(environment.kind, ctx, options), language);
      out += keepLineBreaks(whole);
      i = close + endTag.length;
      continue;
    }

    // minted's `listing` float: LaTeX.js has none, so show it in place, with a numbered caption.
    const float = at(/\\(begin|end)\s*\{listing\}/y);
    if (float) {
      let j = i + float[0].length;
      if (float[1] === 'begin') {
        listingFloats += 1;
        const placement = /^[ \t]*\[/.test(source.slice(j)) ? readGroup(source, j, '[') : null;
        if (placement) j = placement.end;
      } else {
        listingFloats = Math.max(0, listingFloats - 1);
      }
      out += `\\par ${keepLineBreaks(source.slice(i, j))}`;
      i = j;
      continue;
    }
    const caption = listingFloats ? at(/\\caption\s*(?=[[{])/y) : null;
    if (caption) {
      let j = i + caption[0].length;
      const short = readGroup(source, j, '[');
      if (short) j = short.end;
      const text = readGroup(source, j, '{');
      if (text) {
        out += captionLatex(ctx, text.body, undefined, undefined) + keepLineBreaks(source.slice(i, text.end));
        i = text.end;
        continue;
      }
    }

    // Inline: \verb|x|, \verb*|x|, \Verb[opts]|x|, \lstinline[opts]|x| or {x}, \mintinline[opts]{lang}|x| or {x}.
    const inline = at(/\\(verb|Verb|lstinline|mintinline)(?![A-Za-z@])(\*?)/y);
    if (inline) {
      let j = i + inline[0].length;
      const command = inline[1];
      let language: string | null = null;
      let options: Options = new Map();
      if (command !== 'verb') {
        const opt = source[j] === '[' ? readGroup(source, j, '[') : null;
        if (opt) {
          options = parseOptions(opt.body);
          j = opt.end;
        }
      }
      if (command === 'mintinline') {
        const lang = readGroup(source, j, '{');
        if (lang) {
          language = lang.body.trim();
          j = lang.end;
        }
      }
      if (command === 'lstinline') language = options.get('language') ?? ctx.defaults.listings.get('language') ?? null;
      const arg = inlineArgument(source, j, command === 'lstinline' || command === 'mintinline');
      if (arg) {
        if (command === 'lstinline' || command === 'mintinline') ctx.notes.add(NOTE_LISTING);
        const text = inline[2] || options.get('showspaces') === 'true' ? arg.text.replace(/ /g, '␣') : arg.text;
        out += token(ctx, { inline: true, text, language: cleanLanguage(language ?? undefined), firstNumber: null });
        i = arg.end;
        continue;
      }
    }

    // \lstinputlisting[opts]{file} and \inputminted[opts]{lang}{file}: a listing read from the project.
    const input = at(/\\(lstinputlisting|inputminted)(?![A-Za-z@])/y);
    if (input) {
      let j = i + input[0].length;
      const opt = readGroup(source, j, '[');
      if (opt) j = opt.end;
      const kind: Kind = input[1] === 'inputminted' ? 'minted' : 'listings';
      const options = withDefaults(kind, ctx, opt ? parseOptions(opt.body) : new Map());
      const lang = kind === 'minted' ? readGroup(source, j, '{') : null;
      if (lang) j = lang.end;
      const file = readGroup(source, j, '{');
      if (file && (kind === 'listings' || lang)) {
        const name = file.body.trim();
        const text = ctx.readFile(name);
        const whole = source.slice(i, file.end);
        ctx.notes.add(NOTE_LISTING);
        if (text === null) {
          ctx.missing.add(name);
          const shown = name.replace(/[\\{}$&#^_%~]/g, '');
          out += `\\par\\noindent\\textit{Listing file \\texttt{${shown}} isn't in the project.}\\par${keepLineBreaks(whole)}`;
        } else {
          const language = cleanLanguage(lang ? lang.body.trim() : options.get('language'));
          out += blockLatex(ctx, kind, text.replace(/\r\n?/g, '\n').replace(/\n$/, ''), options, language) + keepLineBreaks(whole);
        }
        i = file.end;
        continue;
      }
    }

    // Setup commands LaTeX.js would stop at.
    const setup = at(/\\([A-Za-z]+)/y);
    const groups = setup ? SETUP_COMMANDS[setup[1]] : undefined;
    const wrapper = setup && /^(?:re)?newenvironment$/.test(setup[1]) ? readGroup(source, i + setup[0].length, '{') : null;
    if (setup && (groups !== undefined || (wrapper && ctx.kinds.has(wrapper.body.trim()) && !(wrapper.body.trim() in BUILT_IN)))) {
      let j = i + setup[0].length;
      let left = groups ?? 3;
      while (left > 0) {
        const next = skipSpace(source, j);
        if (source[next] !== '[' && source[next] !== '{') break;
        const close = groupEnd(source, next);
        if (close === -1) break;
        if (source[next] === '{') left -= 1;
        j = close + 1;
      }
      ctx.notes.add(NOTE_SETUP);
      out += keepLineBreaks(source.slice(i, j));
      i = j;
      continue;
    }

    // Anything else: copy the backslash and the next character, so \% isn't read as a comment.
    out += source.slice(i, i + 2);
    i += 2;
  }
  return out;
}

function replacement(ctx: Context, kind: Kind, name: string, body: string, options: Options, language: string | null): string {
  if (kind === 'comment') return '';
  if (kind === 'alltt') {
    ctx.notes.add(NOTE_ALLTT);
    return `\\par\\noindent{\\ttfamily ${allttToLatex(body).replace(/\n/g, '')}}\\par `;
  }
  if (kind === 'listings' || kind === 'minted') ctx.notes.add(NOTE_LISTING);
  const options2 = name.endsWith('*') && (kind === 'verbatim' || kind === 'fancyvrb') ? new Map([...options, ['showspaces', 'true']]) : options;
  return blockLatex(ctx, kind, body, options2, cleanLanguage(language ?? options.get('language')));
}

/** Read every \lstset and \setminted, so their options (numbers, language and so on) apply to every listing. */
function globalOptions(allText: string, command: string): Options {
  const options: Options = new Map();
  const pattern = new RegExp(`\\\\${command}\\s*(?:\\[[^\\]]*]\\s*)?\\{`, 'g');
  for (const m of allText.matchAll(pattern)) {
    const open = m.index + m[0].length - 1;
    const close = groupEnd(allText, open);
    if (close !== -1) for (const [key, value] of parseOptions(allText.slice(open + 1, close))) options.set(key, value);
  }
  return options;
}

/**
 * Swap the verbatim text in every project file for tokens. `mainPath` is where listing files
 * are looked up from, as LaTeX does.
 */
export function extractVerbatim(mainPath: string, texts: Map<string, string>): VerbatimSource {
  const allText = [...texts.values()].join('\n');
  if (!VERBATIM_HINT.test(allText)) {
    return { texts, blocks: [], changes: [], missing: [] };
  }
  const root = dirname(mainPath);
  const ctx: Context = {
    kinds: environmentKinds(allText),
    defaults: { listings: globalOptions(allText, 'lstset'), minted: globalOptions(allText, 'setminted') },
    blocks: [],
    notes: new Set(),
    missing: new Set(),
    captions: 0,
    readFile: (name) => {
      for (const candidate of [joinPath(root, name), name]) {
        const path = normalizePath(candidate);
        const text = path === null ? undefined : texts.get(path);
        if (text !== undefined) return text;
      }
      return null;
    },
  };
  const out = new Map<string, string>();
  // .bib files and files with nothing verbatim-like stay as they are.
  for (const [path, text] of texts) out.set(path, path.endsWith('.bib') || !VERBATIM_HINT.test(text) ? text : rewriteFile(text, ctx));

  // Listing captions count on a counter of our own. Make it once, as the document starts.
  if (ctx.captions) {
    const start = /\\begin\s*\{document\}/;
    const owner = [mainPath, ...out.keys()].find((path) => start.test(out.get(path) ?? ''));
    if (owner) out.set(owner, out.get(owner)!.replace(start, (m) => `${m}\\newcounter{${LISTING_COUNTER}}`));
  }
  const order = [NOTE_LISTING, NOTE_ALLTT, NOTE_SETUP];
  return { texts: out, blocks: ctx.blocks, changes: order.filter((note) => ctx.notes.has(note)), missing: [...ctx.missing] };
}

/** How listings look. Gray at partial opacity, so it reads on both the light and the dark theme. */
export const LISTING_CSS =
  `.${LISTING_CLASS}{margin:.75em 0;padding:.5em .75em;overflow-x:auto;white-space:pre;tab-size:8;-moz-tab-size:8;` +
  'line-height:1.35;font-size:.9em;border:1px solid rgba(128,128,128,.4);border-radius:4px;background:rgba(128,128,128,.08);}' +
  `.${LISTING_CLASS} code{font:inherit;white-space:inherit;}` +
  `.lc-ln::before{content:attr(data-n);display:inline-block;min-width:2em;margin-right:.75em;text-align:right;opacity:.55;` +
  '-webkit-user-select:none;user-select:none;}' +
  '.lc-verb{white-space:pre-wrap;tab-size:8;-moz-tab-size:8;}';

/** Every text node under `node`, in order. Works on the browser DOM and the worker's small one. */
function textNodes(node: Node, found: Text[] = []): Text[] {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) found.push(child as Text);
    else if (child.nodeType === 1) textNodes(child, found);
  }
  return found;
}

function buildBlock(doc: Document, block: VerbatimBlock): HTMLElement {
  const pre = doc.createElement('pre');
  pre.setAttribute('class', `${LISTING_CLASS} tt`);
  if (block.language) pre.setAttribute('data-language', block.language);
  const code = doc.createElement('code');
  if (block.firstNumber === null) {
    code.appendChild(doc.createTextNode(block.text));
  } else {
    block.text.split('\n').forEach((line, index, lines) => {
      const number = doc.createElement('span');
      number.setAttribute('class', 'lc-ln');
      number.setAttribute('data-n', String(block.firstNumber! + index));
      code.appendChild(number);
      code.appendChild(doc.createTextNode(index < lines.length - 1 ? `${line}\n` : line));
    });
  }
  pre.appendChild(code);
  return pre;
}

function buildInline(doc: Document, block: VerbatimBlock): HTMLElement {
  const code = doc.createElement('code');
  code.setAttribute('class', 'lc-verb tt');
  if (block.language) code.setAttribute('data-language', block.language);
  code.appendChild(doc.createTextNode(block.text));
  return code;
}

/** Put each block back where its token ended up in the LaTeX.js output, and add the listing style. */
export function insertVerbatimBlocks(doc: Document, blocks: VerbatimBlock[]): void {
  if (!blocks.length) return;
  const pattern = new RegExp(`${VERBATIM_TOKEN_PREFIX}(\\d+)`, 'g');
  for (const node of textNodes(doc.body)) {
    const data = node.data;
    if (!data.includes(VERBATIM_TOKEN_PREFIX)) continue;
    const parts: (Node | string)[] = [];
    let last = 0;
    let blockTarget: { block: VerbatimBlock } | null = null;
    for (const m of data.matchAll(pattern)) {
      const block = blocks[Number(m[1])];
      if (!block) continue;
      if (m.index > last) parts.push(data.slice(last, m.index));
      if (!block.inline && data === m[0]) blockTarget = { block };
      parts.push(block.inline ? buildInline(doc, block) : buildBlock(doc, block));
      last = m.index + m[0].length;
    }
    if (!parts.length) continue;
    if (last < data.length) parts.push(data.slice(last));

    // A block that sits alone in its \texttt and paragraph takes the paragraph's place.
    const span = node.parentNode as Element | null;
    const paragraph = span?.parentNode as Element | null;
    if (blockTarget && span && span.nodeName.toLowerCase() === 'span' && span.textContent === data) {
      const alone = paragraph && paragraph.nodeName.toLowerCase() === 'p' && paragraph.textContent === data;
      const target = alone ? paragraph : span;
      // Keep any \label anchor that shares the paragraph.
      const anchors = alone ? Array.from(paragraph.childNodes).filter((child) => child !== span) : [];
      target.replaceWith(...(anchors as Node[]), parts[0]);
      continue;
    }
    // Inline code takes the place of its \texttt span, so it doesn't pick up the span's font twice.
    if (span && span.nodeName.toLowerCase() === 'span' && span.childNodes.length === 1) span.replaceWith(...parts);
    else node.replaceWith(...parts);
  }

  const style = doc.createElement('style');
  style.setAttribute('id', LISTING_STYLE_ID);
  style.appendChild(doc.createTextNode(LISTING_CSS));
  (doc.head ?? doc.documentElement).appendChild(style);
}
