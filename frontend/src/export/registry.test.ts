import { exporters, findExporter, runExport, type ExportDestination } from './registry';
import { createBrowserExportServices, isBundleableAsset, printHtml, PRINT_FRAME_SANDBOX } from './browserServices';
import { LATEX_JS_ASSET_BASE } from '../compile/latexJsPreview';
import { defaultOptions, isAbortError, type Exporter, type ExportRun, type ExportSource } from './types';

const source = {} as ExportSource;
const run = (signal = new AbortController().signal): ExportRun => ({ signal, onProgress: vi.fn(), services: { compile: vi.fn(), fetch: vi.fn(), print: vi.fn() } });

describe('exporter registry', () => {
  it('lists each format once, with what the dialog needs', () => {
    const ids = exporters.map((exporter) => exporter.id);
    expect(ids).toEqual(['zip', 'pdf-preview', 'html', 'flat-tex', 'file']);
    expect(new Set(ids).size).toBe(ids.length);
    for (const exporter of exporters) {
      expect(exporter.label).toBeTruthy();
      expect(exporter.description).toBeTruthy();
      expect(exporter.icon).toBeTruthy();
    }
    expect(findExporter('html')?.label).toBe('HTML');
    expect(findExporter('nope')).toBeUndefined();
  });

  it('runs an exporter and saves each file it makes', async () => {
    const file = { name: 'a.txt', data: new Blob(['a']) };
    const exporter: Exporter = {
      id: 'x',
      label: 'X',
      description: 'd',
      icon: 'file-text',
      fileExtension: '.txt',
      available: () => ({ ok: true }),
      options: () => [{ id: 'flag', kind: 'checkbox', label: 'Flag', default: true }],
      run: vi.fn(async () => ({ files: [file], warnings: [] })),
    };
    const destination: ExportDestination = { id: 'd', label: 'D', save: vi.fn() };
    const progress = run();
    const output = await runExport(exporter, source, defaultOptions(exporter.options(source)), progress, destination);
    expect(exporter.run).toHaveBeenCalledWith(source, { flag: true }, progress);
    expect(destination.save).toHaveBeenCalledWith(file);
    expect(output.files).toEqual([file]);
    expect(progress.onProgress).toHaveBeenLastCalledWith(1, 'Done');

    await expect(runExport({ ...exporter, available: () => ({ ok: false, reason: 'Not now' }) }, source, {}, run(), destination)).rejects.toThrow('Not now');

    // A cancel that lands after the exporter finished still saves nothing.
    const controller = new AbortController();
    const late: Exporter = { ...exporter, run: async () => (controller.abort(), { files: [file], warnings: [] }) };
    const save = vi.fn();
    await expect(runExport(late, source, {}, run(controller.signal), { ...destination, save })).rejects.toSatisfy(isAbortError);
    expect(save).not.toHaveBeenCalled();
  });
});

/** A print frame with a stand-in window, since jsdom can't print and swaps the window when srcdoc loads. */
function fakeFrame(print: () => void, doc: unknown = null) {
  const frame = document.createElement('iframe');
  const win = Object.assign(new EventTarget(), { print, focus: vi.fn() });
  Object.defineProperty(frame, 'contentWindow', { value: win, configurable: true });
  Object.defineProperty(frame, 'contentDocument', { value: doc, configurable: true });
  return { frame, win };
}

describe('browser export services', () => {
  it('only fetches the LaTeX.js assets', async () => {
    expect(isBundleableAsset(`${LATEX_JS_ASSET_BASE}css/base.css`)).toBe(true);
    expect(isBundleableAsset('https://example.com/x.css')).toBe(false);
    const services = createBrowserExportServices();
    await expect(services.fetch('https://example.com/x.css', new AbortController().signal)).rejects.toThrow("preview's own styles");
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('css'));
    try {
      await services.fetch(`${LATEX_JS_ASSET_BASE}css/base.css`, new AbortController().signal);
      expect(fetchSpy).toHaveBeenCalledWith(`${LATEX_JS_ASSET_BASE}css/base.css`, expect.objectContaining({ credentials: 'omit' }));
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('does not compile after a cancel', async () => {
    const services = createBrowserExportServices();
    const controller = new AbortController();
    controller.abort();
    await expect(services.compile({ mainPath: 'm.tex', texts: new Map(), binaryPaths: [], imageUrls: new Map() }, controller.signal)).rejects.toSatisfy(isAbortError);
  });

  it('prints from a hidden sandboxed frame with no scripts, then removes it', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const print = vi.fn();
    const { frame, win } = fakeFrame(print);
    const done = printHtml('<p>Hi</p>', new AbortController().signal, root, () => frame);
    expect(frame.getAttribute('sandbox')).toBe(PRINT_FRAME_SANDBOX);
    expect(PRINT_FRAME_SANDBOX).not.toContain('allow-scripts');
    expect(frame.srcdoc).toBe('<p>Hi</p>');
    frame.dispatchEvent(new Event('load'));
    await done;
    expect(print).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event('afterprint'));
    await vi.waitFor(() => expect(root.querySelector('iframe')).toBeNull());
    root.remove();
  });

  it('drops the print frame when canceled', async () => {
    const root = document.createElement('div');
    const controller = new AbortController();
    const done = printHtml('<p>Hi</p>', controller.signal, root);
    controller.abort();
    await expect(done).rejects.toSatisfy(isAbortError);
    expect(root.querySelector('iframe')).toBeNull();
    await expect(printHtml('x', controller.signal, root)).rejects.toSatisfy(isAbortError);
  });

  it('reports a print that throws', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const { frame } = fakeFrame(() => {
      throw new Error('blocked');
    });
    const done = printHtml('<p>Hi</p>', new AbortController().signal, root, () => frame);
    frame.dispatchEvent(new Event('load'));
    await expect(done).rejects.toThrow('blocked');
    expect(root.querySelector('iframe')).toBeNull();
    root.remove();
  });
});
