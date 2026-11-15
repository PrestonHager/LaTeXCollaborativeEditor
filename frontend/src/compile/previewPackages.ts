/**
 * Which packages the preview (LaTeX.js) can load, and what it means for the preview when it
 * can't. latexJsAdapt.ts removes every \usepackage and \RequirePackage it can't load and turns
 * each one into a diagnostic on that line, so nothing is dropped without saying so.
 *
 * docs/editing-and-preview.md lists these tables for people; keep the two in step.
 */

/**
 * Packages LaTeX.js has built in, plus the ones it accepts and ignores (calc, keyval, ...).
 * Every other package fails to load in the browser, since LaTeX.js loads them with require().
 */
export const LATEX_JS_PACKAGES: ReadonlySet<string> = new Set([
  'color',
  'xcolor',
  'echo',
  'gensymb',
  'graphics',
  'graphicx',
  'hyperref',
  'latexsym',
  'multicol',
  'stix',
  'textcomp',
  'textgreek',
  // LaTeX.js ignores these on its own; it has what they'd add, or they add nothing it shows.
  'calc',
  'pspicture',
  'picture',
  'pict2e',
  'keyval',
  'comment',
]);

/**
 * How the preview copes without a package:
 * - `ignored`: safe to leave out of the preview, only the look changes (info).
 * - `shimmed`: the preview has a stand-in for its commands (info).
 * - `missing`: what the package draws or adds isn't in the preview (warning).
 */
export type PackageSupport = { kind: 'ignored' | 'shimmed' | 'missing'; effect: string };

const group = (names: string[], support: PackageSupport) => names.map((name) => [name, support] as const);

const PACKAGE_SUPPORT = new Map<string, PackageSupport>([
  // Page layout and spacing.
  ...group(['geometry', 'fullpage', 'a4wide', 'vmargin', 'typearea'], { kind: 'ignored', effect: 'The preview uses its own page size and margins.' }),
  ...group(['fancyhdr'], { kind: 'ignored', effect: "Headers and footers don't show." }),
  ...group(['setspace', 'parskip', 'indentfirst'], { kind: 'ignored', effect: 'Line spacing and indents use the preview defaults.' }),
  ...group(['microtype'], { kind: 'ignored', effect: 'Fine spacing tweaks make no visible difference here.' }),
  ...group(['float'], { kind: 'ignored', effect: 'Figures show where they are in the source.' }),
  ...group(['titlesec', 'titling', 'sectsty', 'caption'], { kind: 'ignored', effect: 'Headings and captions use the preview style.' }),
  // Fonts, encodings and languages.
  ...group(['inputenc', 'fontenc'], { kind: 'ignored', effect: 'The preview reads Unicode already.' }),
  ...group(
    ['fontspec', 'lmodern', 'times', 'mathptmx', 'helvet', 'courier', 'palatino', 'mathpazo', 'newtxtext', 'newtxmath', 'libertine', 'charter', 'kpfonts'],
    { kind: 'ignored', effect: 'The preview uses its own fonts.' },
  ),
  ...group(['babel', 'polyglossia'], { kind: 'ignored', effect: 'Hyphenation and names like "Contents" stay in English.' }),
  // Math, which KaTeX draws.
  ...group(['amssymb', 'amsfonts', 'mathtools', 'bm'], { kind: 'ignored', effect: 'KaTeX draws the math, and has most of these commands.' }),
  ...group(['amsmath'], { kind: 'shimmed', effect: 'KaTeX draws the math; numbered equations show without their numbers.' }),
  ...group(['amsthm'], { kind: 'shimmed', effect: 'Theorems and proofs show without numbers.' }),
  // Stand-ins in packageShims.ts, the adapter and verbatimBlocks.ts.
  ...group(['cleveref'], { kind: 'shimmed', effect: '\\cref shows as a plain reference.' }),
  ...group(['csquotes'], { kind: 'shimmed', effect: '\\enquote shows plain quotation marks.' }),
  ...group(['siunitx'], { kind: 'shimmed', effect: 'Numbers and units show as plain text.' }),
  ...group(['booktabs'], { kind: 'shimmed', effect: "Tables the preview can't draw show as a note." }),
  ...group(['appendix'], { kind: 'shimmed', effect: 'The appendices environment works like \\appendix.' }),
  ...group(['authblk'], { kind: 'shimmed', effect: 'Authors and affiliations show as plain text.' }),
  ...group(['nomencl'], { kind: 'shimmed', effect: 'Entries show as plain text, and the list itself is left out.' }),
  ...group(['natbib', 'biblatex', 'cite'], { kind: 'shimmed', effect: 'The preview builds the bibliography itself, in an approximate style.' }),
  ...group(['listings', 'minted', 'fancyvrb', 'alltt', 'verbatim'], { kind: 'shimmed', effect: 'Code shows in plain code blocks.' }),
  // Drawings and algorithms, which stop the preview when used.
  ...group(['tikz', 'pgf', 'pgfplots', 'tikz-cd', 'circuitikz', 'tkz-euclide', 'forest'], {
    kind: 'missing',
    effect: "The preview can't draw TikZ pictures; the first tikzpicture stops it with an error.",
  }),
  ...group(['pstricks', 'xy', 'chemfig'], { kind: 'missing', effect: "The preview can't draw its pictures; the first one stops it with an error." }),
  ...group(['algorithm', 'algorithmic', 'algpseudocode', 'algorithm2e'], {
    kind: 'missing',
    effect: "The preview can't typeset algorithms; the first one stops it with an error.",
  }),
]);

const UNKNOWN: PackageSupport = {
  kind: 'missing',
  effect: "What it adds is missing, and a command or environment the preview doesn't know stops it with an error.",
};

/** How the preview copes without `name`. Packages it knows nothing about get a warning. */
export function packageSupport(name: string): PackageSupport {
  return PACKAGE_SUPPORT.get(name) ?? UNKNOWN;
}

/** The diagnostic for a package the preview couldn't load. */
export function packageDiagnostic(name: string): { severity: 'info' | 'warning'; message: string } {
  const { kind, effect } = packageSupport(name);
  if (kind === 'missing') return { severity: 'warning', message: `The preview can't load the ${name} package. ${effect}` };
  const lead = kind === 'shimmed' ? `The preview uses a stand-in for the ${name} package.` : `The preview leaves out the ${name} package.`;
  return { severity: 'info', message: `${lead} ${effect}` };
}

/** Every package with an entry, for the docs check in the tests. */
export function knownPackages(): Map<string, PackageSupport> {
  return new Map(PACKAGE_SUPPORT);
}
