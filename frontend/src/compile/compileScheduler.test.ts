import { CompileScheduler, collectImageUrls, compileOnMainThread, needsMainThread, type CompileWorker } from './compileScheduler';
import type { CompileRequest, CompileResponse } from './compileProtocol';
import type { ProjectPreviewInput, ProjectPreviewResult } from './latexJsPreview';

class FakeWorker implements CompileWorker {
  onmessage: CompileWorker['onmessage'] = null;
  onerror: CompileWorker['onerror'] = null;
  posted: CompileRequest[] = [];
  terminated = false;

  postMessage(message: CompileRequest) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  reply(response: CompileResponse) {
    this.onmessage?.({ data: response } as MessageEvent<CompileResponse>);
  }

  crash() {
    this.onerror?.({ preventDefault: () => undefined } as ErrorEvent);
  }
}

const input = (text = 'Hi'): ProjectPreviewInput => ({
  mainPath: 'main.tex',
  texts: new Map([['main.tex', text]]),
  binaryPaths: [],
  imageUrls: new Map(),
});

const result = (html: string): ProjectPreviewResult => ({ html, errors: [], missing: [] });

/** A scheduler with fake workers, so tests can answer for them. */
function setup() {
  const workers: FakeWorker[] = [];
  const runLocal = vi.fn((request: ProjectPreviewInput) => result(`local:${request.texts.get('main.tex')}`));
  const scheduler = new CompileScheduler({
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    runLocal,
  });
  return { scheduler, workers, runLocal };
}

describe('CompileScheduler', () => {
  it('compiles in the worker and resolves with its result', async () => {
    const { scheduler, workers, runLocal } = setup();
    const done = scheduler.compile(input());
    expect(workers).toHaveLength(1);
    const { id } = workers[0].posted[0];
    workers[0].reply({ id, result: result('<p>Hi</p>') });
    await expect(done).resolves.toEqual(result('<p>Hi</p>'));
    expect(runLocal).not.toHaveBeenCalled();
  });

  it('reuses the worker once a compile has finished', async () => {
    const { scheduler, workers } = setup();
    const first = scheduler.compile(input('a'));
    workers[0].reply({ id: workers[0].posted[0].id, result: result('a') });
    await first;
    const second = scheduler.compile(input('b'));
    expect(workers).toHaveLength(1);
    workers[0].reply({ id: workers[0].posted[1].id, result: result('b') });
    await expect(second).resolves.toEqual(result('b'));
  });

  it('kills the busy worker when a newer compile comes in', async () => {
    const { scheduler, workers } = setup();
    const stale = scheduler.compile(input('old'));
    const fresh = scheduler.compile(input('new'));
    await expect(stale).resolves.toBeNull();
    expect(workers[0].terminated).toBe(true);
    expect(workers[0].onmessage).toBeNull();
    expect(workers).toHaveLength(2);
    workers[1].reply({ id: workers[1].posted[0].id, result: result('new') });
    await expect(fresh).resolves.toEqual(result('new'));
  });

  it('ignores replies for other compiles', async () => {
    const { scheduler, workers } = setup();
    const done = scheduler.compile(input());
    const { id } = workers[0].posted[0];
    workers[0].reply({ id: id + 100, result: result('wrong') });
    workers[0].reply({ id, result: result('right') });
    await expect(done).resolves.toEqual(result('right'));
    // A late duplicate does nothing once the compile is settled.
    workers[0].reply({ id, result: result('again') });
  });

  it('rejects when the worker reports an error', async () => {
    const { scheduler, workers } = setup();
    const done = scheduler.compile(input());
    workers[0].reply({ id: workers[0].posted[0].id, error: 'boom' });
    await expect(done).rejects.toThrow('boom');
  });

  it('falls back to the main thread when the worker breaks', async () => {
    const { scheduler, workers, runLocal } = setup();
    const done = scheduler.compile(input('x'));
    workers[0].crash();
    await expect(done).resolves.toEqual(result('local:x'));
    expect(workers[0].terminated).toBe(true);
    await expect(scheduler.compile(input('y'))).resolves.toEqual(result('local:y'));
    expect(workers).toHaveLength(1);
    expect(runLocal).toHaveBeenCalledTimes(2);
  });

  it('switches to the main thread after a crash with nothing in flight', async () => {
    const { scheduler, workers } = setup();
    const done = scheduler.compile(input('a'));
    workers[0].reply({ id: workers[0].posted[0].id, result: result('a') });
    await done;
    workers[0].crash();
    await expect(scheduler.compile(input('b'))).resolves.toEqual(result('local:b'));
    expect(workers).toHaveLength(1);
  });

  it('compiles on the main thread when no worker can start', async () => {
    const runLocal = vi.fn(() => result('local'));
    const noWorker = new CompileScheduler({ createWorker: () => null, runLocal });
    await expect(noWorker.compile(input())).resolves.toEqual(result('local'));
    const throws = new CompileScheduler({
      createWorker: () => {
        throw new Error('blocked');
      },
      runLocal,
    });
    await expect(throws.compile(input())).resolves.toEqual(result('local'));
    expect(runLocal).toHaveBeenCalledTimes(2);
  });

  it('drops a stale main thread result', async () => {
    let finish: (value: ProjectPreviewResult) => void = () => undefined;
    const runLocal = vi.fn(() => new Promise<ProjectPreviewResult>((resolve) => (finish = resolve)));
    const scheduler = new CompileScheduler({ createWorker: () => null, runLocal });
    const stale = scheduler.compile(input('old'));
    const finishOld = finish;
    const fresh = scheduler.compile(input('new'));
    finishOld(result('old'));
    finish(result('new'));
    await expect(stale).resolves.toBeNull();
    await expect(fresh).resolves.toEqual(result('new'));
  });

  it('keeps pictures on the main thread', async () => {
    const { scheduler, workers, runLocal } = setup();
    const picture = input('\\begin{picture}(1,1)\\end{picture}');
    expect(needsMainThread(picture)).toBe(true);
    expect(needsMainThread(input())).toBe(false);
    await scheduler.compile(picture);
    expect(workers).toHaveLength(0);
    expect(runLocal).toHaveBeenCalledOnce();
  });

  it('shuts the worker down on dispose', () => {
    const { scheduler, workers } = setup();
    void scheduler.compile(input());
    scheduler.dispose();
    expect(workers[0].terminated).toBe(true);
    scheduler.dispose();
  });

  it('compiles for real on the main thread under jsdom, which has no Worker', async () => {
    const scheduler = new CompileScheduler();
    const compiled = await scheduler.compile(input('\\documentclass{article}\\begin{document}Hello\\end{document}'));
    expect(compiled?.errors).toEqual([]);
    expect(compiled?.html).toContain('Hello');
  });
});

describe('compileOnMainThread', () => {
  it('loads the worker file once and uses the compiler it leaves behind', async () => {
    const source = input('\\documentclass{article}\\begin{document}Again\\end{document}');
    const first = await compileOnMainThread(source, './compile.worker.ts');
    const second = await compileOnMainThread(source, './does-not-exist.ts');
    expect(first.html).toContain('Again');
    expect(second.html).toBe(first.html);
  });
});

describe('collectImageUrls', () => {
  it('only looks up images and skips ones without bytes', () => {
    const lookup = vi.fn((path: string) => (path === 'missing.png' ? null : `data:${path}`));
    const urls = collectImageUrls(['a.png', 'notes.zip', 'missing.png'], lookup);
    expect([...urls]).toEqual([['a.png', 'data:a.png']]);
    expect(lookup).not.toHaveBeenCalledWith('notes.zip');
  });
});
