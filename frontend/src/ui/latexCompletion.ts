import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  snippet,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete';
import { EditorView, hoverTooltip, keymap, type Tooltip } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { LatexCommand, LatexEnvironment } from './latexCompletionData';
import type { PackageData } from './latexPackageData';
import { projectDiagnosticsExtension } from './projectDiagnostics';
import { labelNavigationExtension } from './labelNavigation';

export { findReferences, goToDefinition, renameLabel } from './labelNavigation';
import { citationSource, labelSource, pathSource, projectIndex, type Definition, type ProjectGetter } from './projectCompletion';

/**
 * LaTeX autocompletion (issue #192). This module is a lazy chunk: the editor imports it just after
 * it opens, so @codemirror/autocomplete and the completion data stay off the initial load.
 * It only reads the text before the cursor, and nothing leaves the browser.
 */

export interface LatexCompletionData {
  commands: readonly LatexCommand[];
  environments: readonly LatexEnvironment[];
}

export type LatexCompletionDataLoader = () => Promise<LatexCompletionData>;
export type PackageDataLoader = () => Promise<Readonly<Record<string, PackageData>>>;

/**
 * Loads something once and keeps it. If the load fails, there's nothing this time, and the next
 * completion tries again.
 */
function cached<T>(load: () => Promise<T>): () => Promise<T | null> {
  let value: Promise<T> | undefined;
  return () => {
    value ??= load();
    return value.catch((error: unknown) => {
      console.warn('LaTeX completions failed to load', error);
      value = undefined;
      return null;
    });
  };
}

const loadBundledData: LatexCompletionDataLoader = () =>
  import('./latexCompletionData').then((m) => ({ commands: m.LATEX_COMMANDS, environments: m.LATEX_ENVIRONMENTS }));

const loadBundledPackages: PackageDataLoader = () => import('./latexPackageData').then((m) => m.PACKAGE_DATA);

/** The packages `used` names and every package they load, as far as this data knows. */
export function withLoadedPackages(used: Iterable<string>, data: Readonly<Record<string, PackageData>>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const entry = Object.hasOwn(data, name) ? data[name] : undefined;
    if (!entry) return;
    out.push(name);
    entry.loads?.forEach(visit);
  };
  for (const name of used) visit(name);
  return out;
}

/** Turns a snippet template's tab stops into what they say, like `[#{options}]{#{class}}` into `[options]{class}`. */
export function argsLabel(args: string): string {
  return args.replace(/#\{([^{}]*)\}/g, '$1').trim();
}

/**
 * Whether the text before the cursor on a line is in a comment: a `%` that isn't escaped as `\%`
 * (a `%` after `\\` is a comment, since `\\` is a line break).
 */
export function isInComment(lineBefore: string): boolean {
  return /(?:^|[^\\])(?:\\\\)*%/.test(lineBefore);
}

/** Whether the backslash at the end of `text` is escaped, as in `\\` (a line break). */
function endsWithEscapedBackslash(text: string): boolean {
  const run = /\\*$/.exec(text)?.[0].length ?? 0;
  return run % 2 === 1;
}

function lineBefore(context: CompletionContext): string {
  const line = context.state.doc.lineAt(context.pos);
  return context.state.sliceDoc(line.from, context.pos);
}

/** Inserts `\begin{}` with the cursor inside, then opens the environment list. */
function applyBegin(view: EditorView, _completion: Completion, from: number, to: number) {
  const hasBrace = view.state.sliceDoc(to, to + 1) === '{';
  const insert = hasBrace ? '\\begin' : '\\begin{}';
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + '\\begin{'.length },
    userEvent: 'input.complete',
  });
  startCompletion(view);
}

export function commandCompletion([name, args, info]: LatexCommand): Completion {
  const label = `\\${name}`;
  const completion: Completion = { label, detail: argsLabel(args) || undefined, info, type: 'function' };
  if (name === 'begin') return { ...completion, detail: '{environment}', apply: applyBegin };
  if (!args) return completion;
  return { ...completion, apply: snippet(label + args) };
}

