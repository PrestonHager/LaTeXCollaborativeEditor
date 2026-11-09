import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { LEGACY_STORAGE_KEY, LocalAppStorageProvider } from './localAppStorage';
import { resetDbForTests } from '../idb';

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('LocalAppStorageProvider', () => {
  beforeEach(() => {
    // Every test gets an empty database.
    resetDbForTests();
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
  });

  it('creates a project and reads back text and binary files', async () => {
    const provider = new LocalAppStorageProvider();
    await provider.connect();
    const { id } = await provider.createProject('Thesis');
    await provider.writeFile(id, 'main.tex', '\\documentclass{article}');
    await provider.writeFile(id, 'figures/plot.png', new Uint8Array([1, 2, 3]));
    await provider.createFolder(id, 'empty');
    await provider.setMainFile(id, 'main.tex');

    const listing = await provider.openProject(id);
    expect(listing.name).toBe('Thesis');
    expect(listing.mainPath).toBe('main.tex');
    expect(listing.entries).toEqual([
      { path: 'empty', kind: 'folder' },
      { path: 'figures/plot.png', kind: 'file' },
      { path: 'main.tex', kind: 'file' },
    ]);
    expect(text(await provider.readFile(id, 'main.tex'))).toBe('\\documentclass{article}');
    expect(Array.from(await provider.readFile(id, 'figures/plot.png'))).toEqual([1, 2, 3]);
    expect(provider.status()).toContain('Saved locally');
  });

  it('moves folders with everything in them and keeps the main file pointed at the right place', async () => {
    const provider = new LocalAppStorageProvider();
    const { id } = await provider.createProject('P');
    await provider.writeFile(id, 'src/main.tex', 'a');
    await provider.writeFile(id, 'src/ch/intro.tex', 'b');
    await provider.writeFile(id, 'srcfile.tex', 'c');
    await provider.setMainFile(id, 'src/main.tex');

    await provider.move(id, 'src', 'chapters');
    const listing = await provider.openProject(id);
    expect(listing.entries.map((entry) => entry.path)).toEqual(['chapters/ch/intro.tex', 'chapters/main.tex', 'srcfile.tex']);
    expect(listing.mainPath).toBe('chapters/main.tex');
  });

  it('removes a folder and its contents, then renames and lists projects newest first', async () => {
    const provider = new LocalAppStorageProvider();
    const first = await provider.createProject('First');
    await provider.writeFile(first.id, 'a/b.tex', 'x');
    await provider.writeFile(first.id, 'keep.tex', 'y');
    await provider.remove(first.id, 'a');
    expect((await provider.openProject(first.id)).entries.map((entry) => entry.path)).toEqual(['keep.tex']);

    await new Promise((r) => setTimeout(r, 5));
    const second = await provider.createProject('Second');
    await new Promise((r) => setTimeout(r, 5));
    await provider.renameProject(first.id, 'Renamed');
    const projects = await provider.listProjects();
    expect(projects.map((project) => project.name)).toEqual(['Renamed', 'Second']);
    expect(projects[1].id).toBe(second.id);
  });

  it('moves old single documents from localStorage into one-file projects', async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ 'paper.tex': 'old text', bad: 42 }));
    const provider = new LocalAppStorageProvider();
    await provider.connect();

    const projects = await provider.listProjects();
    expect(projects.map((project) => project.name)).toEqual(['paper']);
    const id = await provider.findLegacyProject('paper.tex');
    expect(id).toBe(projects[0].id);
    const listing = await provider.openProject(id!);
    expect(listing.mainPath).toBe('paper.tex');
    expect(text(await provider.readFile(id!, 'paper.tex'))).toBe('old text');
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    expect(await provider.findLegacyProject('other.tex')).toBeNull();
  });

  it('ignores a legacy key that is not an object', async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(['array']));
    const provider = new LocalAppStorageProvider();
    expect(await provider.listProjects()).toEqual([]);
    localStorage.setItem(LEGACY_STORAGE_KEY, '{not json');
    expect(await new LocalAppStorageProvider().listProjects()).toEqual([]);
  });

  it('clears every project', async () => {
    const provider = new LocalAppStorageProvider();
    await provider.createProject('A');
    await provider.clear();
    expect(await provider.listProjects()).toEqual([]);
    expect(provider.status()).toBe('Local projects cleared');
  });

  it('gives clear errors for missing projects and files', async () => {
    const provider = new LocalAppStorageProvider();
    await expect(provider.openProject('nope')).rejects.toThrow(/no longer exists/);
    await expect(provider.writeFile('nope', 'a.tex', 'x')).rejects.toThrow(/no longer exists/);
    const { id } = await provider.createProject('A');
    await expect(provider.readFile(id, 'missing.tex')).rejects.toThrow(/was not found/);
  });

  it('explains when IndexedDB is missing', async () => {
    resetDbForTests();
    const saved = globalThis.indexedDB;
    // @ts-expect-error simulating a browser without IndexedDB
    delete globalThis.indexedDB;
    const provider = new LocalAppStorageProvider();
    await expect(provider.createProject('A')).rejects.toMatchObject({ retryable: false });
    globalThis.indexedDB = saved;
  });
});
