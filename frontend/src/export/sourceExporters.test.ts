import * as Y from 'yjs';
import { BlobStore } from '../project/blobStore';
import { ProjectDoc } from '../project/projectDoc';
import { projectFromZip } from '../project/projectIo';
import { flattenedTexExporter, projectZipExporter, singleFileExporter, stripComments, unsyncedFiles } from './sourceExporters';
import { defaultOptions, safeFileName, type ExportRun, type ExportSource } from './types';

const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
const text = async (blob: Blob) => new TextDecoder().decode(await bytes(blob));

function setup() {
  const project = new ProjectDoc(new Y.Doc());
  const blobs = new BlobStore();
  const source: ExportSource = { project, blobs, name: 'My Paper', activePath: null };
  const run: ExportRun = {
    signal: new AbortController().signal,
    onProgress: vi.fn(),
    services: { compile: vi.fn(), fetch: vi.fn(), print: vi.fn() },
  };
  return { project, blobs, source, run };
}

describe('source exporters', () => {
  it('makes safe file names from the project name', () => {
    expect(safeFileName('My Paper', '.zip')).toBe('My Paper.zip');
    expect(safeFileName('a/b:c?', '.tex')).toBe('a-b-c-.tex');
    expect(safeFileName(' .. ', '.zip')).toBe('project.zip');
  });

  it('zips the project, keeps empty folders, and round trips through import', async () => {
    const { project, blobs, source, run } = setup();
    expect(projectZipExporter.available(source)).toEqual({ ok: false, reason: expect.any(String) });
    project.createTextFile('main.tex', '\\documentclass{article}');
    project.createFolder('figures');
    const hash = await blobs.put(new Uint8Array([1, 2, 3]));
    project.putBinaryFile('img/a.png', hash, 3);
    expect(projectZipExporter.available(source)).toEqual({ ok: true });

    const output = await projectZipExporter.run(source, {}, run);
    expect(output.warnings).toEqual([]);
    expect(output.files[0].name).toBe('My Paper.zip');
    const content = await projectFromZip(output.files[0].name, await bytes(output.files[0].data), new BlobStore());
    expect(content.files.map((file) => [file.path, file.kind]).sort()).toEqual([
      ['figures', 'folder'],
      ['img/a.png', 'binary'],
      ['main.tex', 'text'],
    ]);
  });

  it('warns about files that have not synced yet, before and after the zip', async () => {
    const { project, source, run } = setup();
    project.createTextFile('main.tex', 'x');
    project.putBinaryFile('fig.png', 'not-here', 3);
    expect(unsyncedFiles(source)).toEqual(['fig.png']);
    expect(projectZipExporter.available(source)).toEqual({ ok: true, warning: expect.stringContaining("1 file hasn't finished syncing") });
    const output = await projectZipExporter.run(source, {}, run);
    expect(output.warnings[0]).toContain('fig.png');
  });

  it('exports one file, defaulting to the open one, then the main one', async () => {
    const { project, blobs, source, run } = setup();
    expect(singleFileExporter.available(source).ok).toBe(false);
    project.createTextFile('main.tex', 'hello');
    project.createTextFile('ch/one.tex', 'one');
    const hash = await blobs.put(new Uint8Array([9]));
    project.putBinaryFile('a.png', hash, 1);
    project.putBinaryFile('late.png', 'not-here', 1);
    project.createFolder('empty');

    const [fileOption] = singleFileExporter.options(source);
    expect(fileOption.kind === 'select' && fileOption.choices.map((choice) => choice.value)).not.toContain('empty');
    expect(fileOption.default).toBe('main.tex');
    expect(singleFileExporter.options({ ...source, activePath: 'ch/one.tex' })[0].default).toBe('ch/one.tex');

    const textOut = await singleFileExporter.run(source, { path: 'ch/one.tex' }, run);
    expect(textOut.files[0].name).toBe('one.tex');
    expect(await text(textOut.files[0].data)).toBe('one');
    const binOut = await singleFileExporter.run(source, { path: 'a.png' }, run);
    expect(binOut.files[0].data.type).toBe('image/png');
    expect(Array.from(await bytes(binOut.files[0].data))).toEqual([9]);
    await expect(singleFileExporter.run(source, { path: 'late.png' }, run)).rejects.toThrow("hasn't arrived");
    await expect(singleFileExporter.run(source, { path: 'gone.tex' }, run)).rejects.toThrow("isn't in the project");
  });

  it('flattens \\input and \\include into one file', async () => {
    const { project, source, run } = setup();
    expect(flattenedTexExporter.available(source).ok).toBe(false);
    project.createTextFile('paper.tex', '\\begin{document}\n\\input{sections/intro}\n\\include{ch2} % two\n\\input{nope}\n\\end{document}');
    project.createTextFile('sections/intro.tex', 'Intro % note\n% whole line\ntext');
    project.createTextFile('ch2.tex', 'Chapter two');
    project.setMainFile(project.findByPath('paper.tex')!.id);
    expect(flattenedTexExporter.available(source).ok).toBe(true);

    const output = await flattenedTexExporter.run(source, defaultOptions(flattenedTexExporter.options(source)), run);
    expect(output.files[0].name).toBe('paper-flat.tex');
    expect(await text(output.files[0].data)).toBe(
      '\\begin{document}\nIntro % note\n% whole line\ntext\n\\clearpage\nChapter two\n\\clearpage  % two\n\\input{nope}\n\\end{document}',
    );
    expect(output.warnings).toEqual(['Not found in the project, so left as they were: nope.']);

    const stripped = await flattenedTexExporter.run(source, { stripComments: true }, run);
    expect(await text(stripped.files[0].data)).toContain('Intro %\ntext');
    expect(await text(stripped.files[0].data)).not.toContain('whole line');
  });

  it('strips comments but keeps \\%, \\verb and verbatim blocks', () => {
    expect(stripComments('a 50\\% b % c\n  % gone\nd')).toBe('a 50\\% b %\nd');
    expect(stripComments('\\verb|%x| y % z')).toBe('\\verb|%x| y %');
    expect(stripComments('line\\\\% c')).toBe('line\\\\%');
    expect(stripComments('\\begin{verbatim}\n% kept\n\\end{verbatim}\n% gone')).toBe('\\begin{verbatim}\n% kept\n\\end{verbatim}');
    expect(stripComments('\\verb|open')).toBe('\\verb|open');
  });
});
