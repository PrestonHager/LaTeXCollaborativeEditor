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
import { keymap, type EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { LatexCommand, LatexEnvironment } from './latexCompletionData';

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

/**
 * Loads the options once and keeps them. If the load fails, there are no options this time,
 * and the next completion tries again.
 */
function cachedOptions(load: () => Promise<Completion[]>): () => Promise<Completion[] | null> {
  let options: Promise<Completion[]> | undefined;
  return () => {
    options ??= load();
    return options.catch((error: unknown) => {
      console.warn('LaTeX completions failed to load', error);
      options = undefined;
      return null;
    });
  };
}

const loadBundledData: LatexCompletionDataLoader = () =>
  import('./latexCompletionData').then((m) => ({ commands: m.LATEX_COMMANDS, environments: m.LATEX_ENVIRONMENTS }));

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

/** Completes commands after a backslash, like `\sec` to `\section{title}`. */
export function latexCommandSource(load: LatexCompletionDataLoader = loadBundledData): CompletionSource {
  const getOptions = cachedOptions(() => load().then((data) => data.commands.map(commandCompletion)));
  return async (context): Promise<CompletionResult | null> => {
    const match = context.matchBefore(/\\[a-zA-Z]*/);
    if (!match) return null;
    const before = lineBefore(context);
    const lead = before.slice(0, before.length - (match.to - match.from));
    if (endsWithEscapedBackslash(lead) || isInComment(lead)) return null;
    const options = await getOptions();
    return options && { from: match.from, options, validFor: /^\\[a-zA-Z]*$/ };
  };
}

/** Completes environment names after `\begin{`, adding the matching `\end{...}`. */
export function latexEnvironmentSource(load: LatexCompletionDataLoader = loadBundledData): CompletionSource {
  const getOptions = cachedOptions(() => load().then((data) => data.environments.map(environmentCompletion)));
  return async (context): Promise<CompletionResult | null> => {
    const match = context.matchBefore(/\\begin\{[a-zA-Z*]*/);
    if (!match) return null;
    const before = lineBefore(context);
    const lead = before.slice(0, before.length - (match.to - match.from));
    if (endsWithEscapedBackslash(lead) || isInComment(lead)) return null;
    const options = await getOptions();
    return options && { from: match.from + '\\begin{'.length, options, validFor: /^[a-zA-Z*]*$/ };
  };
}

/**
 * The editor's completion extensions: closing brackets, and LaTeX commands and environments
 * from the bundled data. The keys are CodeMirror's: Ctrl+Space opens the list, Enter accepts,
 * Tab and Shift+Tab move between a snippet's fields, and Escape closes the list.
 */
export function latexCompletionExtensions(load: LatexCompletionDataLoader = loadBundledData): Extension {
  return [
    closeBrackets(),
    keymap.of(closeBracketsKeymap),
    autocompletion({ override: [latexEnvironmentSource(load), latexCommandSource(load)], icons: false }),
  ];
}