/**
 * Inserts the rest of `\begin{name}`, its arguments and body, and the matching `\end{name}`.
 * Takes over the `}` that closing brackets added after the cursor, if there is one.
 */
export function environmentCompletion([name, info, args = '', body = '#{}']: LatexEnvironment): Completion {
  const template = `${name}}${args}\n\t${body}\n\\end{${name}}`;
  const insert = snippet(template);
  return {
    label: name,
    detail: argsLabel(args) || undefined,
    info,
    type: 'type',
    apply(view, completion, from, to) {
      const end = view.state.sliceDoc(to, to + 1) === '}' ? to + 1 : to;
      insert(view, completion, from, end);
    },
  };
}

/** Where a user definition is from, for its info box. */
function definitionInfo(def: Definition): string {
  const parts = [def.text && (def.kind === 'command' ? `Operator “${def.text}”` : def.text), `${def.via} in ${def.path}:${def.line}`];
  if (def.optional !== undefined) {
    parts.push(def.optional ? `Optional first argument, “${def.optional}” if left out` : 'Optional first argument');
  }
  return parts.filter(Boolean).join('\n');
}

/**
 * A snippet with a tab stop for each argument you have to give. An optional first argument is
 * left out, as you'd usually leave it out when typing.
 */
function definitionArgs(def: Definition): string {
  const required = def.args - (def.optional !== undefined ? 1 : 0);
  return Array.from({ length: Math.max(0, required) }, (_, i) => `{#{arg${i + 1}}}`).join('');
}

/** An option for a command the project defines, like `\R` from `\newcommand{\R}{\mathbb{R}}`. */
export function definitionCompletion(def: Definition): Completion {
  return def.kind === 'command'
    ? commandCompletion([def.name, definitionArgs(def), definitionInfo(def)])
    : environmentCompletion([def.name, definitionInfo(def), definitionArgs(def)]);
}

export interface LatexOptions {
  commands: readonly Completion[];
  environments: readonly Completion[];
}

/**
 * The commands and environments to offer: LaTeX's own, those of the packages the project loads
 * (issue #194), and those it defines itself. A definition in the project takes the place of a
 * bundled command with the same name. Package data only loads once a known package is used.
 */
export class LatexOptionSet {
  private readonly getCore: () => Promise<LatexOptions | null>;
  private readonly getPackages: () => Promise<Readonly<Record<string, PackageData>> | null>;
  private readonly getProject: ProjectGetter;
  private last?: { core: LatexOptions; key: string; definitions: readonly Definition[]; options: LatexOptions };

  constructor(load: LatexCompletionDataLoader = loadBundledData, getProject: ProjectGetter = () => null, loadPackages: PackageDataLoader = loadBundledPackages) {
    this.getCore = cached(() => load().then((data) => ({
      commands: data.commands.map(commandCompletion),
      environments: data.environments.map(environmentCompletion),
    })));
    this.getPackages = cached(loadPackages);
    this.getProject = getProject;
  }

  async get(): Promise<LatexOptions | null> {
    const core = await this.getCore();
    if (!core) return null;
    const project = this.getProject();
    const index = project && projectIndex(project);
    const used = index ? index.packages() : new Set<string>();
    const definitions = index ? index.definitions() : [];
    // Without the package data (it failed to load), there are just LaTeX's own and the project's.
    const data = used.size ? await this.getPackages() : null;
    const packages = data ? withLoadedPackages(used, data) : [];
    const key = packages.join(',');
    const last = this.last;
    if (last && last.core === core && last.key === key && last.definitions === definitions) return last.options;
    const commands = new Map<string, Completion>(core.commands.map((option) => [option.label, option]));
    const environments = new Map<string, Completion>(core.environments.map((option) => [option.label, option]));
    for (const name of packages) {
      for (const command of data?.[name].commands ?? []) commands.set(`\\${command[0]}`, commandCompletion(command));
      for (const environment of data?.[name].environments ?? []) environments.set(environment[0], environmentCompletion(environment));
    }
    // The first definition of a name wins, as it would in LaTeX for \newcommand.
    const defined = new Set<string>();
    for (const def of definitions) {
      const id = `${def.kind}:${def.name}`;
      if (defined.has(id)) continue;
      defined.add(id);
      const option = definitionCompletion(def);
      (def.kind === 'command' ? commands : environments).set(option.label, option);
    }
    const options = { commands: [...commands.values()], environments: [...environments.values()] };
    this.last = { core, key, definitions, options };
    return options;
  }
}

