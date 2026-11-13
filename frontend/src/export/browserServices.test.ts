import { createBrowserExportServices, printHtml } from './browserServices';
import { isAbortError } from './types';


const scheduler = vi.hoisted(() => ({ compile: vi.fn(), cancel: vi.fn() }));
vi.mock('../compile/compileScheduler', () => ({
  CompileScheduler: vi.fn(function CompileScheduler() {
    return scheduler;
  }),
}));

const input = { mainPath: 'main.tex', texts: new Map([['main.tex', 'x']]), binaryPaths: [], imageUrls: new Map() };

describe('export compile service', () => {
  it('compiles in its own scheduler, and cancels it on abort', async () => {
    const services = createBrowserExportServices();
    const result = { html: '<p>x</p>', errors: [], missing: [], changes: [] };
    scheduler.compile.mockResolvedValueOnce(result);
    expect(await services.compile(input, new AbortController().signal)).toBe(result);

    const controller = new AbortController();
    let finish: (value: null) => void = () => {};
    scheduler.compile.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const pending = services.compile(input, controller.signal);
    controller.abort();
    expect(scheduler.cancel).toHaveBeenCalledTimes(1);
    // A replaced compile resolves to null, which counts as canceled.
    finish(null);
    await expect(pending).rejects.toSatisfy(isAbortError);
  });

  it('waits for fonts before printing', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const print = vi.fn();
    let fontsReady: (value?: unknown) => void = () => {};
    const frame = document.createElement('iframe');
    Object.defineProperty(frame, 'contentWindow', { value: Object.assign(new EventTarget(), { print, focus: vi.fn() }), configurable: true });
    Object.defineProperty(frame, 'contentDocument', { value: { fonts: { ready: new Promise((resolve) => (fontsReady = resolve)) } }, configurable: true });
    const done = printHtml('<p>x</p>', new AbortController().signal, root, () => frame);
    frame.dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(print).not.toHaveBeenCalled();
    fontsReady();
    await done;
    expect(print).toHaveBeenCalledTimes(1);
    root.remove();
  });
});
