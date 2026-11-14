import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalFolderProvider, MAX_FOLDER_FILES, folderName, joinRoot, relativeTo, skipped, tauriFolderFs } from './localFolder';
import { ConflictError } from '../conflicts';
import { StorageError } from '../errors';
import { MAX_FILE_BYTES } from '../../project/paths';
import { memoryFs } from '../../test/memoryFolderFs';

const ROOT = '/home/me/thesis';
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('folder paths', () => {
  it('names the folder and joins paths with its separator', () => {
    expect(folderName('/home/me/thesis/')).toBe('thesis');
    expect(folderName('C:\\Users\\me\\Paper')).toBe('Paper');
    expect(joinRoot('/home/me/thesis', 'figures/a.png')).toBe('/home/me/thesis/figures/a.png');
    expect(joinRoot('C:\\Users\\me\\Paper\\', 'figures/a.png')).toBe('C:\\Users\\me\\Paper\\figures\\a.png');
    expect(joinRoot('/home/me/thesis', '')).toBe('/home/me/thesis');
  });

  it('turns absolute paths back into project paths, and only inside the folder', () => {
    expect(relativeTo('/home/me/thesis', '/home/me/thesis/ch/1.tex')).toBe('ch/1.tex');
    expect(relativeTo('C:\\Users\\me\\Paper', 'C:\\Users\\me\\Paper\\main.tex')).toBe('main.tex');
    expect(relativeTo('/home/me/thesis', '/home/me/thesis2/main.tex')).toBeNull();
    expect(relativeTo('/home/me/thesis', '/home/me/thesis')).toBeNull();
  });

  it('skips hidden files and build output', () => {
    expect(skipped('.git')).toBe(true);
    expect(skipped('main.aux')).toBe(true);
    expect(skipped('main.synctex.gz')).toBe(true);
    expect(skipped('node_modules')).toBe(true);
    expect(skipped('main.tex')).toBe(false);
    expect(skipped('refs.bbl')).toBe(false);
  });
});

