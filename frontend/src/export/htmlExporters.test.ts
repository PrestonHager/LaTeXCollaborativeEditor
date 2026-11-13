import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { BlobStore } from '../project/blobStore';
import { ProjectDoc } from '../project/projectDoc';
import { LATEX_JS_ASSET_BASE, projectToPreviewHtml, type ProjectPreviewInput } from '../compile/latexJsPreview';
import { htmlExporter, inlineStylesheet, previewPdfExporter, printCss, standaloneDocument } from './htmlExporters';
import { defaultOptions, type ExportRun, type ExportServices, type ExportSource } from './types';

const CSS = {
  [`${LATEX_JS_ASSET_BASE}css/article.css`]: '/* c */ @import url("base.css");\n.article{color:red}',
  [`${LATEX_JS_ASSET_BASE}css/base.css`]: '@import "../fonts/cmu.css"; .body{margin:0}',
  [`${LATEX_JS_ASSET_BASE}fonts/cmu.css`]: "@font-face{font-family:X;src:url('a.woff') format('woff')} .y{background:url(data:image/png;base64,AA==)}",
  [`${LATEX_JS_ASSET_BASE}css/katex.css`]: "@font-face{font-family:K;src:url('../fonts/a.woff')}",
};

function fakeFetch(failing = false): ExportServices['fetch'] {
  return vi.fn(async (url: string) => {
    if (failing) return new Response('nope', { status: 503 });
    if (url.endsWith('.woff')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'font/woff' } });
    const css = CSS[url as keyof typeof CSS];
    return css === undefined ? new Response('missing', { status: 404 }) : new Response(css, { headers: { 'content-type': 'text/css' } });
  });
}

function setup(texts: Record<string, string> = { 'main.tex': '\\documentclass{article}\\begin{document}Hello\n\\newpage\nWorld\\end{document}' }) {
  const project = new ProjectDoc(new Y.Doc());
  for (const [path, text] of Object.entries(texts)) project.createTextFile(path, text);
  const main = project.findByPath('main.tex');
  if (main) project.setMainFile(main.id);
  const blobs = new BlobStore();
  const source: ExportSource = { project, blobs, name: 'Paper', activePath: null };
  const compile = vi.fn(async (input: ProjectPreviewInput) => projectToPreviewHtml(input));
  const print = vi.fn(async (_html: string, _signal: AbortSignal) => {});
  const controller = new AbortController();
  const run: ExportRun = { signal: controller.signal, onProgress: vi.fn(), services: { compile, fetch: fakeFetch(), print } };
  return { project, blobs, source, run, compile, print, controller };
}

const text = async (blob: Blob) => new TextDecoder().decode(await blob.arrayBuffer());

