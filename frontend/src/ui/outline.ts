import type { CompletionProject, TextLocation } from './completionProject';
import { dirname, joinPath, normalizePath } from '../project/paths';
import { cleanBibValue, stripComments } from './projectCompletion';

/**
 * The document outline (issue #248): the project's sections, figures and tables in document order,
 * from the main file through \input, \include and \subfile. A lazy chunk: the Files pane loads it
 * when the Outline section is open. It reads the project doc in the browser and sends nothing.
 */

export type OutlineKind = 'part' | 'chapter' | 'section' | 'subsection' | 'subsubsection' | 'paragraph' | 'subparagraph' | 'figure' | 'table';

export interface OutlineEntry extends TextLocation {
  kind: OutlineKind;
  title: string;
  /** How deep it sits: 0 for the outermost level the document uses. */
  depth: number;
}

const HEADING_LEVEL: Record<string, number> = {
  part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6,
};

/** Environments whose text isn't LaTeX, so a `\section` in them isn't one. */
const VERBATIM = /\\begin\s*\{(verbatim\*?|Verbatim|lstlisting|minted|comment|filecontents\*?)\}[\s\S]*?\\end\s*\{\1\}/g;

/** Blanks out verbatim environments, keeping line breaks so lines and columns still match. */
export function blankVerbatim(text: string): string {
  return text.replace(VERBATIM, (block) => block.replace(/[^\n]/g, ' '));
}

/** Reads a braced group starting at `start` (at the `{`). Returns its text and where it ends, or null. */
function readGroup(text: string, start: number): { value: string; end: number } | null {
  if (text[start] !== '{') return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return { value: text.slice(start + 1, i), end: i + 1 };
  }
  return null;
}

/** Skips spaces, a `*` and an optional `[...]` argument, so `pos` lands on the first `{`. */
function skipToGroup(text: string, pos: number): number {
  const skip = /\s*\*?\s*(?:\[[^\]]*\]\s*)?/y;
  skip.lastIndex = pos;
  skip.exec(text);
  return skip.lastIndex;
}

/** A title for the list: no commands, braces or extra spaces, like "The TeXbook" for "The {\TeX}book". */
export function cleanTitle(value: string): string {
  // Math stays as typed, since it's often the point of the title.
  const math: string[] = [];
  const text = value
    .replace(/\$[^$]*\$/g, (m) => `\u0001${math.push(m) - 1}\u0002`)
    .replace(/~/g, ' ')
    .replace(/\\(?:label|index)\s*\{[^{}]*\}/g, '');
  return cleanBibValue(text).replace(/\u0001(\d+)\u0002/g, (_m, i: string) => math[Number(i)]).replace(/\s+/g, ' ').trim();
}

type Place = { line: number; column: number };
type FileItem =
  | ({ type: 'heading'; kind: OutlineKind; title: string } & Place)
  | ({ type: 'float'; kind: 'figure' | 'table'; title: string } & Place)
  | ({ type: 'include'; name: string } & Place);

const ITEM = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\b|\\begin\s*\{(figure|table)\*?\}|\\(input|include|subfile)\s*\{([^{}]*)\}/g;

/** The headings, figures, tables and included files in one file's text, in order. */
export function outlineItems(text: string): FileItem[] {
  const source = blankVerbatim(stripComments(text));
  const items: FileItem[] = [];
  const lineAndColumn = locator(source);
  for (const match of source.matchAll(ITEM)) {
    const index = match.index;
    // `\\section` is a line break and the word.
    const run = /\\*$/.exec(source.slice(0, index))?.[0].length ?? 0;
    if (run % 2 === 1) continue;
    if (match[1]) {
      const group = readGroup(source, skipToGroup(source, index + match[0].length));
      if (!group) continue;
      items.push({ type: 'heading', kind: match[1] as OutlineKind, title: cleanTitle(group.value), ...lineAndColumn(index) });
    } else if (match[2]) {
      const kind = match[2] as 'figure' | 'table';
      const close = new RegExp(`\\\\end\\s*\\{${kind}\\*?\\}`, 'g');
      close.lastIndex = index;
      const end = close.exec(source)?.index ?? source.length;
      const body = source.slice(index, end);
      const caption = /\\caption\b/.exec(body);
      const group = caption ? readGroup(body, skipToGroup(body, caption.index + caption[0].length)) : null;
      items.push({ type: 'float', kind, title: group ? cleanTitle(group.value) : '', ...lineAndColumn(index) });
    } else {
      items.push({ type: 'include', name: match[4].trim(), ...lineAndColumn(index) });
    }
  }
  return items;
}

