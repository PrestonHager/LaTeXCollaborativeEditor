import * as Y from 'yjs';
import { ProjectDoc } from '../project/projectDoc';
import { compiledSourceKey, lastCompiledPdf, setLastCompiledPdf } from '../compile/pdf/lastCompiledPdf';
import { compiledPdfExporter } from './pdfExporters';
import type { ExportRun, ExportSource } from './types';

function source() {
  const project = new ProjectDoc(new Y.Doc());
  const main = project.createTextFile('main.tex', '\\documentclass{article}');
  project.putBinaryFile('a.png', 'h1', 1);
  const src: ExportSource = { project, blobs: { get: async () => undefined, has: () => false }, name: 'Thesis', activePath: null };
  return { project, main, src };
}

const run = (): ExportRun => ({ signal: new AbortController().signal, onProgress: vi.fn(), services: {} as ExportRun['services'] });

describe('Compile PDF export (#242)', () => {
  afterEach(() => setLastCompiledPdf(null));

  it('is only offered after Compile PDF, and warns when the project changed since', async () => {
    const { project, main, src } = source();
    expect(compiledPdfExporter.available(src)).toEqual({ ok: false, reason: expect.stringContaining('Compile PDF first') });
    await expect(compiledPdfExporter.run(src, {}, run())).rejects.toThrow('Compile PDF first');
    setLastCompiledPdf({ bytes: new Uint8Array([37, 80]), sourceKey: compiledSourceKey(project, 'main.tex'), mainPath: 'main.tex', engine: 'pdflatex', madeAt: 1 });
    expect(compiledPdfExporter.available(src)).toEqual({ ok: true });
    expect(compiledPdfExporter.options(src)).toEqual([]);
    project.getText(main).insert(0, '% edit\n');
    expect(compiledPdfExporter.available(src)).toMatchObject({ ok: true, warning: expect.stringContaining('changed') });
    const out = await compiledPdfExporter.run(src, {}, run());
    expect(out.files[0].name).toBe('Thesis.pdf');
    expect(out.files[0].data.type).toBe('application/pdf');
    expect(lastCompiledPdf()?.engine).toBe('pdflatex');
  });

  it('keys the source by paths, text and binary hashes', () => {
    const { project } = source();
    const before = compiledSourceKey(project, 'main.tex');
    project.putBinaryFile('b.png', 'h2', 1);
    expect(compiledSourceKey(project, 'main.tex')).not.toBe(before);
    expect(compiledSourceKey(project, 'other.tex')).not.toBe(compiledSourceKey(project, 'main.tex'));
  });
});
