import { EditorState, Compartment, EditorSelection } from '@codemirror/state';
import { EditorView, keymap, type KeyBinding, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { StreamLanguage } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { bracketMatching } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import type { EditorDiagnostic } from './diagnostics';
import { diagnosticsExtensions, lintGutterPlaceholder, loadLintExtensions, setEditorDiagnostics } from './diagnostics';
import { latexSyntaxHighlighting } from './syntaxHighlight';
import { yUndoManagerKeymap } from 'y-codemirror.next';
import { isAssignableKeybind, normalizeKeybind, type Platform } from './modifierShortcutLabels';
import type { CompletionProject } from './completionProject';
import { createTouchKeyBar } from './touchKeyBar';

type TextChangedHandler = (text: string, sync?: boolean) => void;

/**
 * The editor's own keys. Ctrl+Enter (Cmd+Enter on a Mac) is left out, since the app uses it
 * for Compile Now, and inserting a blank line is just Enter at the end of the line.
 */
export const editorKeymap = [
  ...defaultKeymap.filter((binding) => binding.key !== 'Mod-Enter'),
  indentWithTab,
];

/**
 * The keys that open the completion list, from @codemirror/autocomplete's completionKeymap.
 * That package loads lazily (see latexCompletion.ts), so they're copied here for editorKeybinds.
 */
export const completionOpenKeys: readonly KeyBinding[] = [
  { key: 'Ctrl-Space' },
  { mac: 'Alt-`' },
  { mac: 'Alt-i' },
];

/**
 * LaTeX autocompletion and closing brackets. @codemirror/autocomplete and the command list aren't
 * needed to show the editor, so they load just after the page does.
 */
export async function loadCompletionExtensions(
  load: () => Promise<Pick<typeof import('./latexCompletion'), 'latexCompletionExtensions'>> = () => import('./latexCompletion'),
  getProject: () => CompletionProject | null = () => null,
): Promise<Extension> {
  const { latexCompletionExtensions } = await load();
  return latexCompletionExtensions(undefined, getProject);
}

/**
 * The editor's own keys that use a modifier, written the app's way (like "Mod+Shift+K").
 * The editor handles these first while you type in it, so Settings warns before you give one to a command.
 */
export function editorKeybinds(platform: Platform): Set<string> {
  const keys = new Set<string>();
  for (const binding of [...editorKeymap, ...yUndoManagerKeymap, ...completionOpenKeys]) {
    const key = (platform === 'mac' ? binding.mac : binding.win ?? binding.linux) ?? binding.key;
    // CodeMirror joins with "-", and a trailing "-" is the minus key itself.
    const keybind = key && normalizeKeybind(key.replace(/-(?!$)/g, '+'), platform);
    if (keybind && isAssignableKeybind(keybind)) keys.add(keybind);
  }
  return keys;
}

const DEFAULT_DOC = '\\documentclass{article}\n\\begin{document}\nHello, collaborative LaTeX!\n\\end{document}\n';

export function createEditorPane(container: HTMLElement) {
  const host = document.createElement('div');
  host.className = 'editor';
  container.appendChild(host);

  const handlers: TextChangedHandler[] = [];
  let suppress = false;
  const collabCompartment = new Compartment();
  const editableCompartment = new Compartment();
  // Holds a placeholder until @codemirror/lint has loaded, then the real lint gutter and linter.
  const lintCompartment = new Compartment();
  // Empty until latexCompletion.ts has loaded, then autocompletion and closing brackets.
  const completionCompartment = new Compartment();
  // The project that \ref, \cite and \input complete from (issue #193). Set with setCompletionProject.
  let completionProject: CompletionProject | null = null;

  const state = EditorState.create({
    doc: DEFAULT_DOC,
    extensions: [
      lineNumbers(),
      EditorView.lineWrapping,
      highlightActiveLine(),
      highlightActiveLineGutter(),
      bracketMatching(),
      completionCompartment.of([]),
      lintCompartment.of(lintGutterPlaceholder),
      StreamLanguage.define(stex),
      latexSyntaxHighlighting,
      diagnosticsExtensions,
      collabCompartment.of([]),
      editableCompartment.of([
        EditorView.editable.of(true),
        EditorState.readOnly.of(false),
      ]),
      keymap.of(editorKeymap),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || suppress) return;
        const text = update.state.doc.toString();
        handlers.forEach((h) => h(text, true));
      }),
    ],
  });

  const view = new EditorView({ state, parent: host });
  // LaTeX keys above the on-screen keyboard, on touch devices while the editor has focus.
  const touchKeyBar = createTouchKeyBar(view, container);
  // Lines with problems are highlighted without it, so if it can't load, just log that.
  const lintReady = loadLintExtensions().then(
    (extensions) => view.dispatch({ effects: lintCompartment.reconfigure(extensions) }),
    (error: unknown) => console.warn('Lint gutter failed to load', error),
  );
  // Typing works without it, so if it can't load, just log that.
  const completionReady = loadCompletionExtensions(undefined, () => completionProject).then(
    (extensions) => view.dispatch({ effects: completionCompartment.reconfigure(extensions) }),
    (error: unknown) => console.warn('Autocompletion failed to load', error),
  );

  return {
    onTextChanged(handler: TextChangedHandler) { handlers.push(handler); },
    getText() { return view.state.doc.toString(); },
    getView() { return view; },
    /** The bar of LaTeX keys shown above the on-screen keyboard. */
    getTouchKeyBar() { return touchKeyBar.element; },
    /** Resolves once the lint gutter is in (or failed to load). For tests. */
    lintReady() { return lintReady; },
    /** Resolves once autocompletion is in (or failed to load). For tests. */
    completionReady() { return completionReady; },
    /** The project that labels, citations and paths complete from, or null for none. */
    setCompletionProject(project: CompletionProject | null) { completionProject = project; },
    setCollabExtensions(extensions: Extension[]) {
      view.dispatch({
        effects: collabCompartment.reconfigure(extensions),
      });
    },
    setDiagnostics(diagnostics: EditorDiagnostic[]) {
      setEditorDiagnostics(view, diagnostics);
    },
    setEditable(isEditable: boolean) {
      view.dispatch({
        effects: editableCompartment.reconfigure([
          EditorView.editable.of(isEditable),
          EditorState.readOnly.of(!isEditable),
        ]),
      });
      touchKeyBar.refresh();
    },
    focus() { view.focus(); },
    selectAll() {
      view.dispatch({
        selection: EditorSelection.range(0, view.state.doc.length),
      });
      view.focus();
    },
    /** Put text in place of the selection, like a paste. False when the editor is read-only. */
    insertText(text: string) {
      if (view.state.readOnly) return false;
      view.dispatch(view.state.replaceSelection(text), { userEvent: 'input.paste', scrollIntoView: true });
      view.focus();
      return true;
    },
    setText(value: string, shouldSync = false) {
      suppress = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
      suppress = false;
      handlers.forEach((h) => h(value, shouldSync));
    },
  };
}
