import { MAX_PATH_LENGTH, isInside, normalizePath } from '../project/paths';
import { MAX_PROJECT_NAME_LENGTH } from '../project/projectDoc';

// Characters Windows, zip tools and Drive sync choke on, plus control characters.
const BAD_CHARACTERS = /[\\:*?"<>|\u0000-\u001f]/;

/**
 * Check a file or folder path someone typed, for the name dialogs.
 * Returns what's wrong in a few words, or null when it's fine.
 * `taken` says if a path is already in the project. `from` is the path being renamed, which may keep its own name.
 */
export function pathProblem(rawPath: string, taken: (path: string) => boolean, from?: string): string | null {
  if (!rawPath.replace(/[/\s]/g, '')) return 'Enter a name.';
  const bad = rawPath.match(BAD_CHARACTERS);
  if (bad) return `Names can't contain ${bad[0] === '\\' ? 'a backslash' : /[\u0000-\u001f]/.test(bad[0]) ? 'control characters' : bad[0]}.`;
  if (rawPath.split('/').some((part) => part.trim() === '..')) return 'Names can\'t use ".." to leave the project.';
  if (rawPath.trim().length > MAX_PATH_LENGTH) return `Keep the path to ${MAX_PATH_LENGTH} characters or fewer.`;
  const path = normalizePath(rawPath);
  if (!path) return 'Enter a name.';
  if (from !== undefined && path === from) return null;
  if (from !== undefined && isInside(path, from)) return 'A folder cannot be moved inside itself.';
  if (taken(path)) return `${path} already exists.`;
  return null;
}

/** Where the base name sits in a path: after the last "/", before the extension. */
export function baseNameRange(value: string): [number, number] {
  const start = value.lastIndexOf('/') + 1;
  const dot = value.lastIndexOf('.');
  // A leading dot (".latexmkrc") is part of the name, not an extension.
  return [start, dot > start ? dot : value.length];
}

// How far nextFreeName counts before it gives up. Nobody has a thousand copies of one name.
const MAX_TRIES = 1000;

/**
 * The next name after `value` that `isFree` accepts, like "chapter (2).tex" for "chapter.tex"
 * or "figures (3)" for "figures (2)". Only the base name changes, so the folder and extension stay.
 * Returns null when none of the next MAX_TRIES names is free.
 */
export function nextFreeName(value: string, isFree: (value: string) => boolean): string | null {
  const [start, end] = baseNameRange(value);
  const base = value.slice(start, end);
  // Count on from a number that's already there, so "chapter (2).tex" suggests "chapter (3).tex", not "chapter (2) (2).tex".
  const numbered = base.match(/^(.*\S) \((\d+)\)$/);
  const stem = numbered ? numbered[1] : base;
  const first = numbered ? Number(numbered[2]) + 1 : 2;
  for (let n = first; n < first + MAX_TRIES; n += 1) {
    const candidate = `${value.slice(0, start)}${stem} (${n})${value.slice(end)}`;
    if (isFree(candidate)) return candidate;
  }
  return null;
}

/** A free name to offer in place of one that's taken, and what to say about it. */
export type NameSuggestion = { value: string; message: string };

/**
 * When `value` is a fine name except that it's taken, the next free one, for the name dialogs.
 * `toPath` turns what was typed into the project path (adding the folder or a .tex extension).
 * Null when the name is free, or wrong some other way that a number won't fix.
 */
export function suggestFreeName(value: string, toPath: (value: string) => string, taken: (path: string) => boolean, from?: string): NameSuggestion | null {
  if (!value || pathProblem(toPath(value), () => false, from) !== null) return null;
  const path = normalizePath(toPath(value));
  // A rename may keep its own name, so that isn't taken.
  if (!path || path === from || !taken(path)) return null;
  const next = nextFreeName(value, (candidate) => pathProblem(toPath(candidate), taken, from) === null);
  if (next === null) return null;
  return { value: next, message: `${path} already exists, so here's ${normalizePath(toPath(next))} instead.` };
}

/** Check a project name: not empty, and short enough to keep. */
export function projectNameProblem(name: string): string | null {
  if (!name.trim()) return 'Enter a name.';
  if (name.trim().length > MAX_PROJECT_NAME_LENGTH) return `Keep the name to ${MAX_PROJECT_NAME_LENGTH} characters or fewer (it has ${name.trim().length}).`;
  return null;
}
