import { graphicsOptionsToCss } from './graphicsOptions';
import { dirname, isPreviewableImage, joinPath, normalizePath } from '../project/paths';

/** Where a line of the expanded source came from, so errors point at the right file. */
export type SourceLine = { path: string; line: number };

export type ExpandedSource = {
  source: string;
  /** lineMap[i] is where line i + 1 of `source` came from. */
  lineMap: SourceLine[];
  /** Image tokens put into the source, mapped to the project file they stand for and the CSS for their size. */
  images: Map<string, { path: string; style: string }>;
  /** Files the source asked for that aren't in the project. */
  missing: string[];
};

const MAX_INPUT_DEPTH = 12;
const GRAPHIC_EXTENSIONS = ['', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf', '.eps'];
// An image token is plain letters and digits, so LaTeX.js takes it as a file name without trouble.
export const IMAGE_TOKEN_PREFIX = 'lcimg';

/** Find where a % comment starts on a line, skipping escaped \%. Returns the line length if none. */
function commentStart(line: string): number {
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '\\') {
      i += 1;
      continue;
    }
    if (line[i] === '%') return i;
  }
  return line.length;
}

/** Keep only the line breaks of removed text, so later lines don't shift. */
const keepLineBreaks = (removed: string) => removed.replace(/[^\n]/g, '');

function resolveFile(name: string, fromDir: string, has: (path: string) => boolean, extensions: string[]): string | null {
  for (const base of [fromDir ? joinPath(fromDir, name) : null, name]) {
    if (base === null) continue;
    for (const ext of extensions) {
      const candidate = normalizePath(`${base}${ext}`);
      if (candidate && has(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Inline \input and \include files, the way LaTeX would read them, and keep a map of where
 * each line came from. A missing file is left as a comment so the rest still compiles.
 */
function expandInputs(path: string, texts: Map<string, string>, missing: Set<string>, stack: string[]): { lines: string[]; map: SourceLine[] } {
  const lines: string[] = [];
  const map: SourceLine[] = [];
  const text = texts.get(path) ?? '';
  const rootDir = stack.length ? dirname(stack[0]) : dirname(path);
  const pattern = /\\(input|include)\s*\{([^}]+)\}/;

  text.split('\n').forEach((original, index) => {
    const origin = { path, line: index + 1 };
    let rest = original;
    let current = '';
    // Handle every \input on the line, in order, while skipping commented-out ones.
    for (;;) {
      const code = rest.slice(0, commentStart(rest));
      const match = pattern.exec(code);
      if (!match) break;
      const target = resolveFile(match[2].trim(), rootDir, (p) => texts.has(p), ['', '.tex']);
      if (!target || target === path || stack.includes(target) || stack.length >= MAX_INPUT_DEPTH) {
        if (!target) missing.add(match[2].trim());
        current += rest.slice(0, match.index);
        rest = rest.slice(match.index + match[0].length);
        continue;
      }
      // Now close off the text before the \input, splice in the file, and carry on after it.
      lines.push(current + rest.slice(0, match.index));
      map.push(origin);
      const inner = expandInputs(target, texts, missing, [...stack, path]);
      lines.push(...inner.lines);
      map.push(...inner.map);
      current = '';
      rest = rest.slice(match.index + match[0].length);
    }
    lines.push(current + rest);
    map.push(origin);
  });
  return { lines, map };
}

/** Swap \includegraphics paths for tokens, so the preview can put the real image back in. */
function replaceGraphics(source: string, has: (path: string) => boolean, missing: Set<string>, images: ExpandedSource['images']) {
  const graphicsPaths: string[] = [];
  const pathDecl = /\\graphicspath\s*\{((?:\s*\{[^}]*\})*)\s*\}/g;
  for (const decl of source.matchAll(pathDecl)) {
    for (const dir of decl[1].matchAll(/\{([^}]*)\}/g)) graphicsPaths.push(dir[1]);
  }
  return source
    .replace(pathDecl, keepLineBreaks)
    .replace(/\\includegraphics\s*(\[[^\]]*\])?\s*\{([^}]*)\}/g, (whole, options: string | undefined, rawName: string) => {
      const name = rawName.trim();
      let found: string | null = null;
      for (const dir of ['', ...graphicsPaths]) {
        found = resolveFile(`${dir}${name}`, '', has, GRAPHIC_EXTENSIONS);
        if (found) break;
      }
      if (!found) {
        missing.add(name);
        return whole;
      }
      if (!isPreviewableImage(found)) return whole;
      const token = `${IMAGE_TOKEN_PREFIX}${images.size + 1}`;
      images.set(token, { path: found, style: graphicsOptionsToCss(options?.slice(1, -1)) });
      // LaTeX.js needs the options group, even an empty one, or it crashes on a missing width.
      return `\\includegraphics[]{${token}}`;
    });
}

