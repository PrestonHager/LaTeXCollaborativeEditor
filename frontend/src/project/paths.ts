// Path helpers for project files. Paths are relative, use "/" and never start or end with one.

/** Largest file we accept for upload or peer transfer, in bytes. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Longest file path we keep, in characters. */
export const MAX_PATH_LENGTH = 512;

const TEXT_EXTENSIONS = new Set([
  'tex', 'ltx', 'sty', 'cls', 'bib', 'bst', 'bbx', 'cbx', 'def', 'cfg', 'clo', 'dtx', 'ins',
  'txt', 'md', 'csv', 'tsv', 'dat', 'json', 'xml', 'yaml', 'yml', 'tikz', 'pgf', 'gnuplot', 'lua', 'py', 'r',
]);

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  eps: 'application/postscript',
  zip: 'application/zip',
};

/**
 * Clean up a path a person typed or a zip gave us.
 * Returns null for paths that are empty or try to climb out of the project.
 */
export function normalizePath(raw: string): string | null {
  const parts: string[] = [];
  for (const part of raw.replace(/\\/g, '/').split('/')) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === '.') continue;
    if (trimmed === '..') return null;
    parts.push(trimmed);
  }
  if (!parts.length) return null;
  const path = parts.join('/');
  return path.length <= MAX_PATH_LENGTH ? path : null;
}

/**
 * Check a path that came from a peer, like one in the shared file tree.
 * It has to already be in the clean form normalizePath gives, so no "..", no leading "/",
 * no backslashes, and no drive letter like "C:".
 */
export function isSafePath(path: unknown): path is string {
  if (typeof path !== 'string' || /^[A-Za-z]:/.test(path)) return false;
  return normalizePath(path) === path;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

export function extension(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase();
}

/** Check if path is inside folder (and not the folder itself). */
export function isInside(path: string, folder: string): boolean {
  return path.startsWith(`${folder}/`);
}

/** Swap the folder prefix of path, for moving a folder and everything in it. */
export function replacePrefix(path: string, from: string, to: string): string {
  if (path === from) return to;
  return isInside(path, from) ? `${to}${path.slice(from.length)}` : path;
}

/** Text files open in the editor and sync as Yjs text. Everything else is binary. */
export function isTextPath(path: string): boolean {
  return TEXT_EXTENSIONS.has(extension(path));
}

export function mimeType(path: string): string {
  return MIME_TYPES[extension(path)] ?? (isTextPath(path) ? 'text/plain' : 'application/octet-stream');
}

/** Images the browser can show, so the viewer and preview can use them. */
export function isPreviewableImage(path: string): boolean {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension(path));
}

export function isPdf(path: string): boolean {
  return extension(path) === 'pdf';
}

/**
 * Pick the main file: a .tex file with \documentclass, preferring shallow paths and "main.tex".
 * Falls back to any .tex file, then null.
 */
export function guessMainFile(files: { path: string; text?: string }[]): string | null {
  const tex = files.filter((file) => extension(file.path) === 'tex');
  const rank = (file: { path: string }) => [file.path.split('/').length, basename(file.path) === 'main.tex' ? 0 : 1, file.path] as const;
  const sorted = [...tex].sort((a, b) => {
    const [da, ma, pa] = rank(a);
    const [db, mb, pb] = rank(b);
    return da - db || ma - mb || pa.localeCompare(pb);
  });
  const withClass = sorted.find((file) => file.text !== undefined && /\\documentclass\b/.test(file.text));
  return (withClass ?? sorted[0])?.path ?? null;
}

/** Make a name unique among taken ones by adding " (2)", " (3)", and so on before the extension. */
export function uniquePath(path: string, taken: Set<string>): string {
  if (!taken.has(path)) return path;
  const dir = dirname(path);
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n += 1) {
    const candidate = joinPath(dir, `${stem} (${n})${ext}`);
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Name for something an undo brings back when its old path is taken: "a (restored).tex", then
 * "a (restored 2).tex". Folders keep dots in their name, since they have no extension.
 */
export function restoredPath(path: string, taken: (path: string) => boolean, folder = false): string {
  const dir = dirname(path);
  const name = basename(path);
  const dot = folder ? -1 : name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; ; n += 1) {
    const candidate = joinPath(dir, `${stem} (restored${n > 1 ? ` ${n}` : ''})${ext}`);
    if (!taken(candidate)) return candidate;
  }
}
