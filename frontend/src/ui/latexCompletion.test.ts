import { CompletionContext, type Completion, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  argsLabel,
  commandCompletion,
  environmentCompletion,
  isInComment,
  latexCommandSource,
  latexCompletionExtensions,
  latexEnvironmentSource,
  type LatexCompletionData,
} from './latexCompletion';
import { LATEX_COMMANDS, LATEX_ENVIRONMENTS } from './latexCompletionData';

const bundled = (): Promise<LatexCompletionData> => Promise.resolve({ commands: LATEX_COMMANDS, environments: LATEX_ENVIRONMENTS });

// Scrolling the cursor into view measures text, which jsdom can't do, so give it empty boxes.
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

const views: EditorView[] = [];

/** A view with the first `|` marking the cursor. Any later `|` is part of the text. */
function viewWith(text: string, extensions: Extension = []) {
  const pos = text.indexOf('|');
  const doc = text.slice(0, pos) + text.slice(pos + 1);
  const state = EditorState.create({ doc, selection: { anchor: pos }, extensions });
  const view = new EditorView({ state, parent: document.body });
  views.push(view);
  return view;
}

function contextAt(view: EditorView, explicit = false) {
  return new CompletionContext(view.state, view.state.selection.main.head, explicit);
}

function find(result: CompletionResult | null, label: string): Completion {
  const option = result?.options.find((o) => o.label === label);
  if (!option) throw new Error(`no option ${label}`);
  return option;
}

/** Applies a completion the way CodeMirror does when you accept it. */
function accept(view: EditorView, result: CompletionResult, label: string) {
  const option = find(result, label);
  const to = view.state.selection.main.head;
  if (typeof option.apply === 'function') option.apply(view, option, result.from, to);
  else view.dispatch({ changes: { from: result.from, to, insert: option.apply ?? option.label } });
}

const withCursor = (view: EditorView) => {
  const text = view.state.doc.toString();
  const head = view.state.selection.main;
  return text.slice(0, head.from) + '|' + text.slice(head.to);
};

afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.innerHTML = '';
});