describe('LocalFolderProvider', () => {
  let fs: ReturnType<typeof memoryFs>;
  let provider: LocalFolderProvider;

  beforeEach(() => {
    localStorage.clear();
    fs = memoryFs(ROOT);
    provider = new LocalFolderProvider(fs);
    fs.outside(`${ROOT}/main.tex`, '\\documentclass{article}');
    fs.dirs.add(`${ROOT}/figures`);
    fs.files.set(`${ROOT}/figures/a.png`, { data: new Uint8Array([1, 2, 3]), mtime: 5 });
    fs.dirs.add(`${ROOT}/.git`);
    fs.outside(`${ROOT}/.git/HEAD`, 'ref');
    fs.outside(`${ROOT}/main.aux`, 'aux');
  });

  it('is always ready and has no list of its own', async () => {
    expect(await provider.connect()).toBe(true);
    expect(provider.status()).toBe('Folder ready');
    expect(await provider.listProjects()).toEqual([]);
    await expect(provider.createProject()).rejects.toBeInstanceOf(StorageError);
  });

  it('picks a folder in the dialog, named after the folder', async () => {
    expect(await provider.pickFolder()).toEqual({ id: ROOT, name: 'thesis' });
    fs.picked = null;
    expect(await provider.pickFolder()).toBeNull();
  });

  it('lists the files like the zip export, leaving out hidden files and build output', async () => {
    const listing = await provider.openProject(ROOT);
    expect(listing).toEqual({
      id: ROOT,
      name: 'thesis',
      mainPath: null,
      entries: [
        { path: 'figures', kind: 'folder' },
        { path: 'figures/a.png', kind: 'file' },
        { path: 'main.tex', kind: 'file' },
      ],
    });
  });

  it('refuses a folder with too many files', async () => {
    for (let i = 0; i <= MAX_FOLDER_FILES; i += 1) fs.files.set(`${ROOT}/f${i}.tex`, { data: new Uint8Array(), mtime: 1 });
    await expect(provider.openProject(ROOT)).rejects.toThrow(/more than/);
  });

  it('says to open the folder again when the app lost access to it', async () => {
    await expect(provider.openProject('/elsewhere')).rejects.toThrow(/no longer reach the project folder/);
    expect(await provider.reachable('/elsewhere')).toBe(false);
    expect(await provider.reachable(ROOT)).toBe(true);
    fs.stat.mockRejectedValueOnce(new Error('forbidden'));
    expect(await provider.reachable(ROOT)).toBe(false);
  });

  it('remembers the name and main file in the app, not in the folder', async () => {
    await provider.renameProject(ROOT, 'My Thesis');
    await provider.setMainFile(ROOT, 'main.tex');
    const listing = await provider.openProject(ROOT);
    expect(listing.name).toBe('My Thesis');
    expect(listing.mainPath).toBe('main.tex');
    expect(await provider.pickFolder()).toEqual({ id: ROOT, name: 'My Thesis' });
    expect([...fs.files.keys()].some((path) => path.endsWith('.json'))).toBe(false);
  });

  it('survives broken or full localStorage for that memory', async () => {
    localStorage.setItem('latex_editor_folder_projects', '[1]');
    expect((await provider.openProject(ROOT)).name).toBe('thesis');
    localStorage.setItem('latex_editor_folder_projects', '{bad json');
    expect((await provider.openProject(ROOT)).name).toBe('thesis');
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    await expect(provider.renameProject(ROOT, 'x')).resolves.toBeUndefined();
    setItem.mockRestore();
  });

  it('reads files and remembers their version', async () => {
    expect(text(await provider.readFile(ROOT, 'main.tex'))).toBe('\\documentclass{article}');
    const version = provider.fileVersion(ROOT, 'main.tex');
    expect(version).toMatch(/^\d+-\d+$/);
    expect(await provider.diskVersion(ROOT, 'main.tex')).toBe(version);
    expect(provider.isOwnChange(ROOT, 'main.tex', version!)).toBe(true);
    expect(await provider.diskVersion(ROOT, 'gone.tex')).toBeNull();
    expect(await provider.diskVersion(ROOT, 'figures')).toBeNull();
    fs.stat.mockRejectedValueOnce(new Error('io'));
    expect(await provider.diskVersion(ROOT, 'main.tex')).toBeNull();
    await expect(provider.readFile(ROOT, 'missing.tex')).rejects.toThrow(/Could not read missing.tex/);
  });

  it('refuses files that are too big', async () => {
    fs.stat.mockResolvedValueOnce({ size: MAX_FILE_BYTES + 1, mtime: 1, isDirectory: false });
    await expect(provider.readFile(ROOT, 'main.tex')).rejects.toThrow(/too big/);
  });

  it('writes files, making their folders, and returns the new version', async () => {
    const result = await provider.writeFile(ROOT, 'chapters/one.tex', 'Hello');
    expect(text(fs.files.get(`${ROOT}/chapters/one.tex`)!.data)).toBe('Hello');
    expect(result).toEqual({ version: provider.fileVersion(ROOT, 'chapters/one.tex') });
    await provider.writeFile(ROOT, 'b.bin', new Uint8Array([9]));
    expect(fs.files.get(`${ROOT}/b.bin`)!.data).toEqual(new Uint8Array([9]));
  });

  it('throws a conflict when the file changed outside the app, unless forced', async () => {
    await provider.readFile(ROOT, 'main.tex');
    const seen = provider.fileVersion(ROOT, 'main.tex')!;
    fs.outside(`${ROOT}/main.tex`, 'edited in another editor');
    const error = await provider.writeFile(ROOT, 'main.tex', 'mine', { expectedVersion: seen }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).remoteVersion).toBe(await provider.diskVersion(ROOT, 'main.tex'));
    expect(text(fs.files.get(`${ROOT}/main.tex`)!.data)).toBe('edited in another editor');
    await provider.writeFile(ROOT, 'main.tex', 'mine', { expectedVersion: seen, force: true });
    expect(text(fs.files.get(`${ROOT}/main.tex`)!.data)).toBe('mine');
  });

  it('writes a file again that was deleted outside the app', async () => {
    await provider.readFile(ROOT, 'main.tex');
    const seen = provider.fileVersion(ROOT, 'main.tex')!;
    fs.files.delete(`${ROOT}/main.tex`);
    await provider.writeFile(ROOT, 'main.tex', 'back', { expectedVersion: seen });
    expect(text(fs.files.get(`${ROOT}/main.tex`)!.data)).toBe('back');
  });

  it('wraps write failures', async () => {
    fs.writeFile.mockRejectedValueOnce(new Error('disk full'));
    await expect(provider.writeFile(ROOT, 'x.tex', 'x')).rejects.toThrow(/Could not save x.tex in the project folder: disk full/);
    expect(provider.isOwnChange(ROOT, 'x.tex', null)).toBe(false);
  });

  it('counts a write in progress as its own change', async () => {
    let finish!: () => void;
    fs.writeFile.mockImplementationOnce(async () => new Promise<void>((resolve) => (finish = resolve)));
    const writing = provider.writeFile(ROOT, 'slow.tex', 'x');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(provider.isOwnChange(ROOT, 'slow.tex', null)).toBe(true);
    finish();
    await writing;
  });

  it('makes folders, moves and removes, keeping versions with moved files', async () => {
    await provider.createFolder(ROOT, 'empty/inner');
    expect(fs.dirs.has(`${ROOT}/empty/inner`)).toBe(true);
    await provider.readFile(ROOT, 'figures/a.png');
    const version = provider.fileVersion(ROOT, 'figures/a.png');
    await provider.move(ROOT, 'figures', 'img/figures');
    expect(fs.files.has(`${ROOT}/img/figures/a.png`)).toBe(true);
    expect(provider.fileVersion(ROOT, 'img/figures/a.png')).toBe(version);
    expect(provider.fileVersion(ROOT, 'figures/a.png')).toBeUndefined();
    await provider.remove(ROOT, 'img');
    expect(fs.files.has(`${ROOT}/img/figures/a.png`)).toBe(false);
    // Already gone is fine.
    await expect(provider.remove(ROOT, 'img')).resolves.toBeUndefined();
  });

  it('reports failures to make, move and delete', async () => {
    fs.mkdir.mockRejectedValueOnce(new Error('denied'));
    await expect(provider.createFolder(ROOT, 'x')).rejects.toThrow(/make the folder x/);
    fs.rename.mockRejectedValueOnce(new Error('busy'));
    await expect(provider.move(ROOT, 'main.tex', 'b.tex')).rejects.toThrow(/move main.tex/);
    fs.remove.mockRejectedValueOnce(new Error('busy'));
    await expect(provider.remove(ROOT, 'main.tex')).rejects.toThrow(/delete main.tex/);
    fs.readDir.mockRejectedValueOnce(new Error('io'));
    await expect(provider.countEntries(ROOT)).rejects.toThrow(/list the files/);
  });

  it('counts what a folder already holds, leaving out hidden files', async () => {
    expect(await provider.countEntries(ROOT)).toBe(2);
  });

  it('watches the folder through the fs plugin', async () => {
    const seen: string[][] = [];
    const stop = await provider.watch(ROOT, (paths) => seen.push(paths));
    fs.emit([`${ROOT}/main.tex`]);
    stop();
    fs.emit([`${ROOT}/main.tex`]);
    expect(seen).toEqual([[`${ROOT}/main.tex`]]);
  });
});

