// Compile with a TeX Live installed on this computer, in the desktop app (issue #264,
// docs/desktop.md "Local TeX Live"). A lazy chunk, loaded only in the desktop app when one of its
// palette commands runs.
//
// Off by default. "Set Up Local TeX" turns it on (and off), and "Compile with Local TeX" runs it.
// The shell (desktop/src-tauri/src/local_tex.rs) runs only latexmk, pdflatex, xelatex or lualatex,
// with shell escape off and TeX's file access limited to a temporary copy of the project. This side
// sends the project's files, then shows the PDF or the first error from the log.
import type { ProjectDoc } from '../project/projectDoc';
import type { ConfirmOptions, PromptOptions } from '../ui/dialogs';
import { resolveEngine, ENGINE_LABELS, type TexEngine } from '../project/texEngine';
import { basename } from '../project/paths';

type Invoke = (command: string, args?: unknown, options?: { headers: Record<string, string> }) => Promise<unknown>;

/** Kept in this app's localStorage only; it never goes to peers. */
export type LocalTexSettings = {
  enabled: boolean;
  /** The folder holding the TeX programs. Empty: find them on PATH. */
  texDir: string;
};

export const LOCAL_TEX_KEY = 'latex_editor_local_tex';

export function readLocalTexSettings(): LocalTexSettings {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_TEX_KEY) ?? 'null') as Partial<LocalTexSettings> | null;
    return { enabled: value?.enabled === true, texDir: typeof value?.texDir === 'string' ? value.texDir : '' };
  } catch {
    return { enabled: false, texDir: '' };
  }
}

function writeLocalTexSettings(settings: LocalTexSettings) {
  try {
    localStorage.setItem(LOCAL_TEX_KEY, JSON.stringify(settings));
  } catch {
    // Without storage it stays off on the next start, which is the safe side.
  }
}

export type LocalTexContext = {
  getProject(): ProjectDoc;
  /** The bytes of a binary file, or undefined while they're still coming from a peer. */
  getBlob(hash: string): Promise<Uint8Array | undefined>;
  confirmDialog(options: ConfirmOptions): Promise<boolean>;
  promptDialog(options: PromptOptions): Promise<string | null>;
  showNotice(message: string, isError?: boolean): void;
  setStatus(message: string): void;
  /** Show the compiled PDF (in the file viewer), with a way to save it. */
  showPdf(path: string, bytes: Uint8Array): void;
  invoke?: Invoke;
};

/** [path length u32][path][data length u32][data], repeated (parse_files in local_tex.rs). */
export function encodeFiles(files: { path: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts = files.map(({ path, data }) => ({ path: encoder.encode(path), data }));
  const size = parts.reduce((sum, part) => sum + 8 + part.path.byteLength + part.data.byteLength, 0);
  const body = new Uint8Array(size);
  const view = new DataView(body.buffer);
  let at = 0;
  for (const { path, data } of parts) {
    view.setUint32(at, path.byteLength);
    body.set(path, at + 4);
    at += 4 + path.byteLength;
    view.setUint32(at, data.byteLength);
    body.set(data, at + 4);
    at += 4 + data.byteLength;
  }
  return body;
}

/** [ok u8][pdf length u32][pdf][log] (encode_outcome in local_tex.rs). */
export function decodeOutcome(raw: ArrayBuffer | Uint8Array | number[]): { ok: boolean; pdf: Uint8Array | null; log: string } {
  const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
  if (bytes.byteLength < 5) return { ok: false, pdf: null, log: '' };
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1);
  const pdf = length ? bytes.slice(5, 5 + length) : null;
  return { ok: bytes[0] === 1, pdf, log: new TextDecoder().decode(bytes.subarray(5 + length)) };
}

/** The first error in a TeX log, in words: "main.tex line 3: Undefined control sequence." */
export function firstLogError(log: string): string | null {
  const located = log.match(/^(?:\.\/)?([^\s:][^:\n]*\.(?:tex|sty|cls|bib)):(\d+): (.+)$/m);
  if (located) return `${located[1]} line ${located[2]}: ${located[3].trim()}`;
  const bang = log.match(/^! (.+)$/m);
  return bang ? bang[1].trim() : null;
}

/** The shell's error codes (TexError in local_tex.rs), in words. */
export function describeTexError(error: unknown, settings: LocalTexSettings): string {
  const text = typeof error === 'string' ? error : error instanceof Error ? error.message : String(error);
  const where = settings.texDir ? `in ${settings.texDir}` : 'on this computer’s PATH';
  if (text.startsWith('not_found:')) return `${text.slice('not_found:'.length).trim()} isn't installed ${where}. Install TeX Live, or set its folder with Set Up Local TeX.`;
  if (text === 'timed_out') return 'TeX took too long (over 3 minutes) and was stopped.';
  if (text.startsWith('too_large:')) return `Couldn't compile: ${text.slice('too_large:'.length).trim()}.`;
  if (text.startsWith('bad_request:')) return `Couldn't compile: ${text.slice('bad_request:'.length).trim()}.`;
  return `Couldn't run TeX: ${text.replace(/^io:\s*/, '')}`;
}

