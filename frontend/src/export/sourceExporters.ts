// Exporters that hand back the project's own files: the whole project, one file, or one flattened .tex.
import { projectToZip } from '../project/projectIo';
import { basename, mimeType } from '../project/paths';
import { flattenInputs } from '../compile/projectSource';
import { findVerbatimEnvironments } from '../compile/latexJsAdapt';
import { safeFileName, throwIfAborted, type Availability, type ExportSource, type Exporter } from './types';

/** Binary files we don't have the bytes for yet, because they're still coming from a peer. */
export function unsyncedFiles(source: ExportSource): string[] {
  return source.project
    .entries()
    .filter((entry) => entry.kind === 'binary' && !(entry.hash && source.blobs.has(entry.hash)))
    .map((entry) => entry.path);
}

export const notSyncedWarning = (paths: string[]) =>
  `${paths.length} file${paths.length === 1 ? " hasn't" : "s haven't"} finished syncing from peers and will be left out: ${paths.join(', ')}.`;

/** The main file's path, if the project has one. */
export function mainPath(source: ExportSource): string | null {
  const id = source.project.getMainFileId();
  return (id && source.project.get(id)?.path) || null;
}

/** Exporters that typeset or flatten the document need a main file to start from. */
export function needsMainFile(source: ExportSource): Availability {
  return mainPath(source) ? { ok: true } : { ok: false, reason: 'The project has no main .tex file. Pick one in the file tree first.' };
}

const textBlob = (text: string, type = 'text/plain;charset=utf-8') => new Blob([text], { type });

export const projectZipExporter: Exporter = {
  id: 'zip',
  label: 'Project .zip',
  description: 'Every file and folder in the project, to keep a copy, open it in another editor, or upload it here again.',
  icon: 'file-archive',
  fileExtension: '.zip',
  available(source) {
    if (!source.project.entries().length) return { ok: false, reason: 'The project has no files yet.' };
    const waiting = unsyncedFiles(source);
    return waiting.length ? { ok: true, warning: notSyncedWarning(waiting) } : { ok: true };
  },
  options: () => [],
  async run(source, _options, { signal, onProgress }) {
    onProgress(0.1, 'Zipping files...');
    const { zip, skipped } = await projectToZip(source.project, source.blobs);
    throwIfAborted(signal);
    return {
      files: [{ name: safeFileName(source.name, '.zip'), data: new Blob([zip as BlobPart], { type: 'application/zip' }) }],
      warnings: skipped.length ? [notSyncedWarning(skipped)] : [],
    };
  },
};

export const singleFileExporter: Exporter = {
  id: 'file',
  label: 'Single file',
  description: 'One file from the project, as it is.',
  icon: 'file-down',
  fileExtension: '',
  available(source) {
    return source.project.entries().some((entry) => entry.kind !== 'folder') ? { ok: true } : { ok: false, reason: 'The project has no files yet.' };
  },
  options(source) {
    const files = source.project.entries().filter((entry) => entry.kind !== 'folder');
    const preferred = [source.activePath, mainPath(source)].find((path) => path && files.some((entry) => entry.path === path));
    return [
      {
        id: 'path',
        kind: 'select',
        label: 'File',
        choices: files.map((entry) => ({ value: entry.path, label: entry.path })),
        default: preferred ?? files[0]?.path ?? '',
      },
    ];
  },
  async run(source, options, { signal }) {
    const path = String(options.path ?? '');
    const entry = source.project.findByPath(path);
    if (!entry || entry.kind === 'folder') throw new Error(`${path || 'That file'} isn't in the project any more.`);
    if (entry.kind === 'text') {
      return { files: [{ name: basename(path), data: textBlob(source.project.getText(entry.id).toString()) }], warnings: [] };
    }
    const bytes = entry.hash ? await source.blobs.get(entry.hash) : undefined;
    throwIfAborted(signal);
    if (!bytes) throw new Error(`${path} hasn't arrived from a peer yet.`);
    return { files: [{ name: basename(path), data: new Blob([bytes as BlobPart], { type: mimeType(path) }) }], warnings: [] };
  },
};

/**
 * Remove % comments from LaTeX source. A line that was only a comment goes away; a comment
 * after code keeps its %, so the line break it hid stays hidden. Verbatim blocks and \verb
 * are left alone, and so is an escaped \%.
 */
export function stripComments(source: string): string {
  const verbatim = findVerbatimEnvironments(source);
  let inside: string | null = null;
  const out: string[] = [];
  for (const line of source.split('\n')) {
    if (inside) {
      out.push(line);
      if (line.includes(`\\end{${inside}}`)) inside = null;
      continue;
    }
    const begin = /\\begin\s*\{([^}]*)\}/.exec(line);
    const at = commentAt(line);
    if (begin && verbatim.has(begin[1].trim()) && (at === -1 || begin.index < at) && !line.includes(`\\end{${begin[1].trim()}}`)) {
      inside = begin[1].trim();
      out.push(line);
      continue;
    }
    if (at === -1) out.push(line);
    else if (line.slice(0, at).trim()) out.push(line.slice(0, at + 1));
  }
  return out.join('\n');
}

/** Where a line's % comment starts, or -1. Skips \% and the inside of \verb. */
function commentAt(line: string): number {
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '%') return i;
    if (line[i] !== '\\') continue;
    const verb = /^\\verb\*?([^a-zA-Z\s])/.exec(line.slice(i));
    if (verb) {
      const close = line.indexOf(verb[1], i + verb[0].length);
      if (close === -1) return -1;
      i = close;
    } else {
      i += 1;
    }
  }
  return -1;
}

export const flattenedTexExporter: Exporter = {
  id: 'flat-tex',
  label: 'Flattened .tex',
  description: 'The main file with every \\input and \\include put in place, as one .tex file. Journals and arXiv often ask for this.',
  icon: 'file-text',
  fileExtension: '.tex',
  available: needsMainFile,
  options: () => [
    { id: 'stripComments', kind: 'checkbox', label: 'Remove comments', description: 'Leave out % comments, as arXiv asks.', default: false },
  ],
  async run(source, options) {
    const main = mainPath(source);
    if (!main) throw new Error('The project has no main .tex file.');
    const flat = flattenInputs(main, source.project.textFiles());
    const text = options.stripComments ? stripComments(flat.source) : flat.source;
    const name = basename(main).replace(/\.tex$/i, '');
    return {
      files: [{ name: `${name}-flat.tex`, data: textBlob(text, 'application/x-tex;charset=utf-8') }],
      warnings: flat.missing.length ? [`Not found in the project, so left as they were: ${flat.missing.join(', ')}.`] : [],
    };
  },
};
