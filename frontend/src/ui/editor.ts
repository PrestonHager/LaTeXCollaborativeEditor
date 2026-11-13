import { EditorState, Compartment, EditorSelection } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { StreamLanguage } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { bracketMatching } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { lintGutter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { EditorDiagnostic } from './diagnostics';
import { diagnosticsExtensions, setEditorDiagnostics } from './diagnostics';
import { latexSyntaxHighlighting } from './syntaxHighlight';
import { yUndoManagerKeymap } from 'y-codemirror.next';
import { isAssignableKeybind, normalizeKeybind, type Platform } from './modifierShortcutLabels';

type TextChangedHandler = (text: string, sync?: boolean) => void;

/**
 * The editor's own keys. Ctrl+Enter (Cmd+Enter on a Mac) is left out, since the app uses it
 * for Compile Now, and inserting a blank line is just Enter at the end of the line.
 */
export const editorKeymap = [
  ...defaultKeymap.filter((binding) => binding.key !== 'Mod-Enter'),
  ...closeBracketsKeymap,
  indentWithTab,
];

/**
 * The editor's own keys that use a modifier, written the app's way (like "Mod+Shift+K").
 * The editor handles these first while you type in it, so Settings warns before you give one to a command.
 */
export function editorKeybinds(platform: Platform): Set<string> {
  const keys = new Set<string>();
  for (const binding of [...editorKeymap, ...yUndoManagerKeymap]) {
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

  const state = EditorState.create({
    doc: DEFAULT_DOC,
    extensions: [
      lineNumbers(),
      EditorView.lineWrapping,
      highlightActiveLine(),
      highlightActiveLineGutter(),
      bracketMatching(),
      closeBrackets(),
      lintGutter(),
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

  return {
    onTextChanged(handler: TextChangedHandler) { handlers.push(handler); },
    getText() { return view.state.doc.toString(); },
    getView() { return view; },
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