function shellInvoke(): Invoke | null {
  const internals = (globalThis.window as { __TAURI_INTERNALS__?: { invoke?: Invoke } } | undefined)?.__TAURI_INTERNALS__;
  return typeof internals?.invoke === 'function' ? internals.invoke : null;
}

export function createLocalTex(ctx: LocalTexContext) {
  const invoke = ctx.invoke ?? shellInvoke();

  /** Turn it on (asking for the TeX folder, optional) or off. */
  async function setUp() {
    const settings = readLocalTexSettings();
    if (settings.enabled) {
      const off = await ctx.confirmDialog({
        title: 'Turn off local TeX?',
        message: `Compile with Local TeX uses the TeX Live ${settings.texDir ? `in ${settings.texDir}` : 'on this computer'}. Turn it off to stop the app running TeX.`,
        confirmLabel: 'Turn off',
      });
      if (off) {
        writeLocalTexSettings({ ...settings, enabled: false });
        ctx.setStatus('Local TeX: Off');
      }
      return;
    }
    const on = await ctx.confirmDialog({
      title: 'Compile with TeX on this computer?',
      message:
        'The app will run latexmk, pdflatex, xelatex or lualatex from your TeX Live on a temporary copy of the project when you choose Compile with Local TeX. Shell escape stays off, and TeX can only read and write inside that copy and its own files. Nothing is sent anywhere.',
      confirmLabel: 'Turn on',
    });
    if (!on) return;
    const texDir = await ctx.promptDialog({
      title: 'Where is TeX Live?',
      message: 'The folder that holds pdflatex, like /usr/local/texlive/2025/bin/x86_64-linux. Leave it empty to use the ones on your PATH.',
      label: 'TeX folder',
      initialValue: settings.texDir,
      confirmLabel: 'Save',
      validate: (value) => (value.trim() && !/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(value.trim()) ? 'Use a full path, or leave it empty.' : null),
    });
    if (texDir === null) return;
    writeLocalTexSettings({ enabled: true, texDir: texDir.trim() });
    ctx.setStatus('Local TeX: On');
  }

  async function run(program: string, engine: TexEngine, main: string, body: Uint8Array, texDir: string) {
    if (!invoke) throw new Error('io: this isn’t the desktop app');
    const headers: Record<string, string> = {
      'x-tex-program': program,
      'x-tex-engine': engine,
      'x-tex-main': encodeURIComponent(main),
      'x-tex-dir': encodeURIComponent(texDir),
    };
    return decodeOutcome((await invoke('tex_compile', body, { headers })) as ArrayBuffer);
  }

  /** Compile the project with the local TeX and show the PDF, or the first error. */
  async function compile() {
    const settings = readLocalTexSettings();
    if (!settings.enabled) {
      ctx.showNotice('Local TeX is off. Turn it on with Set Up Local TeX in the command palette.');
      return;
    }
    const project = ctx.getProject();
    const mainId = project.getMainFileId();
    const main = mainId ? project.get(mainId)?.path : undefined;
    if (!mainId || !main) {
      ctx.showNotice('Set a main file first (right-click a .tex file > Set as main file).', true);
      return;
    }
    const files: { path: string; data: Uint8Array }[] = [];
    const missing: string[] = [];
    const encoder = new TextEncoder();
    for (const entry of project.entries()) {
      if (entry.kind === 'text') files.push({ path: entry.path, data: encoder.encode(project.getText(entry.id).toString()) });
      else if (entry.kind === 'binary') {
        const bytes = entry.hash ? await ctx.getBlob(entry.hash) : undefined;
        if (bytes) files.push({ path: entry.path, data: bytes });
        else missing.push(entry.path);
      }
    }
    const { engine } = resolveEngine(project.getEngine(), project.getText(mainId).toString());
    const body = encodeFiles(files);
    ctx.setStatus(`Compiling with ${ENGINE_LABELS[engine]}...`);
    let outcome;
    let program = 'latexmk';
    try {
      try {
        outcome = await run('latexmk', engine, main, body, settings.texDir);
      } catch (error) {
        // No latexmk (it needs Perl): run the engine itself, once.
        if (!String(error).startsWith('not_found: latexmk')) throw error;
        program = engine;
        outcome = await run(engine, engine, main, body, settings.texDir);
      }
    } catch (error) {
      ctx.setStatus('Local TeX: Failed');
      ctx.showNotice(describeTexError(error, settings), true);
      return;
    }
    const pdfName = `${basename(main).replace(/\.tex$/i, '')}.pdf`;
    if (outcome.ok && outcome.pdf) {
      ctx.showPdf(pdfName, outcome.pdf);
      ctx.setStatus(`Compiled ${pdfName} with ${program}`);
      if (missing.length) ctx.showNotice(`Compiled without ${missing.length} file(s) still arriving from peers: ${missing.slice(0, 3).join(', ')}.`);
      return;
    }
    ctx.setStatus('Local TeX: Errors');
    const error = firstLogError(outcome.log);
    ctx.showNotice(error ? `LaTeX error in ${error}` : `${program} failed without a PDF. Check the project's main file.`, true);
    if (outcome.pdf) ctx.showPdf(pdfName, outcome.pdf);
  }

  return { setUp, compile };
}

export type LocalTex = ReturnType<typeof createLocalTex>;