describe('HTML and PDF exporters', () => {
  it('makes a standalone document: no scripts, base, or preview note, and light colors', () => {
    const doc = standaloneDocument(
      '<html><head><base href="x/"><script src="s.js"></script></head><body><details class="lc-preview-note">n</details><p>Hi</p></body></html>',
      'My doc',
    );
    expect(doc.querySelector('script, base, .lc-preview-note')).toBeNull();
    expect(doc.title).toBe('My doc');
    expect(doc.getElementById('lc-preview-theme')?.textContent).toContain('color-scheme:light');
  });

  it('inlines imports and fonts, once each, and leaves data: URLs alone', async () => {
    const { run } = setup();
    const css = await inlineStylesheet(`${LATEX_JS_ASSET_BASE}css/article.css`, run);
    expect(css).not.toContain('@import');
    expect(css).not.toContain('/* c */');
    expect(css).toContain('.article{color:red}');
    expect(css).toContain('url("data:font/woff;base64,AQID")');
    expect(css).toContain('url(data:image/png;base64,AA==)');
    expect(run.services.fetch).toHaveBeenCalledWith(`${LATEX_JS_ASSET_BASE}fonts/a.woff`, run.signal);
  });

  it('exports HTML with images inside and styles bundled for offline use', async () => {
    const { blobs, project, source, run, compile } = setup({
      'main.tex': '\\documentclass{article}\\usepackage{graphicx}\\begin{document}Hello\n\\newpage\nWorld\\includegraphics{a.png}\\includegraphics{b.png}\\end{document}',
    });
    const hash = await blobs.put(new Uint8Array([137, 80]));
    project.putBinaryFile('a.png', hash, 2);
    project.putBinaryFile('b.png', 'not-here', 2);
    expect(htmlExporter.available(source).ok).toBe(true);

    const output = await htmlExporter.run(source, defaultOptions(htmlExporter.options(source)), run);
    expect(compile.mock.calls[0][0].imageUrls.get('a.png')).toBe('data:image/png;base64,iVA=');
    expect(output.files[0].name).toBe('Paper.html');
    const html = await text(output.files[0].data);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<title>Paper</title>');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('<script');
    expect(html).toContain('data:font/woff;base64');
    expect(html).toContain('src="data:image/png;base64,iVA="');
    expect(html).toContain('class="lc-page-break"');
    expect(output.warnings).toEqual([expect.stringContaining('b.png')]);
  });

  it('keeps the CDN links and says so when the styles fail to download', async () => {
    const { source, run } = setup();
    run.services.fetch = fakeFetch(true);
    const output = await htmlExporter.run(source, { offline: true }, run);
    expect(await text(output.files[0].data)).toContain(`<link type="text/css" rel="stylesheet" href="${LATEX_JS_ASSET_BASE}css/katex.css">`);
    expect(output.warnings).toEqual([expect.stringContaining("Couldn't download the styles")]);
    const online = await htmlExporter.run(source, { offline: false }, { ...run, services: { ...run.services, fetch: vi.fn() } });
    expect(online.warnings).toEqual([]);
  });

  it('needs a main file and reports compile errors instead of making a broken file', async () => {
    const empty = setup({});
    expect(htmlExporter.available(empty.source).ok).toBe(false);
    expect(previewPdfExporter.available(empty.source).ok).toBe(false);
    await expect(htmlExporter.run(empty.source, {}, empty.run)).rejects.toThrow('no main');

    const broken = setup({ 'main.tex': '\\documentclass{article}\\begin{document}\\badmacro\\end{document}' });
    await expect(htmlExporter.run(broken.source, {}, broken.run)).rejects.toThrow(/errors.*main\.tex line 1/);

    const silent = setup();
    silent.run.services.compile = vi.fn(async () => ({ html: null, errors: [], missing: [], changes: [] }));
    await expect(htmlExporter.run(silent.source, {}, silent.run)).rejects.toThrow("nothing to export. Fix");
  });

  it('notes files the document asks for that are not in the project', async () => {
    const { source, run } = setup({ 'main.tex': '\\documentclass{article}\\begin{document}\\input{gone}x\\end{document}' });
    const output = await htmlExporter.run(source, { offline: false }, run);
    expect(output.warnings).toEqual(['Not found in the project: gone.']);
  });

  it('prints a preview-quality PDF with print styles for the paper size', async () => {
    const { source, run, print } = setup();
    expect(previewPdfExporter.quality).toBe('preview');
    const output = await previewPdfExporter.run(source, defaultOptions(previewPdfExporter.options(source)), run);
    expect(output.files).toEqual([]);
    expect(output.message).toContain('Save as PDF');
    const html = print.mock.calls[0][0];
    expect(html).toContain('@page{size:A4;');
    expect(html).toContain('break-after:page');
    expect(html).not.toContain('<script');
    await previewPdfExporter.run(source, { paper: 'letter' }, run);
    expect(print.mock.calls[1][0]).toContain('@page{size:letter;');
    expect(printCss('A4')).toContain('--textwidth:100%!important');
  });

  it('stops when canceled', async () => {
    const { source, run, controller, blobs, project } = setup();
    project.putBinaryFile('a.png', await blobs.put(new Uint8Array([1])), 1);
    controller.abort();
    await expect(htmlExporter.run(source, {}, run)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