describe('latexCommandSource', () => {
  it('offers \\section{} for \\sec, with its arguments and what it does', async () => {
    const view = viewWith('\\sec|');
    const result = await latexCommandSource(bundled)(contextAt(view));
    expect(result?.from).toBe(0);
    const section = find(result, '\\section');
    expect(section.detail).toBe('{title}');
    expect(section.info).toBe('Section heading');
    accept(view, result!, '\\section');
    expect(view.state.doc.toString()).toBe('\\section{title}');
    // The placeholder is selected, so typing replaces it.
    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe('title');
  });

  it('moves to the next argument with Tab', async () => {
    const extensions = latexCompletionExtensions(bundled);
    const view = viewWith('\\fra|', extensions);
    const result = await latexCommandSource(bundled)(contextAt(view));
    accept(view, result!, '\\frac');
    // The selected placeholder shows as |.
    expect(withCursor(view)).toBe('\\frac{|}{den}');
    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe('num');
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true, cancelable: true }));
    const next = view.state.selection.main;
    expect(view.state.sliceDoc(next.from, next.to)).toBe('den');
  });

  it('inserts a command without arguments as it is', async () => {
    const view = viewWith('$\\alp|$');
    const result = await latexCommandSource(bundled)(contextAt(view));
    expect(find(result, '\\alpha').detail).toBeUndefined();
    accept(view, result!, '\\alpha');
    expect(view.state.doc.toString()).toBe('$\\alpha$');
  });

  it('turns \\begin into \\begin{} and opens the environment list', async () => {
    const view = viewWith('\\beg|', latexCompletionExtensions(bundled));
    const result = await latexCommandSource(bundled)(contextAt(view));
    expect(find(result, '\\begin').detail).toBe('{environment}');
    accept(view, result!, '\\begin');
    expect(withCursor(view)).toBe('\\begin{|}');
  });

  it('reuses a { that is already there after \\begin', async () => {
    const view = viewWith('\\beg|{}');
    const result = await latexCommandSource(bundled)(contextAt(view));
    accept(view, result!, '\\begin');
    expect(withCursor(view)).toBe('\\begin{|}');
  });

  it('starts after a lone backslash', async () => {
    const view = viewWith('text \\|');
    const result = await latexCommandSource(bundled)(contextAt(view));
    expect(result?.from).toBe(5);
    expect(result?.validFor).toBeInstanceOf(RegExp);
    expect((result?.validFor as RegExp).test('\\subs')).toBe(true);
  });

  it('stays quiet without a backslash, after \\\\, and in comments', async () => {
    const source = latexCommandSource(bundled);
    expect(await source(contextAt(viewWith('plain|')))).toBeNull();
    expect(await source(contextAt(viewWith('line\\\\|')))).toBeNull();
    expect(await source(contextAt(viewWith('% note \\sec|')))).toBeNull();
    // An escaped percent sign isn't a comment.
    expect(await source(contextAt(viewWith('50\\% \\sec|')))).not.toBeNull();
  });

  it('loads the data once', async () => {
    const load = vi.fn(bundled);
    const source = latexCommandSource(load);
    await source(contextAt(viewWith('\\a|')));
    await source(contextAt(viewWith('\\b|')));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('offers nothing if the data fails to load, and tries again next time', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const load = vi.fn<() => Promise<LatexCompletionData>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(bundled);
    const source = latexCommandSource(load);
    expect(await source(contextAt(viewWith('\\sec|')))).toBeNull();
    expect(warn).toHaveBeenCalledWith('LaTeX completions failed to load', expect.any(Error));
    expect(await source(contextAt(viewWith('\\sec|')))).not.toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('loads the bundled data by default', async () => {
    const result = await latexCommandSource()(contextAt(viewWith('\\sec|')));
    expect(find(result, '\\section')).toBeTruthy();
  });
});

describe('latexEnvironmentSource', () => {
  it('offers itemize for \\begin{it and adds \\end{itemize}', async () => {
    const view = viewWith('\\begin{it|', latexCompletionExtensions(bundled));
    const result = await latexEnvironmentSource(bundled)(contextAt(view));
    expect(result?.from).toBe('\\begin{'.length);
    expect(find(result, 'itemize').info).toBe('Bulleted list');
    accept(view, result!, 'itemize');
    expect(view.state.doc.toString()).toBe('\\begin{itemize}\n  \\item \n\\end{itemize}');
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(2);
  });

  it('takes over the } that closing brackets added, and keeps the indentation', async () => {
    const view = viewWith('  \\begin{cen|}');
    const result = await latexEnvironmentSource(bundled)(contextAt(view));
    accept(view, result!, 'center');
    expect(withCursor(view)).toBe('  \\begin{center}\n    |\n  \\end{center}');
  });

  it('puts arguments after \\begin{name}, with tab stops', async () => {
    const view = viewWith('\\begin{tabu|}');
    const result = await latexEnvironmentSource(bundled)(contextAt(view));
    expect(find(result, 'tabular').detail).toBe('{cols}');
    accept(view, result!, 'tabular');
    expect(view.state.doc.toString()).toBe('\\begin{tabular}{cols}\n  \n\\end{tabular}');
    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe('cols');
  });

  it('matches starred names and stays quiet elsewhere', async () => {
    const source = latexEnvironmentSource(bundled);
    const starred = await source(contextAt(viewWith('\\begin{align*|')));
    expect((starred?.validFor as RegExp).test('align*')).toBe(true);
    expect(await source(contextAt(viewWith('\\sec|')))).toBeNull();
    expect(await source(contextAt(viewWith('%\\begin{it|')))).toBeNull();
    expect(await source(contextAt(viewWith('\\\\begin{it|')))).toBeNull();
  });

  it('offers nothing if the data fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = latexEnvironmentSource(() => Promise.reject(new Error('offline')));
    expect(await source(contextAt(viewWith('\\begin{|')))).toBeNull();
    warn.mockRestore();
  });
});

describe('completion helpers', () => {
  it('shows snippet arguments as plain text', () => {
    expect(argsLabel('[#{options}]{#{class}}')).toBe('[options]{class}');
    expect(argsLabel('(#{}\\right)')).toBe('(\\right)');
    expect(argsLabel('')).toBe('');
  });

  it('tells comments from escaped percent signs', () => {
    expect(isInComment('% note')).toBe(true);
    expect(isInComment('text % note')).toBe(true);
    expect(isInComment('50\\% off')).toBe(false);
    expect(isInComment('line\\\\% note')).toBe(true);
    expect(isInComment('plain')).toBe(false);
  });

  it('builds options for every bundled command and environment', () => {
    for (const command of LATEX_COMMANDS) {
      const option = commandCompletion(command);
      expect(option.label).toBe(`\\${command[0]}`);
      // Snippet templates read \{ and \} as escaped braces, which would drop the backslash.
      expect(command[1]).not.toMatch(/\\[{}]/);
    }
    for (const environment of LATEX_ENVIRONMENTS) {
      expect(environmentCompletion(environment).label).toBe(environment[0]);
    }
    const names = LATEX_COMMANDS.map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('latexCompletionExtensions', () => {
  it('closes brackets as you type', () => {
    const view = viewWith('|', latexCompletionExtensions(bundled));
    const handled = view.state.facet(EditorView.inputHandler).some((handler) => handler(view, 0, 0, '{', () => view.state.update({ changes: { from: 0, insert: '{' } })));
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe('{}');
  });
});