function optionSet(from: LatexOptionSet | LatexCompletionDataLoader): LatexOptionSet {
  return from instanceof LatexOptionSet ? from : new LatexOptionSet(from);
}

/** Completes commands after a backslash, like `\sec` to `\section{title}`. */
export function latexCommandSource(from: LatexOptionSet | LatexCompletionDataLoader = loadBundledData): CompletionSource {
  const set = optionSet(from);
  return async (context): Promise<CompletionResult | null> => {
    const match = context.matchBefore(/\\[a-zA-Z]*/);
    if (!match) return null;
    const before = lineBefore(context);
    const lead = before.slice(0, before.length - (match.to - match.from));
    if (endsWithEscapedBackslash(lead) || isInComment(lead)) return null;
    const options = await set.get();
    return options && { from: match.from, options: options.commands, validFor: /^\\[a-zA-Z]*$/ };
  };
}

/** Completes environment names after `\begin{`, adding the matching `\end{...}`. */
export function latexEnvironmentSource(from: LatexOptionSet | LatexCompletionDataLoader = loadBundledData): CompletionSource {
  const set = optionSet(from);
  return async (context): Promise<CompletionResult | null> => {
    const match = context.matchBefore(/\\begin\{[a-zA-Z*]*/);
    if (!match) return null;
    const before = lineBefore(context);
    const lead = before.slice(0, before.length - (match.to - match.from));
    if (endsWithEscapedBackslash(lead) || isInComment(lead)) return null;
    const options = await set.get();
    return options && { from: match.from + '\\begin{'.length, options: options.environments, validFor: /^[a-zA-Z*]*$/ };
  };
}

/** The command or `\\begin{environment}` name under `pos`, with its range. Null on anything else. */
export function hoverTarget(view: EditorView, pos: number): { kind: 'command' | 'environment'; label: string; from: number; to: number } | null {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  const at = pos - line.from;
  // An environment name in \begin{name} or \end{name}.
  for (const match of text.matchAll(/\\(?:begin|end)\s*\{([a-zA-Z*]+)\}/g)) {
    const start = match.index + match[0].indexOf('{') + 1;
    if (at >= start && at <= start + match[1].length) {
      const lead = text.slice(0, match.index);
      if (endsWithEscapedBackslash(lead) || isInComment(lead)) return null;
      return { kind: 'environment', label: match[1], from: line.from + start, to: line.from + start + match[1].length };
    }
  }
  const before = /\\[a-zA-Z]*$/.exec(text.slice(0, at));
  const after = /^[a-zA-Z]*/.exec(text.slice(at))?.[0] ?? '';
  // On the backslash itself, the name follows.
  const onSlash = !before && text[at] === '\\' ? /^\\[a-zA-Z]+/.exec(text.slice(at)) : null;
  const start = before ? at - before[0].length : onSlash ? at : -1;
  if (start < 0) return null;
  const name = before ? before[0] + after : onSlash![0];
  const lead = text.slice(0, start);
  if (name.length < 2 || endsWithEscapedBackslash(lead) || isInComment(lead)) return null;
  return { kind: 'command', label: name, from: line.from + start, to: line.from + start + name.length };
}

/** The card for a command or environment: its name and arguments, then what it does. */
export function hoverCard(option: Completion, kind: 'command' | 'environment'): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'cm-latex-hover';
  const head = document.createElement('div');
  head.className = 'cm-latex-hover-name';
  head.textContent = kind === 'environment' ? `\\begin{${option.label}}` : option.label;
  if (option.detail && option.detail !== '{environment}') {
    const args = document.createElement('span');
    args.className = 'cm-latex-hover-args';
    args.textContent = option.detail;
    head.append(args);
  }
  dom.append(head);
  if (typeof option.info === 'string' && option.info) {
    const info = document.createElement('div');
    info.className = 'cm-latex-hover-info';
    info.textContent = option.info;
    dom.append(info);
  }
  return dom;
}

