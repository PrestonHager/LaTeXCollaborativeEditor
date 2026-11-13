import { serveCompiles } from './compile.worker';
import { MAIN_THREAD_COMPILE_KEY, type CompileRequest, type CompileResponse } from './compileProtocol';
import { installDomShim } from './domShim';
import type { ProjectPreviewInput } from './latexJsPreview';

/** A pretend worker scope that keeps what the worker posts. */
function fakeScope() {
  const posted: CompileResponse[] = [];
  const scope = {
    onmessage: null as unknown,
    postMessage: (message: CompileResponse) => posted.push(message),
    send(request: CompileRequest) {
      (scope.onmessage as (event: MessageEvent<CompileRequest>) => void)({ data: request } as MessageEvent<CompileRequest>);
    },
  };
  return { scope, posted };
}

describe('compile worker', () => {
  it('leaves its compiler on globalThis when loaded outside a worker', () => {
    expect(typeof (globalThis as Record<string, unknown>)[MAIN_THREAD_COMPILE_KEY]).toBe('function');
  });

  it('answers a compile request with the result', () => {
    const { scope, posted } = fakeScope();
    serveCompiles(scope);
    const input: ProjectPreviewInput = {
      mainPath: 'main.tex',
      texts: new Map([['main.tex', '\\documentclass{article}\\begin{document}Worker\\end{document}']]),
      binaryPaths: [],
      imageUrls: new Map(),
    };
    scope.send({ id: 7, input });
    expect(posted).toHaveLength(1);
    expect(posted[0].id).toBe(7);
    expect('result' in posted[0] && posted[0].result.html).toContain('Worker');
  });

  it('answers with an error when the compile throws', () => {
    const { scope, posted } = fakeScope();
    serveCompiles(scope);
    scope.send({ id: 3, input: { mainPath: 'main.tex' } as ProjectPreviewInput });
    expect(posted[0]).toMatchObject({ id: 3, error: expect.any(String) });
  });
});

describe('installDomShim', () => {
  it('adds a document and window only when there is no DOM', () => {
    const empty: { document?: unknown; window?: unknown } = {};
    installDomShim(empty);
    expect(empty.document).toBeTruthy();
    expect((empty.window as { document: unknown }).document).toBe(empty.document);
    const real = { document: document };
    installDomShim(real);
    expect(real.document).toBe(document);
  });
});
