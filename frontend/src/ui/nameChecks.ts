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

/** Check a project name: not empty, and short enough to keep. */
export function projectNameProblem(name: string): string | null {
  if (!name.trim()) return 'Enter a name.';
  if (name.trim().length > MAX_PROJECT_NAME_LENGTH) return `Keep the name to ${MAX_PROJECT_NAME_LENGTH} characters or fewer (it has ${name.trim().length}).`;
  return null;
}
