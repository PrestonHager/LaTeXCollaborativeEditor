import { StorageError } from './errors';

/**
 * Thrown by writeFile when the stored file changed since we last loaded or saved it.
 * Retrying won't help, the person has to pick which copy to keep.
 */
export class ConflictError extends StorageError {
  readonly path: string;
  /** The version storage has now, so taking their copy can pick up from there. */
  readonly remoteVersion?: string;

  constructor(path: string, remoteVersion?: string) {
    super(`${path} was changed somewhere else since it was last saved.`, { retryable: false, status: 412 });
    this.name = 'ConflictError';
    this.path = path;
    this.remoteVersion = remoteVersion;
  }
}

/** A file whose save is on hold until the person picks a copy. */
export type FileConflict = { id: string; path: string; remoteVersion?: string };

export type ConflictChoice = 'mine' | 'theirs' | 'copy';

/** Pick a free name for "save mine as a copy", like "main (my copy).tex". */
export function copyPath(path: string, taken: (path: string) => boolean): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const split = dot > slash + 1 ? dot : path.length;
  const stem = path.slice(0, split);
  const ext = path.slice(split);
  let candidate = `${stem} (my copy)${ext}`;
  for (let n = 2; taken(candidate); n += 1) candidate = `${stem} (my copy ${n})${ext}`;
  return candidate;
}
