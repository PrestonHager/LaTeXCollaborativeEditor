import { graphicsOptionsToCss } from './graphicsOptions';
import { dirname, isPreviewableImage, joinPath, normalizePath } from '../project/paths';
import { biblatexStyle, buildBibliography, parseBib, resolveStyle, SUPPORTED_STYLES, type BibEntry, type BibStyle } from './bibStyles';
import type { EditorDiagnostic } from '../ui/diagnostics';

/** A diagnostic that knows which project file it belongs to. */
export type ProjectDiagnostic = EditorDiagnostic & { path: string };

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
  /** Notes about the source itself, like an unknown cite key or bibliography style. */
  diagnostics: ProjectDiagnostic[];
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

// Every cite command the preview understands. \nocite only adds entries to the list.
const CITE =
  /\\(nocite|[Cc]ite(?:p|t|alp|alt|author|year)?|[Pp]arencite|[Tt]extcite|[Aa]utocite|[Ff]ootcite)\*?\s*((?:\[[^\]]*\]\s*){0,2})\{([^}]*)\}/g;
const BIB_COMMAND = /\\bibliography\s*\{([^}]*)\}/g;
const BIB_RESOURCE = /\\addbibresource\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g;
const PRINT_BIB = /\\printbibliography\b\s*(?:\[[^\]]*\])?/g;
const BIB_STYLE = /\\bibliographystyle\s*\{([^}]*)\}/g;

/** Pick the style from \bibliographystyle, or biblatex's options. Unknown styles fall back to plain, with a note. */
function chooseStyle(code: string[], at: (line: number) => SourceLine, diagnostics: ProjectDiagnostic[]): BibStyle {
  const all = code.join('\n');
  let style: BibStyle | null = null;
  const lineIndex = code.findIndex((line) => line.includes('\\bibliographystyle'));
  const name = lineIndex >= 0 ? [...code[lineIndex].matchAll(BIB_STYLE)][0]?.[1].trim() : undefined;
  if (name !== undefined) {
    style = resolveStyle(name);
    if (!style) {
      diagnostics.push({
        ...at(lineIndex),
        severity: 'info',
        message: `Bibliography style "${name}" isn't supported in the preview, so it uses plain. Supported: ${SUPPORTED_STYLES.join(', ')}.`,
      });
    }
  } else {
    const biblatex = /\\usepackage\s*\[([^\]]*)\]\s*\{biblatex\}/.exec(all);
    if (biblatex) style = biblatexStyle(biblatex[1]);
  }
  style ??= resolveStyle('plain')!;
  // natbib's numbers option turns the author-year styles (plainnat and friends) into numbers.
  if (style.label === 'authoryear' && /\\usepackage\s*\[[^\]]*\bnumbers\b[^\]]*\]\s*\{natbib\}/.test(all)) style = { ...style, label: 'numeric' };
  return style;
}

/**
 * Turn \cite into labels and \bibliography (or \printbibliography) into a reference list, since
 * LaTeX.js has no BibTeX. The style comes from \bibliographystyle. Everything stays on the lines
 * it started on, so the line map still holds.
 */
function replaceBibliography(source: string, lineMap: SourceLine[], texts: Map<string, string>, missing: Set<string>, diagnostics: ProjectDiagnostic[]): string {
  const lines = source.split('\n');
  const code = lines.map((line) => line.slice(0, commentStart(line)));
  const all = code.join('\n');
  const files = [...all.matchAll(BIB_COMMAND), ...all.matchAll(BIB_RESOURCE)];
  if (!files.length) return source;
  const at = (index: number): SourceLine => lineMap[index] ?? { path: lineMap[0]?.path ?? '', line: 1 };

  const entries = new Map<string, BibEntry>();
  let allFound = true;
  for (const name of files.flatMap((file) => file[1].split(',')).map((part) => part.trim()).filter(Boolean)) {
    const path = resolveFile(name, dirname(lineMap[0]?.path ?? ''), (p) => texts.has(p), ['.bib', '']);
    if (!path) {
      missing.add(name.endsWith('.bib') ? name : `${name}.bib`);
      allFound = false;
      continue;
    }
    for (const entry of parseBib(texts.get(path)!)) if (!entries.has(entry.key)) entries.set(entry.key, entry);
  }

  // First pass: which keys are cited, in order. A missing key is only worth a warning when every .bib loaded.
  const cited = new Map<string, BibEntry>();
  code.forEach((line, index) => {
    for (const [, , , keys] of line.matchAll(CITE)) {
      for (const key of keys.split(',').map((part) => part.trim()).filter(Boolean)) {
        if (key === '*') for (const entry of entries.values()) cited.set(entry.key, entry);
        else if (entries.has(key)) cited.set(key, entries.get(key)!);
        else if (allFound) diagnostics.push({ ...at(index), severity: 'warning', message: `Citation "${key}" isn't in the bibliography.` });
      }
    }
  });
  // The style note goes after the cite warnings, since a missing key matters more.
  const style = chooseStyle(code, at, diagnostics);
  const items = buildBibliography([...cited.values()], style);
  const byKey = new Map(items.map((item) => [item.key, item]));
  const authorYear = style.label === 'authoryear';

  const citation = (command: string, notes: string, keys: string): string => {
    const kind = command.toLowerCase();
    if (kind === 'nocite') return '';
    const found = keys.split(',').map((key) => key.trim()).filter(Boolean).map((key) => byKey.get(key));
    const args = [...notes.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1].trim());
    const [pre, post] = args.length === 2 ? args : ['', args[0] ?? ''];
    const withPost = (text: string) => (post ? `${text}, ${post}` : text);
    let out: string;
    if (kind === 'citeauthor') out = found.map((item) => item?.names ?? '?').join('; ');
    else if (kind === 'citeyear') out = found.map((item) => item?.year ?? '?').join('; ');
    else if (kind === 'citet' || kind === 'textcite' || kind === 'citealt') {
      const [open, close] = kind === 'citealt' ? [' ', ''] : authorYear ? [' (', ')'] : [' [', ']'];
      out = found
        .map((item, i) => {
          const label = (authorYear ? item?.year : item?.label) ?? '?';
          return `${item?.names ?? '?'}${open}${i === found.length - 1 ? withPost(label) : label}${close}`;
        })
        .join(authorYear ? '; ' : ', ');
    } else {
      const inner = withPost(found.map((item) => item?.label ?? '?').join(authorYear ? '; ' : ', '));
      const text = pre ? `${pre} ${inner}` : inner;
      out = kind === 'citealp' ? text : authorYear && kind !== 'cite' ? `(${text})` : `[${text}]`;
    }
    // \Citet and friends start a sentence.
    return /^[A-Z]/.test(command) ? out.charAt(0).toUpperCase() + out.slice(1) : out;
  };

  const list = items.length
    ? `\\section*{References} ${items.map((item) => `\\noindent ${authorYear ? '' : `[${item.label}] `}${item.text}\\par`).join(' ')}`
    : '';
  return lines
    .map((line, index) => {
      const replaced = code[index]
        .replace(CITE, (_whole, command: string, notes: string, keys: string) => citation(command, notes, keys))
        .replace(BIB_STYLE, '')
        .replace(BIB_RESOURCE, '')
        .replace(BIB_COMMAND, () => list)
        .replace(PRINT_BIB, () => list);
      return replaced + line.slice(code[index].length);
    })
    .join('\n');
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
  const diagnostics: ProjectDiagnostic[] = [];
  source = replaceBibliography(source, map, texts, missing, diagnostics);
  return { source, lineMap: map, images, missing: [...missing], diagnostics };
}
