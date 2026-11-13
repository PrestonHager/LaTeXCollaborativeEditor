/**
 * A small BibTeX stand-in for the preview: read .bib files, then label, sort and format entries
 * the way the common .bst styles do. It runs in the compile worker. A real citation library
 * (citation-js, citeproc-js with CSL styles) costs far more bundle than these few styles need.
 */

export type BibEntry = { key: string; type: string; fields: Record<string, string> };

/** Read one {balanced} group starting at `from`, which must be a `{`. Returns the inside and the index after it. */
function readGroup(text: string, from: number): [string, number] {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '\\') i += 1;
    else if (text[i] === '{') depth += 1;
    else if (text[i] === '}' && --depth === 0) return [text.slice(from + 1, i), i + 1];
  }
  return [text.slice(from + 1), text.length];
}

/** Read a field value: {braced}, "quoted" or a bare word or @string name, joined with #. */
function readValue(body: string, from: number, strings: Map<string, string>): [string, number] {
  let value = '';
  let j = from;
  for (;;) {
    while (/\s/.test(body[j] ?? '')) j += 1;
    if (body[j] === '{') {
      const [inner, next] = readGroup(body, j);
      value += inner;
      j = next;
    } else if (body[j] === '"') {
      let depth = 0;
      let k = j + 1;
      for (; k < body.length && !(body[k] === '"' && depth === 0); k += 1) {
        if (body[k] === '{') depth += 1;
        else if (body[k] === '}') depth -= 1;
      }
      value += body.slice(j + 1, k);
      j = k + 1;
    } else {
      const word = /^[^\s,#}]*/.exec(body.slice(j))![0];
      value += strings.get(word.toLowerCase()) ?? word;
      j += word.length;
    }
    while (/\s/.test(body[j] ?? '')) j += 1;
    if (body[j] !== '#') return [value.replace(/\s+/g, ' ').trim(), j];
    j += 1;
  }
}

/** Read `name = value` pairs out of an entry body. */
function readFields(body: string, strings: Map<string, string>): Record<string, string> {
  const fields: Record<string, string> = {};
  const field = /([\w-]+)\s*=\s*/g;
  let f: RegExpExecArray | null;
  while ((f = field.exec(body))) {
    const [value, next] = readValue(body, field.lastIndex, strings);
    fields[f[1].toLowerCase()] = value;
    field.lastIndex = next;
  }
  return fields;
}

/**
 * Pull entries out of a .bib file, with @string macros and # joins. Field values keep their
 * braces, so {TeX} stays protected from case changes and the preview still reads it as LaTeX.
 */
export function parseBib(text: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const strings = new Map<string, string>();
  const start = /@(\w+)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = start.exec(text))) {
    const [body, next] = readGroup(text, start.lastIndex - 1);
    start.lastIndex = next;
    const type = match[1].toLowerCase();
    if (type === 'string') {
      for (const [name, value] of Object.entries(readFields(body, strings))) strings.set(name, value);
      continue;
    }
    if (type === 'comment' || type === 'preamble') continue;
    const comma = body.indexOf(',');
    const key = (comma < 0 ? body : body.slice(0, comma)).trim();
    if (key) entries.push({ key, type, fields: comma < 0 ? {} : readFields(body.slice(comma + 1), strings) });
  }
  return entries;
}

// ---- Names ----

type Name = { first: string; von: string; last: string; jr: string };
type NameList = { names: Name[]; others: boolean };

/** Split at a separator that sits outside braces. */
function splitTop(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') depth -= 1;
    else if (depth === 0) {
      const m = separator.exec(text.slice(i));
      if (m && m.index === 0) {
        parts.push(text.slice(from, i));
        i += m[0].length - 1;
        from = i + 1;
      }
    }
  }
  parts.push(text.slice(from));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** A von word starts with a lowercase letter, like "van" or "de". A {braced} word never does. */
function isLowerWord(word: string): boolean {
  if (word.startsWith('{') && !word.startsWith('{\\')) return false;
  const letter = /[A-Za-z]/.exec(word.replace(/\\[^A-Za-z]/g, ''));
  return !!letter && letter[0] === letter[0].toLowerCase();
}

/** Split a list of words into von and last, the way BibTeX does: the last word is always last. */
function vonLast(words: string[]): [string, string] {
  let end = -1;
  for (let i = 0; i < words.length - 1; i += 1) if (isLowerWord(words[i])) end = i;
  return [words.slice(0, end + 1).join(' '), words.slice(end + 1).join(' ')];
}

