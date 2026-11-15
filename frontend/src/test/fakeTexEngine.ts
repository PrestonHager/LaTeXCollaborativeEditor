import type { TexEngineBackend } from '../compile/pdf/engine';
import type { TexEngine } from '../project/texEngine';

/**
 * A pretend TeX engine for the Compile PDF tests (issue #241). It reads the main file and:
 * - `\fail` stops it with exit code 1 and an error in the log, like a real TeX error;
 * - `\ref` makes the first pass ask for a rerun, as LaTeX does for new labels;
 * - `\loop` asks for a rerun and changes the .aux on every pass, so only the pass limit stops it;
 * - `\oom` throws the way Emscripten does when the heap runs out;
 * otherwise it writes a small PDF and a log.
 */
export class FakeTexEngine implements TexEngineBackend {
  readonly files = new Map<string, Uint8Array>();
  loadedWith: { assets: string[]; engine: TexEngine } | null = null;
  runs: TexEngine[] = [];
  private readonly encoder = new TextEncoder();

  async load(assets: ReadonlyMap<string, Uint8Array>, engine: TexEngine) {
    this.loadedWith = { assets: [...assets.keys()].sort(), engine };
  }

  writeFile(path: string, data: Uint8Array | string) {
    this.files.set(path, typeof data === 'string' ? this.encoder.encode(data) : data);
  }

  readFile(path: string) {
    return this.files.get(path) ?? null;
  }

  clearProject() {
    this.files.clear();
  }

  async run(engine: TexEngine, mainPath: string) {
    this.runs.push(engine);
    const pass = this.runs.length;
    const stem = mainPath.replace(/\.tex$/, '');
    const source = new TextDecoder().decode(this.files.get(mainPath) ?? new Uint8Array());
    if (source.includes('\\oom')) throw new Error('Aborted(Cannot enlarge memory arrays to size 600000000 bytes)');
    if (source.includes('\\fail')) {
      this.writeFile(`${stem}.log`, `This is ${engine}\n! Undefined control sequence.\nl.3 \\fail\n`);
      return { exitCode: 1 };
    }
    const rerun = source.includes('\\loop') || (source.includes('\\ref') && !this.files.has(`${stem}.aux`));
    this.writeFile(`${stem}.aux`, source.includes('\\loop') ? `\\relax % pass ${pass}` : '\\relax');
    this.writeFile(`${stem}.log`, `This is ${engine}\n${rerun ? 'LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.\n' : ''}Output written on ${stem}.pdf (1 page).\n`);
    this.writeFile(`${stem}.pdf`, '%PDF-1.7 fake');
    return { exitCode: 0 };
  }
}
