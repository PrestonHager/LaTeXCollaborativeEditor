import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import * as Y from 'yjs';
import { resetDbForTests } from '../storage/idb';
import { LocalAppStorageProvider } from '../storage/providers/localAppStorage';
import { BlobStore } from '../project/blobStore';
import { ProjectDoc } from '../project/projectDoc';
import { createZip, readZip } from '../project/zip';
import { projectToPreviewHtml } from '../compile/latexJsPreview';
import { emptyProfile } from '../state/profile';
import { BUILTIN_TEMPLATES } from './builtinTemplates';
import { fillPlaceholders, initialValues, placeholderDefs, placeholdersIn, profileToPlaceholders, usedPlaceholders } from './placeholders';
import {
  loadBuiltin,
  loadStored,
  projectFromTemplate,
  renameTemplate,
  saveContentAsTemplate,
  saveProjectAsTemplate,
  splitManifest,
  templateFromZip,
  templateZipEntries,
  type TemplateStore,
} from './templateLibrary';

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function localStore(provider: LocalAppStorageProvider): TemplateStore {
  return {
    source: 'local',
    label: 'In this browser',
    provider,
    list: () => provider.listTemplates(),
    create: (name) => provider.createTemplate(name),
    remove: (id) => provider.deleteTemplate(id),
  };
}

/** A project with a main file, a chapter, an image and an empty folder. */
async function sampleProject(blobs: BlobStore) {
  const project = new ProjectDoc(new Y.Doc());
  const hash = await blobs.put(new Uint8Array([137, 80, 78, 71]));
  project.replaceAll({
    name: 'Ann thesis',
    mainPath: 'thesis.tex',
    files: [
      { path: 'thesis.tex', kind: 'text', text: '\\author{Ann Lee}\\input{ch/one}' },
      { path: 'ch/one.tex', kind: 'text', text: 'Hello {{course}}' },
      { path: 'figures/logo.png', kind: 'binary', hash, size: 4 },
      { path: 'empty', kind: 'folder' },
    ],
  });
  return project;
}