describe('tauriFolderFs', () => {
  it('maps every call onto the dialog and fs plugins', async () => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    const internals = {
      invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
        calls.push([cmd, args]);
        switch (cmd) {
          case 'plugin:dialog|open':
            return '/picked';
          case 'plugin:fs|exists':
            return true;
          case 'plugin:fs|stat':
            return { size: 3, mtime: 2000, isDirectory: false, isFile: true, isSymlink: false };
          case 'plugin:fs|read_dir':
            return [{ name: 'a.tex', isDirectory: false, isFile: true, isSymlink: false }];
          case 'plugin:fs|read_file':
            return [1, 2, 3];
          case 'plugin:fs|watch':
            return 7;
          default:
            return null;
        }
      }),
      transformCallback: vi.fn(() => 1),
      unregisterCallback: vi.fn(),
    };
    vi.stubGlobal('__TAURI_INTERNALS__', internals);
    try {
      const fs = await tauriFolderFs();
      expect(await fs.pickFolder('Pick')).toBe('/picked');
      expect(await fs.readDir('/picked')).toEqual([{ name: 'a.tex', isDirectory: false, isFile: true, isSymlink: false }]);
      expect(await fs.stat('/picked/a.tex')).toEqual({ size: 3, mtime: 2000, isDirectory: false });
      await fs.readFile('/picked/a.tex');
      await fs.writeFile('/picked/b.tex', new Uint8Array([1]));
      await fs.mkdir('/picked/d');
      await fs.remove('/picked/d');
      await fs.rename('/picked/a.tex', '/picked/c.tex');
      const stop = await fs.watch('/picked', () => {});
      expect(typeof stop).toBe('function');
      const commands = calls.map(([cmd]) => cmd);
      expect(commands).toEqual(
        expect.arrayContaining([
          'plugin:dialog|open',
          'plugin:fs|read_dir',
          'plugin:fs|exists',
          'plugin:fs|stat',
          'plugin:fs|read_file',
          'plugin:fs|write_file',
          'plugin:fs|mkdir',
          'plugin:fs|remove',
          'plugin:fs|rename',
          'plugin:fs|watch',
        ]),
      );
      const open = calls.find(([cmd]) => cmd === 'plugin:dialog|open')![1] as { options: Record<string, unknown> };
      expect(open.options).toMatchObject({ directory: true, recursive: true, multiple: false });
      internals.invoke.mockImplementation(async (cmd: string) => (cmd === 'plugin:fs|exists' ? false : null));
      expect(await fs.stat('/nope')).toBeNull();
      expect(await fs.pickFolder('Pick')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