/** Parse one name in any of BibTeX's three forms: First von Last, von Last, First, or von Last, Jr, First. */
export function parseName(text: string): Name {
  const parts = splitTop(text, /^,/);
  if (parts.length >= 2) {
    const [von, last] = vonLast(splitTop(parts[0], /^[\s~]+/));
    return { von, last, jr: parts.length > 2 ? parts[1] : '', first: parts[parts.length - 1] };
  }
  const words = splitTop(text, /^[\s~]+/);
  const vonStart = words.findIndex((word, i) => i < words.length - 1 && isLowerWord(word));
  const firstWords = vonStart < 0 ? words.slice(0, -1) : words.slice(0, vonStart);
  const [von, last] = vonLast(words.slice(firstWords.length));
  return { first: firstWords.join(' '), von, last, jr: '' };
}

function parseNames(text: string | undefined): NameList {
  const names = text ? splitTop(text, /^\s+and\s+/i) : [];
  const others = names.length > 1 && names[names.length - 1].toLowerCase() === 'others';
  return { names: (others ? names.slice(0, -1) : names).map(parseName), others };
}

/** First names to initials, so "Donald Ervin" becomes "D.~E." and "Jean-Paul" becomes "J.-P.". */
export function initials(first: string, join = '~'): string {
  return splitTop(first, /^[\s~]+/)
    .map((word) =>
      word
        .split('-')
        .map((part) => {
          // A braced group like {\'E} counts as one letter.
          if (part.startsWith('{')) return `{${readGroup(part, 0)[0]}}.`;
          const accent = /^\\[^A-Za-z]\s*\{?[A-Za-z]\}?/.exec(part);
          return `${accent ? accent[0] : part.charAt(0)}.`;
        })
        .join('-'),
    )
    .join(join);
}

type NameForm = 'full' | 'abbr' | 'apa';

function formatName(name: Name, form: NameForm): string {
  const jr = name.jr ? `, ${name.jr}` : '';
  const vonLastText = [name.von, name.last].filter(Boolean).join(' ');
  if (form === 'apa') return `${vonLastText}${jr}${name.first ? `, ${initials(name.first, ' ')}` : ''}`;
  const first = form === 'abbr' && name.first ? initials(name.first) : name.first;
  return `${[first, vonLastText].filter(Boolean).join(' ')}${jr}`;
}

/** "A", "A and B", "A, B, and C", with "et~al." for a trailing "and others", like plain.bst. */
function formatNameList({ names, others }: NameList, form: NameForm): string {
  const formatted = names.map((name) => formatName(name, form));
  if (others) return `${formatted.join(', ')} et~al.`;
  if (formatted.length < 2) return formatted.join('');
  return `${formatted.slice(0, -1).join(', ')}${formatted.length > 2 ? ',' : ''} and ${formatted[formatted.length - 1]}`;
}

/** Names as they show in an author-year citation: "Knuth", "Knuth and Lamport", or "Knuth et~al.". */
function citeNames({ names, others }: NameList): string {
  const lasts = names.map((name) => [name.von, name.last].filter(Boolean).join(' '));
  if (others || lasts.length > 2) return `${lasts[0]} et~al.`;
  return lasts.join(' and ');
}

// ---- Text helpers ----