/** Finds the line (from 1) and column (from 0) of offsets. Comments are cut from the ends of lines only, so these match the file. */
function locator(text: string): (index: number) => Place {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: index - starts[lo] };
  };
}

/** The project file an `\input{name}` means: relative to the main file's folder, with `.tex` added if needed. */
export function resolveInclude(name: string, root: string, has: (path: string) => boolean): string | null {
  const joined = normalizePath(joinPath(root, name));
  if (!joined) return null;
  for (const candidate of [`${joined}.tex`, joined]) if (has(candidate)) return candidate;
  return null;
}

/** The outline of the whole project, from its main file. Empty without a main file. */
export function buildOutline(project: CompletionProject): OutlineEntry[] {
  const mainPath = project.mainPath();
  if (!mainPath) return [];
  const texts = new Map<string, () => string>();
  for (const file of project.files()) if (file.kind === 'text') texts.set(file.path, file.text);
  const root = dirname(mainPath);
  const raw: Omit<OutlineEntry, 'depth'>[] = [];
  const visiting = new Set<string>();
  const walk = (path: string) => {
    const read = texts.get(path);
    if (!read || visiting.has(path)) return;
    visiting.add(path);
    for (const item of outlineItems(read())) {
      if (item.type === 'include') {
        const target = resolveInclude(item.name, root, (p) => texts.has(p));
        if (target) walk(target);
        continue;
      }
      raw.push({ kind: item.kind, title: item.title, path, line: item.line, column: item.column, length: 0 });
    }
    visiting.delete(path);
  };
  walk(mainPath);
  // Headings indent by level, from the outermost one used; figures and tables sit under the heading before them.
  const levels = raw.filter((e) => e.kind in HEADING_LEVEL).map((e) => HEADING_LEVEL[e.kind]);
  const top = levels.length ? Math.min(...levels) : 0;
  let current = -1;
  return raw.map((entry) => {
    if (entry.kind in HEADING_LEVEL) {
      current = HEADING_LEVEL[entry.kind] - top;
      return { ...entry, depth: current };
    }
    return { ...entry, depth: current + 1 };
  });
}

/** What a row says. */
export function entryLabel(entry: OutlineEntry): string {
  if (entry.kind === 'figure' || entry.kind === 'table') {
    const name = entry.kind === 'figure' ? 'Figure' : 'Table';
    return entry.title ? `${name}: ${entry.title}` : name;
  }
  return entry.title || `(untitled ${entry.kind})`;
}

export interface OutlineHost {
  /** The project to outline, or null before there is one. */
  project(): CompletionProject | null;
  /** Opens a place in the editor. */
  open(location: TextLocation): void;
}

/** How long after a change the outline is drawn again. */
export const OUTLINE_DELAY = 300;

/**
 * Draws the outline into `list` and keeps it up to date as the project changes, local edits and
 * peers' alike. Call `dispose` to stop.
 */
export function mountOutline(list: HTMLElement, host: OutlineHost, delay = OUTLINE_DELAY) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let listeningTo: CompletionProject | null = null;
  let stop: (() => void) | null = null;
  let lastKey = '';

  const render = () => {
    const project = host.project();
    if (project !== listeningTo) {
      stop?.();
      stop = project?.onChange?.(schedule) ?? null;
      listeningTo = project;
    }
    const entries = project ? buildOutline(project) : [];
    const empty = !project?.mainPath() ? 'Set a main file to see its outline.' : entries.length ? '' : 'No sections, figures or tables yet.';
    const key = JSON.stringify([empty, entries]);
    if (key === lastKey) return;
    lastKey = key;
    const items: HTMLElement[] = entries.map((entry) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'outline-item';
      button.dataset.kind = entry.kind;
      button.style.setProperty('--depth', String(entry.depth));
      button.textContent = entryLabel(entry);
      button.title = `${entryLabel(entry)} (${entry.path}:${entry.line})`;
      button.addEventListener('click', () => host.open(entry));
      li.append(button);
      return li;
    });
    if (empty) {
      const li = document.createElement('li');
      li.className = 'outline-empty';
      li.textContent = empty;
      items.push(li);
    }
    list.replaceChildren(...items);
  };

  function schedule() {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      render();
    }, delay);
  }

  render();
  return {
    /** Draws it now, like when the project was replaced. */
    refresh: render,
    dispose() {
      if (timer !== null) clearTimeout(timer);
      stop?.();
      stop = null;
      listeningTo = null;
    },
  };
}
