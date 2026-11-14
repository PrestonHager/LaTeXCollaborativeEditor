import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete';
import { dirname, extension } from '../project/paths';
import type { CompletionProject } from './completionProject';

/**
 * Completion from the whole project (issue #193): labels for \ref, .bib keys for \cite, and
 * paths for \input and friends. Part of the lazy completion chunk. The index is only built when
 * a completion asks for it, and only again after the project changed (a local or a peer's edit).
 * Everything stays in the browser.
 */

export type ProjectGetter = () => CompletionProject | null;

export interface LabelEntry { key: string; path: string; line: number }
export interface BibEntry { key: string; type: string; title?: string; author?: string; year?: string; path: string }

/** Cuts each line at its comment, keeping `\%`. Line breaks stay, so line numbers still match. */
export function stripComments(text: string): string {
  return text.replace(/(^|[^\\])((?:\\\\)*)%.*$/gm, '$1$2');
}

/** Every `\label{key}` in a .tex file, with its line. Commented-out labels are left out. */
export function extractLabels(text: string, path: string): LabelEntry[] {
  const labels: LabelEntry[] = [];
  stripComments(text).split('\n').forEach((line, index) => {
    for (const match of line.matchAll(/\\label\s*\{([^{}]*)\}/g)) {
      const key = match[1].trim();
      if (key) labels.push({ key, path, line: index + 1 });
    }
  });
  return labels;
}

/** Reads a braced or quoted value from `start` (at the `{` or `"`). Returns it and where it ends. */
function readDelimited(text: string, start: number): { value: string; end: number } {
  const open = text[start];
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (open === '{' && depth === 0) return { value: text.slice(start + 1, i), end: i + 1 };
    } else if (ch === '"' && open === '"' && depth === 0 && i > start) {
      return { value: text.slice(start + 1, i), end: i + 1 };
    }
  }
  return { value: text.slice(start + 1), end: text.length };
}

// Logos keep their name when a value is cleaned up, so "The {\TeX}book" shows as "The TeXbook".
const TEX_LOGOS = new Set(['TeX', 'LaTeX', 'LaTeXe', 'BibTeX', 'XeTeX', 'LuaTeX', 'ConTeXt', 'AmS']);

