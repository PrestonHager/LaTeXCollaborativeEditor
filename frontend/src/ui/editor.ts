import { EditorState, Compartment, EditorSelection } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { StreamLanguage } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { bracketMatching } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { lintGutter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { EditorDiagnostic } from './diagnostics';
import { diagnosticsExtensions, setEditorDiagnostics } from './diagnostics';

type TextChangedHandler = (text: string, sync?: boolean) => void;

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
      history(),
      bracketMatching(),
      closeBrackets(),
      lintGutter(),
      StreamLanguage.define(stex),
      diagnosticsExtensions,
      collabCompartment.of([]),
      editableCompartment.of([
        EditorView.editable.of(true),
        EditorState.readOnly.of(false),
      ]),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...closeBracketsKeymap,
        indentWithTab,
      ]),
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