describe('template library', () => {
  let provider: LocalAppStorageProvider;
  let store: TemplateStore;
  let blobs: BlobStore;

  beforeEach(async () => {
    resetDbForTests();
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
    provider = new LocalAppStorageProvider();
    await provider.connect();
    store = localStore(provider);
    blobs = new BlobStore();
  });

  it('saves a project as a template, with every file, folder and a template.json', async () => {
    const project = await sampleProject(blobs);
    const profile = { ...emptyProfile(), name: 'Ann Lee' };
    const { summary, skipped } = await saveProjectAsTemplate(
      store,
      project,
      blobs,
      { name: 'Thesis', description: 'Mine', placeholders: [{ key: 'course', label: 'Course' }], mainFile: 'thesis.tex' },
      (value) => profileToPlaceholders(value, profile).text,
    );
    expect(skipped).toEqual([]);
    // It shows up as a template, never as a project.
    expect(await provider.listTemplates()).toEqual([expect.objectContaining({ id: summary.id, name: 'Thesis' })]);
    expect(await provider.listProjects()).toEqual([]);
    const listing = await provider.openProject(summary.id);
    expect(listing.mainPath).toBe('thesis.tex');
    expect(listing.entries.map((entry) => entry.path)).toEqual(['ch/one.tex', 'empty', 'figures/logo.png', 'template.json', 'thesis.tex']);
    expect(text(await provider.readFile(summary.id, 'thesis.tex'))).toBe('\\author{{{name}}}\\input{ch/one}');
    expect(Array.from(await provider.readFile(summary.id, 'figures/logo.png'))).toEqual([137, 80, 78, 71]);
    expect(JSON.parse(text(await provider.readFile(summary.id, 'template.json')))).toMatchObject({ format: 'latex-editor-template', name: 'Thesis', description: 'Mine', mainFile: 'thesis.tex' });
  });

  it('loads a saved template and makes a project from it with the placeholders filled in', async () => {
    const project = await sampleProject(blobs);
    const { summary } = await saveProjectAsTemplate(store, project, blobs, { name: 'Thesis', description: 'Mine', placeholders: [{ key: 'course', label: 'Course', default: 'MATH 1' }], mainFile: 'thesis.tex' });
    const fresh = new BlobStore();
    const loaded = await loadStored(store, summary, fresh);
    expect(loaded.summary).toMatchObject({ source: 'local', name: 'Thesis', description: 'Mine' });
    expect(loaded.content.files.some((file) => file.path === 'template.json')).toBe(false);
    expect(loaded.content.mainPath).toBe('thesis.tex');
    const defs = placeholderDefs(loaded.manifest);
    const used = usedPlaceholders(loaded.content.files.map((file) => file.text ?? ''), defs);
    expect(used.map((def) => def.key)).toEqual(['course']);
    const values = initialValues(used, emptyProfile(), 'en');
    expect(values.course).toBe('MATH 1');
    const content = projectFromTemplate(loaded, defs, { course: 'R&D_1' }, 'New one');
    expect(content.name).toBe('New one');
    expect(content.files.find((file) => file.path === 'ch/one.tex')?.text).toBe('Hello R\\&D\\_1');
    const logo = content.files.find((file) => file.path === 'figures/logo.png')!;
    expect(Array.from((await fresh.get(logo.hash!))!)).toEqual([137, 80, 78, 71]);
    expect(content.files).toContainEqual({ path: 'empty', kind: 'folder' });
  });

  it('leaves out files that have not arrived yet, and says which', async () => {
    const project = await sampleProject(blobs);
    const { skipped } = await saveProjectAsTemplate(store, project, { get: async () => undefined }, { name: 'T', description: '', placeholders: [] });
    expect(skipped).toEqual(['figures/logo.png']);
  });

  it('removes a half-made template when a write fails', async () => {
    const project = await sampleProject(blobs);
    const write = vi.spyOn(provider, 'writeFile');
    write.mockImplementationOnce(async () => {}).mockRejectedValueOnce(new Error('disk full'));
    await expect(saveProjectAsTemplate(store, project, blobs, { name: 'T', description: '', placeholders: [] })).rejects.toThrow('disk full');
    expect(await provider.listTemplates()).toEqual([]);
  });

  it('replaces the template.json of a template being edited, keeping its placeholders', async () => {
    const project = await sampleProject(blobs);
    project.createTextFile('template.json', '{"name":"Old","placeholders":[{"key":"course","label":"Course"}]}');
    const { summary } = await saveProjectAsTemplate(store, project, blobs, { name: 'New', description: '', placeholders: [{ key: 'course', label: 'Course' }] });
    const manifest = JSON.parse(text(await provider.readFile(summary.id, 'template.json')));
    expect(manifest).toMatchObject({ name: 'New', placeholders: [{ key: 'course', label: 'Course' }] });
  });

  it('renames a template in storage and in its template.json', async () => {
    const { summary } = await saveProjectAsTemplate(store, await sampleProject(blobs), blobs, { name: 'Old', description: 'd', placeholders: [] });
    await renameTemplate(store, summary.id, 'New');
    expect((await provider.listTemplates())[0].name).toBe('New');
    expect(JSON.parse(text(await provider.readFile(summary.id, 'template.json')))).toMatchObject({ name: 'New', description: 'd' });
  });

  it('deletes templates, but never a project through deleteTemplate', async () => {
    const { summary } = await saveProjectAsTemplate(store, await sampleProject(blobs), blobs, { name: 'T', description: '', placeholders: [] });
    const project = await provider.createProject('P');
    await expect(provider.deleteTemplate(project.id)).rejects.toThrow('no longer exists');
    await provider.deleteTemplate(summary.id);
    expect(await provider.listTemplates()).toEqual([]);
    await expect(provider.openProject(summary.id)).rejects.toThrow();
    expect(await provider.listProjects()).toHaveLength(1);
  });

  it('keeps templates when local projects are cleared', async () => {
    const { summary } = await saveProjectAsTemplate(store, await sampleProject(blobs), blobs, { name: 'T', description: '', placeholders: [] });
    const project = await provider.createProject('P');
    await provider.writeFile(project.id, 'main.tex', 'x');
    await provider.clear();
    expect(await provider.listProjects()).toEqual([]);
    expect(await provider.listTemplates()).toHaveLength(1);
    expect(text(await provider.readFile(summary.id, 'thesis.tex'))).toContain('\\author');
    await expect(provider.readFile(project.id, 'main.tex')).rejects.toThrow();
  });

  it('exports a template as a .zip and imports it back', async () => {
    const { summary } = await saveProjectAsTemplate(store, await sampleProject(blobs), blobs, { name: 'Zip me', description: 'Shared', placeholders: [{ key: 'course', label: 'Course' }], mainFile: 'thesis.tex' });
    const loaded = await loadStored(store, summary, blobs);
    const { files, folders, skipped } = await templateZipEntries(loaded, blobs);
    expect(skipped).toEqual([]);
    const zip = await readZip(await createZip(files, folders));
    const imported = await templateFromZip('Zip me.template.zip', zip, new BlobStore());
    expect(imported.manifest).toMatchObject({ name: 'Zip me', description: 'Shared', mainFile: 'thesis.tex', placeholders: [{ key: 'course', label: 'Course' }] });
    expect(imported.content.files.map((file) => file.path).sort()).toEqual(['ch/one.tex', 'empty', 'figures/logo.png', 'thesis.tex']);
    const again = await saveContentAsTemplate(store, imported, blobs);
    expect((await loadStored(store, again, blobs)).content.mainPath).toBe('thesis.tex');
  });

  it('imports a zip of a folder without a template.json, named after the zip', async () => {
    const encoder = new TextEncoder();
    const zip = { files: [{ path: 'lab/main.tex', data: encoder.encode('\\documentclass{article}') }, { path: 'lab/refs.bib', data: encoder.encode('') }], folders: ['lab'] };
    const imported = await templateFromZip('lab-report_template.zip', zip, blobs);
    expect(imported.manifest).toMatchObject({ name: 'lab-report', placeholders: [] });
    expect(imported.content.mainPath).toBe('main.tex');
    expect(imported.content.files.map((file) => file.path).sort()).toEqual(['main.tex', 'refs.bib']);
    await expect(templateFromZip('x.zip', { files: [], folders: [] }, blobs)).rejects.toThrow('no files');
    await expect(templateFromZip('x.zip', { files: [{ path: 'a.png', data: new Uint8Array([1]) }], folders: [] }, blobs)).rejects.toThrow('no text files');
  });

  it('falls back to a bare manifest when template.json is broken', () => {
    const { manifest, content } = splitManifest({ name: 'n', files: [{ path: 'template.json', kind: 'text', text: '{nope' }, { path: 'a.tex', kind: 'text', text: '\\documentclass{x}' }] }, 'Name');
    expect(manifest).toMatchObject({ name: 'Name', placeholders: [] });
    expect(content.files).toHaveLength(1);
    expect(content.mainPath).toBe('a.tex');
  });
});