/** Like BibTeX's purify$: plain letters, digits and spaces, for labels and sort keys. */
export function purify(text: string): string {
  return text
    .replace(/\\(ae|AE|oe|OE|aa|AA|ss|o|O|l|L|i|j)(?![A-Za-z])/g, '$1')
    .replace(/\\[A-Za-z]+|\\./g, '')
    .replace(/[-~]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Like BibTeX's "t" case change: keep the first letter and anything in braces, and lowercase
 * the rest. Command names are left alone, so \LaTeX still works in the preview.
 */
export function sentenceCase(title: string): string {
  let out = '';
  let depth = 0;
  let keepNext = true;
  for (let i = 0; i < title.length; i += 1) {
    const ch = title[i];
    if (ch === '\\') {
      const word = /^\\(?:[A-Za-z]+|.)/.exec(title.slice(i))![0];
      out += word;
      i += word.length - 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (depth === 0 && /\p{L}/u.test(ch)) {
      out += keepNext ? ch : ch.toLowerCase();
      keepNext = false;
      continue;
    }
    out += ch;
    if (ch === ':' && /\s/.test(title[i + 1] ?? '')) keepNext = true;
  }
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

function monthName(month: string | undefined, short: boolean): string {
  if (!month) return '';
  const index = MONTHS.findIndex((name) => name.slice(0, 3).toLowerCase() === month.slice(0, 3).toLowerCase());
  const byNumber = /^\d{1,2}$/.test(month) ? Number(month) - 1 : -1;
  const found = index >= 0 ? index : byNumber;
  if (found < 0 || found > 11) return month;
  return short ? SHORT_MONTHS[found] : MONTHS[found];
}

/** Page ranges get an en dash, so 1-10 becomes 1--10. */
const dashPages = (pages: string) => pages.replace(/\s*-+\s*/g, '--');
const multiplePages = (pages: string) => /[-,+]/.test(pages);

// ---- Styles ----

export type BibStyle = {
  name: string;
  /** Sorted by author, year and title, or kept in the order they're first cited. */
  order: 'sorted' | 'cited';
  label: 'numeric' | 'alpha' | 'authoryear';
  names: NameForm;
  /** Which .bst family the entry layout follows. */
  layout: 'bibtex' | 'ieee' | 'apa';
};

const STYLES: Record<string, Omit<BibStyle, 'name'>> = {
  plain: { order: 'sorted', label: 'numeric', names: 'full', layout: 'bibtex' },
  unsrt: { order: 'cited', label: 'numeric', names: 'full', layout: 'bibtex' },
  abbrv: { order: 'sorted', label: 'numeric', names: 'abbr', layout: 'bibtex' },
  alpha: { order: 'sorted', label: 'alpha', names: 'full', layout: 'bibtex' },
  ieeetr: { order: 'cited', label: 'numeric', names: 'abbr', layout: 'ieee' },
  ieeetran: { order: 'cited', label: 'numeric', names: 'abbr', layout: 'ieee' },
  apalike: { order: 'sorted', label: 'authoryear', names: 'apa', layout: 'apa' },
  plainnat: { order: 'sorted', label: 'authoryear', names: 'full', layout: 'bibtex' },
  unsrtnat: { order: 'cited', label: 'authoryear', names: 'full', layout: 'bibtex' },
  abbrvnat: { order: 'sorted', label: 'authoryear', names: 'abbr', layout: 'bibtex' },
};

/** The \bibliographystyle names the preview knows, for the docs and the fallback message. */
export const SUPPORTED_STYLES = ['plain', 'unsrt', 'abbrv', 'alpha', 'ieeetr', 'IEEEtran', 'apalike', 'plainnat', 'unsrtnat', 'abbrvnat'];

/** Look up a \bibliographystyle name. Unknown names come back as null, so the caller can fall back to plain. */
export function resolveStyle(name: string): BibStyle | null {
  const style = STYLES[name.trim().toLowerCase()];
  return style ? { name: name.trim(), ...style } : null;
}

/** biblatex's style= option, mapped to the closest BibTeX style. */
export function biblatexStyle(options: string): BibStyle {
  const option = (key: string) => new RegExp(`(?:^|,)\\s*${key}\\s*=\\s*([\\w-]+)`).exec(options)?.[1] ?? '';
  const style = option('(?:bib)?style') || 'numeric';
  const base = style.startsWith('alphabetic') ? 'alpha' : style.startsWith('authoryear') || style === 'apa' ? 'apalike' : style.startsWith('ieee') ? 'ieeetr' : 'plain';
  const resolved = resolveStyle(base)!;
  return option('sorting') === 'none' ? { ...resolved, order: 'cited' } : resolved;
}

/** How a cited entry shows in the text and in the list. */
export type BibItem = { key: string; label: string; names: string; year: string; text: string };

/** Who an entry belongs to for sorting and labels: its authors, or else its editors. */
const people = (entry: BibEntry) => parseNames(entry.fields.author ?? entry.fields.editor);

function sortKey(entry: BibEntry): string {
  const { names } = people(entry);
  const who = names.length
    ? names.map((name) => purify([name.von, name.last, name.first, name.jr].filter(Boolean).join(' '))).join('   ')
    : purify(entry.fields.organization ?? entry.fields.key ?? entry.key);
  const title = purify(entry.fields.title ?? '').replace(/^(the|an|a) /i, '');
  return `${who}    ${purify(entry.fields.year ?? '')}    ${title}`.toLowerCase();
}

/** alpha.bst labels: Knu84 for one author, KL84 for two to four, ABC+84 for more. */
function alphaLabel(entry: BibEntry): string {
  const { names, others } = people(entry);
  const year = purify(entry.fields.year ?? '').slice(-2);
  if (!names.length) return `${purify(entry.fields.key ?? entry.key).slice(0, 3)}${year}`;
  const vonLastText = (name: Name) => purify(`${name.von} ${name.last}`);
  if (names.length === 1 && !others) return `${vonLastText(names[0]).replace(/ /g, '').slice(0, 3)}${year}`;
  const shown = names.length > 4 ? names.slice(0, 3) : names;
  const letters = shown.map((name) => vonLastText(name).split(' ').map((word) => word[0]).join(''));
  return `${letters.join('')}${names.length > 4 || others ? '+' : ''}${year}`;
}

/** Join non-empty pieces with ", ". */
const commas = (...pieces: (string | undefined | false)[]) => pieces.filter(Boolean).join(', ');
const emph = (text: string | undefined) => (text ? `\\emph{${text}}` : '');
/** End a block with a period, unless it already ends in . ? or !. */
const sentence = (text: string) => (!text ? '' : /[.?!]\}*$/.test(text) ? text : `${text}.`);

const BOOK_LIKE = new Set(['book', 'inbook', 'booklet', 'manual', 'phdthesis', 'proceedings']);

function editorsText(list: NameList, form: NameForm): string {
  if (!list.names.length) return '';
  return `${formatNameList(list, form)}, ${list.names.length > 1 || list.others ? 'editors' : 'editor'}`;
}

/** Lay an entry out the way plain.bst does, block by block. apalike moves the year up next to the authors. */
function bibtexText(entry: BibEntry, style: BibStyle, yearLabel: string): string {
  const f = entry.fields;
  const apa = style.layout === 'apa';
  const editors = parseNames(f.editor);
  const authors = parseNames(f.author);
  const short = style.names !== 'full';
  const date = apa ? '' : [monthName(f.month, short), f.year].filter(Boolean).join(' ');
  let who = authors.names.length ? formatNameList(authors, style.names) : editorsText(editors, style.names);
  if (!who && entry.type === 'manual') who = f.organization ?? '';
  if (apa) who = `${who} (${yearLabel})`.trim();
  const title = f.title ? (BOOK_LIKE.has(entry.type) ? emph(f.title) : sentenceCase(f.title)) : '';
  const series = f.volume && f.series ? `volume ${f.volume} of ${emph(f.series)}` : f.volume ? `volume ${f.volume}` : '';
  const pages = f.pages ? `${multiplePages(f.pages) ? 'pages' : 'page'} ${dashPages(f.pages)}` : '';
  const inEditors = authors.names.length ? editorsText(editors, style.names) : '';
  const edition = f.edition ? `${f.edition.toLowerCase()} edition` : '';
  let blocks: string[];
  switch (entry.type) {
    case 'article': {
      let volume = f.volume ?? '';
      if (f.number) volume += `(${f.number})`;
      if (f.pages) volume += volume ? `:${dashPages(f.pages)}` : pages;
      blocks = [who, title, commas(emph(f.journal), volume, date)];
      break;
    }
    case 'book':
    case 'booklet':
    case 'proceedings':
      blocks = [who, commas(title, series), commas(f.organization, f.publisher, f.address, edition, f.howpublished, date)];
      break;
    case 'inproceedings':
    case 'conference':
      blocks = [who, title, commas(`In ${commas(inEditors, emph(f.booktitle))}`, series, pages, f.address, date), commas(f.organization, f.publisher)];
      break;
    case 'incollection':
    case 'inbook':
      blocks = [
        who,
        title,
        commas(f.booktitle ? `In ${commas(inEditors, emph(f.booktitle))}` : '', series, f.chapter && `chapter ${f.chapter}`, pages),
        commas(f.publisher, f.address, edition, date),
      ];
      break;
    case 'phdthesis':
    case 'mastersthesis':
      blocks = [who, title, commas(f.type ?? (entry.type === 'phdthesis' ? 'PhD thesis' : "Master's thesis"), f.school, f.address, date)];
      break;
    case 'techreport':
      blocks = [who, title, commas(f.number ? `${f.type ?? 'Technical Report'} ${f.number}` : (f.type ?? 'Technical report'), f.institution, f.address, date)];
      break;
    case 'manual':
      blocks = [who, emph(f.title), commas(authors.names.length ? f.organization : '', f.address, edition, date)];
      break;
    default:
      blocks = [who, title, commas(f.howpublished, date)];
  }
  blocks.push(f.note ?? '');
  return blocks.filter(Boolean).map(sentence).join(' ');
}

/** Lay an entry out the way ieeetr.bst does: commas throughout, the title in quotes. */
function ieeeText(entry: BibEntry, style: BibStyle): string {
  const f = entry.fields;
  const authors = parseNames(f.author);
  const who = authors.names.length ? formatNameList(authors, style.names) : editorsText(parseNames(f.editor), style.names);
  const date = [monthName(f.month, true), f.year].filter(Boolean).join(' ');
  const pages = f.pages ? `${multiplePages(f.pages) ? 'pp.' : 'p.'}~${dashPages(f.pages)}` : '';
  const vol = f.volume && `vol.~${f.volume}`;
  const publisher = f.address && f.publisher ? `${f.address}: ${f.publisher}` : (f.publisher ?? f.address);
  let rest: string;
  let bookTitle = false;
  switch (entry.type) {
    case 'article':
      rest = commas(emph(f.journal), vol, f.number && `no.~${f.number}`, pages, date);
      break;
    case 'book':
    case 'booklet':
    case 'manual':
    case 'proceedings':
      bookTitle = true;
      rest = commas(publisher ?? f.organization, date);
      break;
    case 'inproceedings':
    case 'conference':
    case 'incollection':
    case 'inbook':
      rest = commas(f.booktitle && `in ${emph(f.booktitle)}`, vol, pages, entry.type === 'inproceedings' || entry.type === 'conference' ? f.address : publisher, date);
      break;
    case 'phdthesis':
      bookTitle = true;
      rest = commas(f.type ?? 'PhD thesis', f.school, f.address, date);
      break;
    case 'mastersthesis':
      rest = commas(f.type ?? "Master's thesis", f.school, f.address, date);
      break;
    case 'techreport':
      rest = commas(f.number ? `${f.type ?? 'Tech. Rep.'} ${f.number}` : (f.type ?? 'tech. rep.'), f.institution, f.address, date);
      break;
    default:
      rest = commas(f.howpublished, date);
  }
  rest = commas(rest, f.note);
  const head = who && f.title ? `${who}, ` : who;
  if (!f.title) return sentence(commas(who, rest));
  if (bookTitle) return `${head}${emph(f.title)}${rest ? `. ${sentence(rest)}` : '.'}`;
  // ieeetr puts the comma or period inside the closing quotes.
  return `${head}\`\`${sentenceCase(f.title)}${rest ? `,'' ${sentence(rest)}` : ".''"}`;
}

/**
 * Build the reference list in a style: sort, label and format each entry.
 * `entries` are the cited ones, in the order they were first cited.
 */
export function buildBibliography(entries: BibEntry[], style: BibStyle): BibItem[] {
  let ordered = entries;
  let alpha: string[] = [];
  if (style.label === 'alpha') alpha = entries.map(alphaLabel);
  if (style.order === 'sorted') {
    const keys = new Map(entries.map((entry, i) => [entry, `${alpha[i] ?? ''}    ${sortKey(entry)}`.toLowerCase()]));
    const labels = new Map(entries.map((entry, i) => [entry, alpha[i]]));
    ordered = [...entries].sort((a, b) => (keys.get(a)! < keys.get(b)! ? -1 : keys.get(a)! > keys.get(b)! ? 1 : 0));
    alpha = ordered.map((entry) => labels.get(entry)!);
  }
  // Duplicate labels get a, b, c (Knu84a, Knu84b), and so do author-year pairs (1984a).
  const base = ordered.map((entry, i) => {
    if (style.label === 'alpha') return alpha[i];
    if (style.label === 'authoryear') return `${citeNames(people(entry)) || entry.key}|${entry.fields.year ?? ''}`;
    return '';
  });
  const counts = new Map<string, number>();
  for (const label of base) counts.set(label, (counts.get(label) ?? 0) + 1);
  const seen = new Map<string, number>();
  return ordered.map((entry, i) => {
    let suffix = '';
    if (base[i] && counts.get(base[i])! > 1) {
      const n = seen.get(base[i]) ?? 0;
      seen.set(base[i], n + 1);
      suffix = String.fromCharCode(97 + n);
    }
    const names = citeNames(people(entry)) || entry.key;
    const year = `${entry.fields.year ?? ''}${style.label === 'authoryear' ? suffix : ''}`;
    const label = style.label === 'alpha' ? `${alpha[i]}${suffix}` : style.label === 'numeric' ? String(i + 1) : `${names}, ${year}`;
    const text = style.layout === 'ieee' ? ieeeText(entry, style) : bibtexText(entry, style, year);
    return { key: entry.key, label, names, year, text };
  });
}
