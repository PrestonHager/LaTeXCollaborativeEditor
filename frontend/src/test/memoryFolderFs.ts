import { vi, type Mock } from 'vitest';
import type { FolderFs } from '../storage/providers/localFolder';

/** An in-memory disk. Every write bumps the clock, so each one gets a new modified time. */
export function memoryFs(root = '/home/me/thesis') {
  let clock = 1000;
  const files = new Map<string, { data: Uint8Array; mtime: number }>();
  const dirs = new Set<string>([root]);
  const watchers: ((paths: string[]) => void)[] = [];
  const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/'));
  const fs: { [K in keyof FolderFs]: Mock<FolderFs[K]> } & { files: typeof files; dirs: typeof dirs; emit(paths: string[]): void; picked: string | null; outside(path: string, text: string): void } = {
    files,
    dirs,
    picked: root,
    emit: (paths) => watchers.forEach((watcher) => watcher(paths)),
    outside(path, text) {
      files.set(path, { data: new TextEncoder().encode(text), mtime: (clock += 1) });
    },
    pickFolder: vi.fn(async () => fs.picked),
    readDir: vi.fn(async (path: string) => {
      if (!dirs.has(path)) throw new Error(`forbidden path: ${path}`);
      const names = new Map<string, boolean>();
      for (const dir of dirs) if (parentOf(dir) === path) names.set(dir.slice(path.length + 1), true);
      for (const file of files.keys()) if (parentOf(file) === path) names.set(file.slice(path.length + 1), false);
      return [...names].map(([name, isDirectory]) => ({ name, isDirectory, isFile: !isDirectory }));
    }),
    readFile: vi.fn(async (path: string) => {
      const file = files.get(path);
      if (!file) throw new Error(`No such file: ${path}`);
      return file.data;
    }),
    writeFile: vi.fn(async (path: string, data: Uint8Array) => {
      if (!dirs.has(parentOf(path))) throw new Error(`No folder for ${path}`);
      files.set(path, { data, mtime: (clock += 1) });
    }),
    mkdir: vi.fn(async (path: string) => {
      for (let dir = path; dir.length > root.length; dir = parentOf(dir)) dirs.add(dir);
    }),
    remove: vi.fn(async (path: string) => {
      if (!files.delete(path) && !dirs.delete(path)) throw new Error('missing');
      for (const key of [...files.keys()]) if (key.startsWith(`${path}/`)) files.delete(key);
      for (const key of [...dirs]) if (key.startsWith(`${path}/`)) dirs.delete(key);
    }),
    rename: vi.fn(async (from: string, to: string) => {
      const file = files.get(from);
      if (file) {
        files.delete(from);
        files.set(to, file);
        return;
      }
      for (const key of [...files.keys()]) {
        if (key.startsWith(`${from}/`)) {
          files.set(to + key.slice(from.length), files.get(key)!);
          files.delete(key);
        }
      }
      for (const key of [...dirs]) {
        if (key === from || key.startsWith(`${from}/`)) {
          dirs.delete(key);
          dirs.add(to + key.slice(from.length));
        }
      }
    }),
    stat: vi.fn(async (path: string) => {
      const file = files.get(path);
      if (file) return { size: file.data.length, mtime: file.mtime, isDirectory: false };
      return dirs.has(path) ? { size: 0, mtime: null, isDirectory: true } : null;
    }),
    watch: vi.fn(async (_path: string, onChange: (paths: string[]) => void) => {
      watchers.push(onChange);
      return () => watchers.splice(watchers.indexOf(onChange), 1);
    }),
  };
  return fs;
}