type BibEntry = { key: string; fields: Record<string, string> };

/** Pull entries out of a .bib file. Good enough for the preview, not a full BibTeX parser. */
export function parseBib(text: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const start = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
  let match: RegExpExecArray | null;
  while ((match = start.exec(text))) {
    if (/^(comment|preamble|string)$/i.test(match[1])) continue;
    // First, find the end of the entry by counting braces.
    let depth = 1;
    let i = start.lastIndex;
    for (; i < text.length && depth > 0; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
    }
    const body = text.slice(start.lastIndex, i - 1);
    start.lastIndex = i;
    // Then read each field = {value} or "value" or bare value.
    const fields: Record<string, string> = {};
    const field = /(\w+)\s*=\s*/g;
    let f: RegExpExecArray | null;
    while ((f = field.exec(body))) {
      let j = field.lastIndex;
      let value = '';
      if (body[j] === '{') {
        let d = 0;
        const from = j;
        for (; j < body.length; j += 1) {
          if (body[j] === '{') d += 1;
          else if (body[j] === '}' && --d === 0) break;
        }
        value = body.slice(from + 1, j);
        j += 1;
      } else if (body[j] === '"') {
        const end = body.indexOf('"', j + 1);
        value = body.slice(j + 1, end < 0 ? body.length : end);
        j = end < 0 ? body.length : end + 1;
      } else {
        const end = body.slice(j).search(/[,\n]/);
        value = body.slice(j, end < 0 ? body.length : j + end);
        j = end < 0 ? body.length : j + end;
      }
      fields[f[1].toLowerCase()] = value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
      field.lastIndex = j;
    }
    entries.push({ key: match[2], fields });
  }
  return entries;
}

/**
 * Turn \cite into numbers and \bibliography into a reference list, since LaTeX.js has no BibTeX.
 * Everything stays on the lines it started on, so the line map still holds.
 */
function replaceBibliography(source: string, texts: Map<string, string>, missing: Set<string>): string {
  const bibCommand = /\\bibliography\s*\{([^}]*)\}/;
  const bibMatch = bibCommand.exec(source.split('\n').map((line) => line.slice(0, commentStart(line))).join('\n'));
  if (!bibMatch) return source;
  const entries = new Map<string, BibEntry>();
  for (const name of bibMatch[1].split(',').map((part) => part.trim()).filter(Boolean)) {
    const path = resolveFile(name, '', (p) => texts.has(p), ['.bib', '']);
    if (!path) {
      missing.add(`${name}.bib`);
      continue;
    }
    for (const entry of parseBib(texts.get(path)!)) entries.set(entry.key, entry);
  }

  // Number cited keys in the order they first show up.
  const numbers = new Map<string, number>();
  const cite = /\\(?:cite|citep|citet|parencite|textcite|autocite)\s*(?:\[[^\]]*\]\s*)*\{([^}]*)\}/g;
  const withCites = source.replace(cite, (_whole, keys: string) => {
    const labels = keys.split(',').map((key) => key.trim()).filter(Boolean).map((key) => {
      if (!entries.has(key)) return '?';
      if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
      return String(numbers.get(key));
    });
    return `[${labels.join(', ')}]`;
  });

  const items = [...numbers].map(([key, n]) => {
    const { author, title, journal, booktitle, publisher, year } = entries.get(key)!.fields;
    const parts = [author, title ? `\\textit{${title}}` : '', journal ?? booktitle ?? publisher, year].filter(Boolean);
    return `\\noindent [${n}] ${parts.join('. ')}.\\par`;
  });
  const list = items.length ? `\\section*{References} ${items.join(' ')}` : '';
  return withCites.replace(/\\bibliographystyle\s*\{[^}]*\}/g, keepLineBreaks).replace(bibCommand, list);
}

/**
 * Build one source for the previewer from the whole project, starting at the main file.
 * `binaryPaths` lists the project's binary files, so images resolve even before their bytes arrive.
 */
export function expandProjectSource(mainPath: string, texts: Map<string, string>, binaryPaths: Iterable<string>): ExpandedSource {
  const missing = new Set<string>();
  const images: ExpandedSource['images'] = new Map();
  const binaries = new Set(binaryPaths);
  const { lines, map } = expandInputs(mainPath, texts, missing, []);
  let source = lines.join('\n');
  source = replaceGraphics(source, (path) => binaries.has(path) || texts.has(path), missing, images);
  source = replaceBibliography(source, texts, missing);
  return { source, lineMap: map, images, missing: [...missing] };
}
