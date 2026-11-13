// Saving, loading and sharing templates (#74). A template is a project folder with a template.json
// in it: in this browser it's a project row marked as a template (localAppStorage.ts), and in Google
// Drive it's a folder in the Templates folder (driveTemplates.ts). Either way its files are read and
// written through the storage provider, so editing a template works like editing a project.
import type { BlobStore } from '../project/blobStore';
import type { EntryKind, ProjectContent, ProjectDoc } from '../project/projectDoc';
import { contentFromFiles, loadProject } from '../project/projectIo';
import { dirname, guessMainFile, isTextPath, normalizePath } from '../project/paths';
import type { ZipEntry } from '../project/zip';
import type { ProjectSummary, StorageProvider } from '../storage/providers/types';
import type { BuiltinTemplate } from './builtinTemplates';
import { fillPlaceholders, parseManifest, serializeManifest, TEMPLATE_FILE, type PlaceholderDef, type TemplateManifest } from './placeholders';

export type TemplateSource = 'builtin' | 'local' | 'drive';

/** Where saved templates live: this browser, or Google Drive. */
export type TemplateStore = {
  source: Exclude<TemplateSource, 'builtin'>;
  /** Shown in the picker, like "In this browser". */
  label: string;
  provider: StorageProvider;
  list(): Promise<ProjectSummary[]>;
  create(name: string): Promise<ProjectSummary>;
  remove(id: string): Promise<void>;
};

export type TemplateSummary = { source: TemplateSource; id: string; name: string; description?: string; updatedAt?: number };

/** A template's files, with its template.json read and taken out of them. */
export type LoadedTemplate = { summary: TemplateSummary; manifest: TemplateManifest; content: ProjectContent };

const encoder = new TextEncoder();

/** The folders that hold the given paths, so a project made from files has its folders too. */
function parentFolders(paths: string[]): string[] {
  const folders = new Set<string>();
  for (const path of paths) {
    for (let dir = dirname(path); dir; dir = dirname(dir)) folders.add(dir);
  }
  return [...folders].sort();
}

export function builtinSummary(template: BuiltinTemplate): TemplateSummary {
  return { source: 'builtin', id: template.id, name: template.name, description: template.description };
}

export function loadBuiltin(template: BuiltinTemplate): LoadedTemplate {
  const files: ProjectContent['files'] = [
    ...parentFolders(template.files.map((file) => file.path)).map((path) => ({ path, kind: 'folder' as EntryKind })),
    ...template.files.map((file) => ({ path: file.path, kind: 'text' as EntryKind, text: file.text })),
  ];
  return {
    summary: builtinSummary(template),
    manifest: { format: 'latex-editor-template', version: 1, name: template.name, description: template.description, mainFile: template.mainFile, placeholders: template.placeholders },
    content: { name: template.name, mainPath: template.mainFile, files },
  };
}

/** Take template.json out of loaded files and read it. A missing or broken one gives a bare manifest. */
export function splitManifest(content: ProjectContent, name: string): { manifest: TemplateManifest; content: ProjectContent } {
  const file = content.files.find((entry) => entry.path === TEMPLATE_FILE && entry.kind === 'text');
  const manifest = (file?.text && parseManifest(file.text, name)) || { format: 'latex-editor-template', version: 1, name, description: '', placeholders: [] };
  const files = content.files.filter((entry) => entry !== file);
  const textFiles = files.filter((entry) => entry.kind === 'text');
  const wanted = manifest.mainFile ?? content.mainPath;
  const mainPath = wanted && textFiles.some((entry) => entry.path === wanted) ? wanted : guessMainFile(textFiles);
  return { manifest, content: { name, mainPath, files } };
}

/** Load a saved template: every file, its template.json, and binary files into the blob store. */
export async function loadStored(store: TemplateStore, summary: ProjectSummary, blobs: BlobStore): Promise<LoadedTemplate> {
  const loaded = await loadProject(store.provider, summary.id, blobs);
  // The stored name wins over template.json's, since Rename changes the stored one first.
  const name = loaded.name || summary.name;
  const { manifest, content } = splitManifest(loaded, name);
  return { summary: { source: store.source, id: summary.id, name, description: manifest.description, updatedAt: summary.updatedAt }, manifest: { ...manifest, name }, content };
}

/** A new project from a template, with placeholders filled in. It has no stored id until its first save. */
export function projectFromTemplate(template: LoadedTemplate, defs: PlaceholderDef[], values: Record<string, string>, projectName: string): ProjectContent {
  return {
    name: projectName,
    mainPath: template.content.mainPath,
    files: template.content.files.map((file) => (file.kind === 'text' && file.text ? { ...file, text: fillPlaceholders(file.text, defs, values) } : { ...file })),
  };
}

/** What Save as Template writes, besides the files. */
export type TemplateDetails = { name: string; description: string; placeholders: PlaceholderDef[]; mainFile?: string };

type FileToSave = { path: string; kind: EntryKind; data?: Uint8Array };

/** Write a template's files and its template.json into a new stored template. Removes the half-made template if a write fails. */
async function writeTemplate(store: TemplateStore, details: TemplateDetails, files: FileToSave[]): Promise<ProjectSummary> {
  const summary = await store.create(details.name);
  const { provider } = store;
  try {
    await provider.writeFile(summary.id, TEMPLATE_FILE, serializeManifest(details));
    const filePaths = files.filter((file) => file.kind !== 'folder').map((file) => file.path);
    for (const file of files) {
      if (file.kind === 'folder') {
        // Only empty folders need making. writeFile makes the rest.
        if (!filePaths.some((path) => path.startsWith(`${file.path}/`))) await provider.createFolder(summary.id, file.path);
      } else if (file.data) {
        await provider.writeFile(summary.id, file.path, file.data);
      }
    }
    if (details.mainFile) await provider.setMainFile(summary.id, details.mainFile);
  } catch (error) {
    await store.remove(summary.id).catch(() => undefined);
    throw error;
  }
  return summary;
}