describe('built-in templates', () => {
  const profile = { ...emptyProfile(), name: 'Ada Lovelace', affiliation: 'Engines & Co', email: 'ada_l@example.org', address: '12 St James Sq\nLondon', orcid: '0000-0002-1825-0097' };

  it.each(BUILTIN_TEMPLATES.map((template) => [template.name, template] as const))('%s fills every placeholder and previews without errors', (_name, template) => {
    const loaded = loadBuiltin(template);
    const defs = placeholderDefs(loaded.manifest);
    const texts = loaded.content.files.map((file) => file.text ?? '');
    // Every placeholder it uses is one it can fill.
    for (const key of texts.flatMap(placeholdersIn)) expect(defs.map((def) => def.key)).toContain(key);
    const used = usedPlaceholders(texts, defs);
    const content = projectFromTemplate(loaded, defs, initialValues(used, profile, 'en-GB'), '');
    const files = new Map(content.files.filter((file) => file.kind === 'text').map((file) => [file.path, file.text!]));
    for (const value of files.values()) expect(value).not.toMatch(/\{\{\s*[A-Za-z]/);
    const result = projectToPreviewHtml({ mainPath: content.mainPath!, texts: files, binaryPaths: [], imageUrls: new Map() });
    expect(result.errors.filter((error) => error.severity === 'error')).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.html).toContain('Ada Lovelace');
  });

  it('uses only current packages', () => {
    const all = BUILTIN_TEMPLATES.flatMap((template) => template.files.map((file) => file.text)).join('\n');
    const loaded = [...all.matchAll(/^[^%\n]*\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/gm)].flatMap((match) => match[1].split(','));
    for (const obsolete of ['inputenc', 'epsfig', 'subfigure', 'subfig', 'times', 'mathptmx', 'a4wide', 'fullpage', 'physics', 'nth', 'wasysym', 'xparse', 'expl3', 'tocbibind']) {
      expect(loaded).not.toContain(obsolete);
    }
    expect(all).not.toMatch(/\\begin\{eqnarray|\\bf\b|\\it\b|usetikzlibrary\{[^}]*\barrows\b[,}]/);
    // hyperref comes before cleveref wherever both are loaded.
    for (const template of BUILTIN_TEMPLATES) {
      const main = template.files.find((file) => file.path === template.mainFile)!.text;
      if (main.includes('{cleveref}')) expect(main.indexOf('{hyperref}')).toBeLessThan(main.indexOf('{cleveref}'));
    }
  });

  it('escapes a profile full of special characters in every template', () => {
    for (const template of BUILTIN_TEMPLATES) {
      const loaded = loadBuiltin(template);
      const defs = placeholderDefs(loaded.manifest);
      const out = fillPlaceholders(template.files.find((file) => file.path === template.mainFile)!.text, defs, { name: '#$%&_{}~^\\', email: 'a_b%c@x', affiliation: 'A&B', language: 'british', paper: 'a4paper' });
      expect(out).not.toContain('#$%&_');
      if (out.includes('\\#\\$\\%\\&\\_')) expect(out).toContain('\\#\\$\\%\\&\\_\\{\\}\\textasciitilde{}\\textasciicircum{}\\textbackslash{}');
    }
  });
});