/** Drops the braces and spacing BibTeX uses for case and grouping, for showing a value. */
export function cleanBibValue(value: string): string {
  return value.replace(/\\[`'^"~=.]/g, '')
    .replace(/\\([a-zA-Z]+)\s*|\\(.)/g, (_whole, name: string | undefined, symbol: string | undefined) =>
      (name ? (TEX_LOGOS.has(name) ? name : '') : (symbol ?? '')))
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Reads the fields of one entry, from just after the key up to the entry's closing brace. */
function readFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const field = /\s*,?\s*([a-zA-Z][\w-]*)\s*=\s*/y;
  let pos = 0;
  while (pos < body.length) {
    field.lastIndex = pos;
    const match = field.exec(body);
    if (!match) break;
    pos = field.lastIndex;
    const name = match[1].toLowerCase();
    let value = '';
    // A value is braced, quoted or bare (a number or @string name), and can be joined with #.
    for (;;) {
      if (body[pos] === '{' || body[pos] === '"') {
        const read = readDelimited(body, pos);
        value += read.value;
        pos = read.end;
      } else {
        const bare = /[^,#}\s]*/y;
        bare.lastIndex = pos;
        value += bare.exec(body)?.[0] ?? '';
        pos = bare.lastIndex;
      }
      const join = /\s*#\s*/y;
      join.lastIndex = pos;
      if (!join.exec(body)) break;
      pos = join.lastIndex;
    }
    fields[name] = cleanBibValue(value);
  }
  return fields;
}

/** Every entry in a .bib file, with its key, type, and title, author and year when it has them. */
export function extractBibEntries(text: string, path: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const start = /@([a-zA-Z]+)\s*([{(])\s*([^,\s{}()]+)\s*,/g;
  let match: RegExpExecArray | null;
  while ((match = start.exec(text))) {
    const type = match[1].toLowerCase();
    if (type === 'string' || type === 'comment' || type === 'preamble') continue;
    // The body runs to the matching close, so the next search starts after it.
    const open = match.index + match[0].indexOf(match[2]);
    const close = match[2] === '(' ? ')' : '}';
    let depth = 0;
    let end = text.length;
    for (let i = open; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\\') { i++; continue; }
      if (ch === '{' || (close === ')' && ch === '(')) depth++;
      else if (ch === '}' || (close === ')' && ch === ')')) {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    const fields = readFields(text.slice(start.lastIndex, end));
    const year = fields.year || /^\d{4}/.exec(fields.date ?? '')?.[0];
    entries.push({ key: match[3], type, path, title: fields.title || undefined, author: fields.author || undefined, year: year || undefined });
    start.lastIndex = Math.max(start.lastIndex, end);
  }
  return entries;
}

/** "Knuth", "Knuth and Lamport" or "Knuth et al.", from a BibTeX author list. */
export function shortAuthors(author: string): string {
  const names = author.split(/\s+and\s+/i).map((name) => name.trim()).filter(Boolean);
  const last = (name: string) => (name.includes(',') ? name.split(',')[0] : name.split(' ').pop() ?? name).trim();
  if (names.length === 0) return '';
  if (names.length === 1) return last(names[0]);
  if (names.length === 2) return `${last(names[0])} and ${last(names[1])}`;
  return `${last(names[0])} et al.`;
}

/** `path` relative to the folder `from`, with `../` where it has to climb out. */
export function relativePath(path: string, from: string): string {
  if (!from) return path;
  const target = path.split('/');
  const base = from.split('/');
  let same = 0;
  while (same < base.length && same < target.length - 1 && base[same] === target[same]) same++;
  return [...base.slice(same).map(() => '..'), ...target.slice(same)].join('/');
}

type FileCache<T> = Map<string, { text: string; items: T[] }>;

/**
 * Labels and .bib entries of a project, rebuilt when its version changes. A file whose text is
 * the same as last time keeps what was read from it.
 */
export class ProjectIndex {
  private version = -1;
  private labelCache: FileCache<LabelEntry> = new Map();
  private bibCache: FileCache<BibEntry> = new Map();
  private labelList: LabelEntry[] = [];
  private bibList: BibEntry[] = [];

  private readonly project: CompletionProject;

  constructor(project: CompletionProject) {
    this.project = project;
  }

  labels(): readonly LabelEntry[] {
    this.refresh();
    return this.labelList;
  }

  bibEntries(): readonly BibEntry[] {
    this.refresh();
    return this.bibList;
  }

  private refresh() {
    const version = this.project.version();
    if (version === this.version) return;
    this.version = version;
    const files = this.project.files().filter((file) => file.kind === 'text');
    this.labelList = update(this.labelCache, files.filter((file) => extension(file.path) === 'tex'), extractLabels);
    this.bibList = update(this.bibCache, files.filter((file) => extension(file.path) === 'bib'), extractBibEntries);
  }
}

function update<T>(cache: FileCache<T>, files: readonly { path: string; text(): string }[], read: (text: string, path: string) => T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const file of files) {
    seen.add(file.path);
    const text = file.text();
    let entry = cache.get(file.path);
    if (!entry || entry.text !== text) {
      entry = { text, items: read(text, file.path) };
      cache.set(file.path, entry);
    }
    out.push(...entry.items);
  }
  for (const path of [...cache.keys()]) if (!seen.has(path)) cache.delete(path);
  return out;
}

const indexes = new WeakMap<CompletionProject, ProjectIndex>();

/** The index for a project, made the first time a completion needs it. */
export function projectIndex(project: CompletionProject): ProjectIndex {
  let index = indexes.get(project);
  if (!index) {
    index = new ProjectIndex(project);
    indexes.set(project, index);
  }
  return index;
}

/** Whether the text before the cursor on a line is in a comment (as in latexCompletion.ts). */
function inComment(lineBefore: string): boolean {
  return /(?:^|[^\\])(?:\\\\)*%/.test(lineBefore);
}

/**
 * Matches a command and its open argument before the cursor, like `\cref{fig:a,sec:` and gives
 * where the key being typed starts (after the `{` or the last comma).
 */
function argumentBefore(context: CompletionContext, command: RegExp): { name: string; from: number } | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);
  const match = new RegExp(`\\\\(${command.source})\\*?(?:\\[[^\\]]*\\]){0,2}\\{([^{}]*)$`).exec(before);
  if (!match) return null;
  const lead = before.slice(0, match.index);
  if (/\\$/.test(lead.replace(/\\\\/g, '')) || inComment(lead)) return null;
  const arg = match[2];
  const keyStart = arg.lastIndexOf(',') + 1;
  const key = arg.slice(keyStart);
  const skip = key.length - key.trimStart().length;
  return { name: match[1], from: context.pos - arg.length + keyStart + skip };
}

const REF_COMMANDS = /[cC]ref|[cC]pageref|labelcref|ref|eqref|autoref|pageref|vref|nameref|autopageref/;
const CITE_COMMANDS = /[a-zA-Z]*[cC]ite[a-zA-Z]*/;
const PATH_COMMANDS = /input|include|includegraphics|bibliography|addbibresource|subfile/;

const GRAPHIC_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'eps']);

/** Completes label keys after `\ref{`, `\eqref{`, `\autoref{`, `\cref{` and the like. */
export function labelSource(getProject: ProjectGetter): CompletionSource {
  return (context): CompletionResult | null => {
    const project = getProject();
    const arg = project && argumentBefore(context, REF_COMMANDS);
    if (!project || !arg) return null;
    const seen = new Set<string>();
    const options: Completion[] = [];
    for (const label of projectIndex(project).labels()) {
      if (seen.has(label.key)) continue;
      seen.add(label.key);
      options.push({ label: label.key, detail: `${label.path}:${label.line}`, type: 'variable' });
    }
    return { from: arg.from, options, validFor: /^[^,{}\s]*$/ };
  };
}

/** Completes .bib keys after `\cite{` and its natbib and biblatex forms, showing title and author. */
export function citationSource(getProject: ProjectGetter): CompletionSource {
  return (context): CompletionResult | null => {
    const project = getProject();
    const arg = project && argumentBefore(context, CITE_COMMANDS);
    if (!project || !arg) return null;
    const seen = new Set<string>();
    const options: Completion[] = [];
    for (const entry of projectIndex(project).bibEntries()) {
      if (seen.has(entry.key)) continue;
      seen.add(entry.key);
      const who = entry.author ? shortAuthors(entry.author) : '';
      const detail = [who, entry.year].filter(Boolean).join(', ');
      const info = [entry.title, entry.author, entry.year && `${entry.type}, ${entry.year}`].filter(Boolean).join('\n');
      options.push({ label: entry.key, detail: detail || entry.type, info: info || entry.path, type: 'text' });
    }
    return { from: arg.from, options, validFor: /^[^,{}\s]*$/ };
  };
}

/**
 * The paths a command can take, relative to the main file's folder: .tex files (without `.tex`
 * for \include, which adds it) for \input and \include, images for \includegraphics, and .bib
 * files (without `.bib` for \bibliography) for the bibliography.
 */
function pathOptions(project: CompletionProject, command: string): Completion[] {
  const mainPath = project.mainPath();
  const root = mainPath ? dirname(mainPath) : '';
  const options: Completion[] = [];
  for (const file of project.files()) {
    if (file.kind === 'folder' || file.path === mainPath) continue;
    const ext = extension(file.path);
    let path = relativePath(file.path, root);
    if (command === 'includegraphics') {
      if (!GRAPHIC_EXTENSIONS.has(ext)) continue;
    } else if (command === 'bibliography' || command === 'addbibresource') {
      if (ext !== 'bib') continue;
      if (command === 'bibliography') path = path.slice(0, -'.bib'.length);
    } else {
      if (ext !== 'tex') continue;
      if (command === 'include') path = path.slice(0, -'.tex'.length);
    }
    options.push({ label: path, type: 'namespace' });
  }
  return options;
}

/** Completes paths from the project tree after `\input{`, `\include{`, `\includegraphics{` and `\bibliography{`. */
export function pathSource(getProject: ProjectGetter): CompletionSource {
  return (context): CompletionResult | null => {
    const project = getProject();
    const arg = project && argumentBefore(context, PATH_COMMANDS);
    if (!project || !arg) return null;
    return { from: arg.from, options: pathOptions(project, arg.name), validFor: /^[^,{}\s]*$/ };
  };
}
