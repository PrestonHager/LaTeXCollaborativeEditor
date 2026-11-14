/**
 * Which TeX engine a project compiles with (issue #199, part of #43), and the `% !TEX` magic
 * comments that Overleaf, TeXShop, TeXstudio and VS Code's LaTeX Workshop read.
 *
 * The engine is a project setting, stored with the project and synced to peers in the shared
 * `meta` map (see ProjectDoc). A `% !TEX program = xelatex` comment in the main file wins over
 * it, the way TeXShop does it. The live preview (LaTeX.js) is the same for every engine; for now
 * the engine only changes which diagnostics show. Compile PDF (docs/wasm-tex-engine.md) runs it.
 */

export type TexEngine = 'pdflatex' | 'xelatex' | 'lualatex';

export const TEX_ENGINES: readonly TexEngine[] = ['pdflatex', 'xelatex', 'lualatex'];
export const DEFAULT_TEX_ENGINE: TexEngine = 'pdflatex';

/** How each engine is written for people. */
export const ENGINE_LABELS: Record<TexEngine, string> = { pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' };

export function isTexEngine(value: unknown): value is TexEngine {
  return typeof value === 'string' && (TEX_ENGINES as readonly string[]).includes(value);
}

// The names editors write after `program =`, and what each one runs. `latex` means pdfLaTeX
// here: nobody wants a DVI, and Overleaf runs LaTeX through pdfLaTeX too.
const PROGRAM_NAMES: Record<string, TexEngine> = {
  pdflatex: 'pdflatex',
  pdftex: 'pdflatex',
  latex: 'pdflatex',
  xelatex: 'xelatex',
  xetex: 'xelatex',
  lualatex: 'lualatex',
  luatex: 'lualatex',
  luahbtex: 'lualatex',
  lualatexmk: 'lualatex',
};

/** The engine a program name means, like `XeLaTeX` or `xetex`, or null when it isn't one we know. */
export function engineFromProgram(name: string): TexEngine | null {
  return PROGRAM_NAMES[name.trim().toLowerCase()] ?? null;
}

/** A `% !TEX` comment as written, with the line it's on (1-based). */
export type MagicComment = { value: string; line: number };
export type MagicComments = { program?: MagicComment; root?: MagicComment };

// TeXShop only looks at the first 20 lines, so a stray comment deep in a file doesn't count.
const MAGIC_LINE_LIMIT = 20;
// `% !TEX program = xelatex`, `%!TeX TS-program = xelatex` and `% !TEX root = ../main.tex`.
const MAGIC_PATTERN = /^\s*%+\s*!\s*TEX\s+(TS-)?(program|root)\s*=\s*(.*?)\s*$/i;

/**
 * Read the `% !TEX program` and `% !TEX root` comments near the top of a file.
 * The first of each wins, like in TeXShop. Values longer than a path could sensibly be are ignored.
 */
export function readMagicComments(text: string): MagicComments {
  const found: MagicComments = {};
  const lines = text.split('\n', MAGIC_LINE_LIMIT);
  lines.forEach((raw, index) => {
    const match = MAGIC_PATTERN.exec(raw);
    if (!match) return;
    const key = match[2].toLowerCase() as 'program' | 'root';
    const value = match[3];
    if (!value || value.length > 512 || found[key]) return;
    found[key] = { value, line: index + 1 };
  });
  return found;
}

/** Where the engine came from, so the UI can say why a setting has no effect. */
export type EngineSource = 'magic' | 'project' | 'default';
export type ResolvedEngine = { engine: TexEngine; source: EngineSource };

/**
 * The engine a project compiles with: the main file's `% !TEX program` comment if it names one we
 * know, then the project setting, then pdfLaTeX.
 */
export function resolveEngine(setting: TexEngine | null | undefined, mainText: string | undefined): ResolvedEngine {
  const program = mainText === undefined ? undefined : readMagicComments(mainText).program;
  const fromMagic = program ? engineFromProgram(program.value) : null;
  if (fromMagic) return { engine: fromMagic, source: 'magic' };
  if (setting && isTexEngine(setting)) return { engine: setting, source: 'project' };
  return { engine: DEFAULT_TEX_ENGINE, source: 'default' };
}

type EngineNeed = { engines: readonly TexEngine[]; needs: string; suggest: TexEngine };

const UNICODE_ENGINES: EngineNeed = { engines: ['xelatex', 'lualatex'], needs: 'XeLaTeX or LuaLaTeX', suggest: 'xelatex' };
const XETEX_ONLY: EngineNeed = { engines: ['xelatex'], needs: 'XeLaTeX', suggest: 'xelatex' };
const LUATEX_ONLY: EngineNeed = { engines: ['lualatex'], needs: 'LuaLaTeX', suggest: 'lualatex' };

/** Packages that only load under some engines. pdfLaTeX stops on fontspec, for one. */
const ENGINE_PACKAGES = new Map<string, EngineNeed>([
  ...['fontspec', 'unicode-math', 'polyglossia'].map((name) => [name, UNICODE_ENGINES] as const),
  ...['xecjk', 'xeCJK', 'xltxtra', 'xunicode', 'xepersian', 'bidi'].map((name) => [name, XETEX_ONLY] as const),
  ...['luacode', 'luatexja', 'luatextra', 'luaotfload', 'lua-ul', 'luamplib', 'lua-visual-debug'].map((name) => [name, LUATEX_ONLY] as const),
]);

/** The engines `name` loads under, or null when it loads under all three. */
export function packageEngines(name: string): readonly TexEngine[] | null {
  return ENGINE_PACKAGES.get(name)?.engines ?? null;
}

/**
 * Why `name` won't load under `engine`, with the fix, or null when it will.
 * The live preview leaves these packages out either way, so this is about what a real compile does.
 */
export function enginePackageMessage(name: string, engine: TexEngine): string | null {
  const need = ENGINE_PACKAGES.get(name);
  if (!need || need.engines.includes(engine)) return null;
  const pick = ENGINE_LABELS[need.suggest];
  return (
    `The ${name} package needs ${need.needs}, but this project compiles with ${ENGINE_LABELS[engine]}. ` +
    `Pick ${pick} in the View menu, or put "% !TEX program = ${need.suggest}" at the top of the main file.`
  );
}