/**
 * Save the open project as a new template: every file and folder, plus a template.json. A
 * template.json already in the project (when you're editing a template) is replaced by the new one.
 * `transform` can change each text file on the way, like turning profile values into placeholders.
 * Binary files still on their way from a peer are left out, and their paths returned.
 */
export async function saveProjectAsTemplate(
  store: TemplateStore,
  project: Pick<ProjectDoc, 'entries' | 'getText'>,
  blobs: Pick<BlobStore, 'get'>,
  details: TemplateDetails,
  transform: (text: string) => string = (text) => text,
): Promise<{ summary: ProjectSummary; skipped: string[] }> {
  const files: FileToSave[] = [];
  const skipped: string[] = [];
  for (const entry of project.entries()) {
    if (entry.path === TEMPLATE_FILE) continue;
    if (entry.kind === 'folder') files.push({ path: entry.path, kind: 'folder' });
    else if (entry.kind === 'text') files.push({ path: entry.path, kind: 'text', data: encoder.encode(transform(project.getText(entry.id).toString())) });
    else {
      const data = entry.hash ? await blobs.get(entry.hash) : undefined;
      if (data) files.push({ path: entry.path, kind: 'binary', data });
      else skipped.push(entry.path);
    }
  }
  return { summary: await writeTemplate(store, details, files), skipped };
}

/** Save loaded template content (from a .zip, or a built-in one) as a new stored template. */
export async function saveContentAsTemplate(store: TemplateStore, template: Pick<LoadedTemplate, 'manifest' | 'content'>, blobs: Pick<BlobStore, 'get'>): Promise<ProjectSummary> {
  const files: FileToSave[] = [];
  for (const file of template.content.files) {
    if (file.kind === 'folder') files.push({ path: file.path, kind: 'folder' });
    else if (file.kind === 'text') files.push({ path: file.path, kind: 'text', data: encoder.encode(file.text ?? '') });
    else if (file.hash) {
      const data = await blobs.get(file.hash);
      if (data) files.push({ path: file.path, kind: 'binary', data });
    }
  }
  const { name, description, placeholders } = template.manifest;
  return writeTemplate(store, { name, description, placeholders, mainFile: template.content.mainPath ?? undefined }, files);
}

/** Rename a saved template: its folder or row, and the name in its template.json. */
export async function renameTemplate(store: TemplateStore, id: string, name: string): Promise<void> {
  await store.provider.renameProject(id, name);
  const listing = await store.provider.openProject(id);
  const manifest = listing.entries.some((entry) => entry.path === TEMPLATE_FILE && entry.kind === 'file')
    ? parseManifest(new TextDecoder().decode(await store.provider.readFile(id, TEMPLATE_FILE)), name)
    : null;
  const next = manifest ?? { name, description: '', placeholders: [] };
  await store.provider.writeFile(id, TEMPLATE_FILE, serializeManifest({ ...next, name }));
}

/** The files of a template as zip entries, with its template.json, for sharing. */
export async function templateZipEntries(template: LoadedTemplate, blobs: Pick<BlobStore, 'get'>): Promise<{ files: ZipEntry[]; folders: string[]; skipped: string[] }> {
  const files: ZipEntry[] = [{ path: TEMPLATE_FILE, data: encoder.encode(serializeManifest({ ...template.manifest, mainFile: template.content.mainPath ?? undefined })) }];
  const skipped: string[] = [];
  const folders: string[] = [];
  for (const file of template.content.files) {
    if (file.kind === 'folder') folders.push(file.path);
    else if (file.kind === 'text') files.push({ path: file.path, data: encoder.encode(file.text ?? '') });
    else {
      const data = file.hash ? await blobs.get(file.hash) : undefined;
      if (data) files.push({ path: file.path, data });
      else skipped.push(file.path);
    }
  }
  return { files, folders, skipped };
}

/**
 * Read a template .zip. When everything sits in one top folder (as zipping a folder by hand does),
 * that folder is taken off. Without a template.json, the zip's name names the template.
 */
export async function templateFromZip(
  fileName: string,
  zip: { files: { path: string; data: Uint8Array }[]; folders: string[] },
  blobs: BlobStore,
): Promise<Pick<LoadedTemplate, 'manifest' | 'content'>> {
  if (!zip.files.length) throw new Error('That .zip has no files in it.');
  let { files, folders } = zip;
  const tops = new Set(files.map((file) => file.path.split('/')[0]));
  const [top] = tops;
  if (tops.size === 1 && files.every((file) => file.path.includes('/')) && !files.some((file) => file.path === TEMPLATE_FILE)) {
    const strip = (path: string) => path.slice(top.length + 1);
    files = files.map((file) => ({ ...file, path: strip(file.path) }));
    folders = folders.filter((path) => path !== top && path.startsWith(`${top}/`)).map(strip);
  }
  const fallback = fileName.replace(/\.zip$/i, '').replace(/[-_. ]?template$/i, '') || 'Imported template';
  const content = await contentFromFiles(fallback, files.filter((file) => normalizePath(file.path)), folders, blobs);
  const { manifest, content: rest } = splitManifest(content, fallback);
  if (!rest.files.some((file) => file.kind === 'text' && isTextPath(file.path))) throw new Error('That .zip has no text files, so it is not a LaTeX template.');
  return { manifest, content: { ...rest, name: manifest.name } };
}