/**
 * Hover docs (issue #248): resting the mouse on a command, or an environment name after `\\begin{`,
 * shows what completion knows about it, from LaTeX's own list, the packages the project loads and
 * its own definitions. Unknown names show nothing.
 */
export function latexHoverSource(set: LatexOptionSet): (view: EditorView, pos: number) => Promise<Tooltip | null> {
  let indexed: { options: LatexOptions; commands: Map<string, Completion>; environments: Map<string, Completion> } | null = null;
  return async (view, pos) => {
    const target = hoverTarget(view, pos);
    if (!target) return null;
    const options = await set.get();
    if (!options) return null;
    if (indexed?.options !== options) {
      indexed = {
        options,
        commands: new Map(options.commands.map((o) => [o.label, o])),
        environments: new Map(options.environments.map((o) => [o.label, o])),
      };
    }
    const option = (target.kind === 'command' ? indexed.commands : indexed.environments).get(target.label);
    if (!option) return null;
    return { pos: target.from, end: target.to, above: true, create: () => ({ dom: hoverCard(option, target.kind) }) };
  };
}

/** The hover docs tooltip and its look. The card is as wide as the other hover cards at most (docs/ui-sizing.md). */
export function latexHoverExtension(set: LatexOptionSet): Extension {
  return [
    hoverTooltip(latexHoverSource(set), { hoverTime: 400 }),
    EditorView.baseTheme({
      '.cm-tooltip .cm-latex-hover': {
        maxWidth: 'min(var(--popover-card, 22rem), calc(100vw - var(--viewport-gutter, 2rem)))',
        padding: '0.375rem 0.5rem',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '0.8125rem',
        lineHeight: '1.35',
      },
      '.cm-latex-hover-name': { fontFamily: 'ui-monospace, monospace', fontWeight: '600' },
      '.cm-latex-hover-args': { fontWeight: '400', opacity: '0.8', marginLeft: '0.125rem' },
      '.cm-latex-hover-info': { marginTop: '0.25rem', whiteSpace: 'pre-line' },
    }),
  ];
}

/**
 * The editor's completion extensions: closing brackets, LaTeX commands and environments from the
 * bundled data, the packages the project loads and its own definitions (issue #194), and labels,
 * citations and paths from the project `getProject` gives (issue #193), and that project's
 * undefined references, duplicate labels and missing citations in the lint gutter (issue #246),
 * Ctrl+click to a definition and the references panel (issue #247), and hover docs (issue #248).
 * The keys are CodeMirror's: Ctrl+Space opens the list, Enter accepts, Tab and Shift+Tab move
 * between a snippet's fields, and Escape closes the list.
 */
export function latexCompletionExtensions(
  load: LatexCompletionDataLoader = loadBundledData,
  getProject: ProjectGetter = () => null,
  loadPackages: PackageDataLoader = loadBundledPackages,
): Extension {
  const options = new LatexOptionSet(load, getProject, loadPackages);
  const sources = [
    labelSource(getProject),
    citationSource(getProject),
    pathSource(getProject),
    latexEnvironmentSource(options),
    latexCommandSource(options),
  ];
  return [
    closeBrackets(),
    keymap.of(closeBracketsKeymap),
    autocompletion({ override: sources, icons: false }),
    projectDiagnosticsExtension(getProject),
    labelNavigationExtension(getProject),
    latexHoverExtension(options),
  ];
}
