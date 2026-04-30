import { EditorView } from '@codemirror/view';
import { createEditorPane } from './editor';

describe('createEditorPane', () => {
  it('emits text changes from user input', () => {
    const container = document.createElement('div');
    const editor = createEditorPane(container);
    const seen: Array<{ text: string; sync?: boolean }> = [];
    editor.onTextChanged((text, sync) => seen.push({ text, sync }));

    const view = editor.getView();
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'hello' },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ text: 'hello', sync: true });
  });

  it('supports programmatic setText with sync flag', () => {
    const container = document.createElement('div');
    const editor = createEditorPane(container);
    const seen: Array<{ text: string; sync?: boolean }> = [];
    editor.onTextChanged((text, sync) => seen.push({ text, sync }));

    editor.setText('remote', false);
    expect(editor.getText()).toBe('remote');
    expect(seen[0]).toEqual({ text: 'remote', sync: false });
  });

  it('renders line numbers in gutters', () => {
    const container = document.createElement('div');
    createEditorPane(container);
    expect(container.querySelector('.cm-gutters')).toBeTruthy();
  });

  it('reconfigures collab compartment via setCollabExtensions', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createEditorPane(container);
    editor.setCollabExtensions([EditorView.theme({ '.cm-editor': { minHeight: '1px' } })]);
    expect(editor.getView().state).toBeDefined();
    editor.getView().destroy();
    container.remove();
  });

  it('setDiagnostics updates lint state', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createEditorPane(container);
    editor.setDiagnostics([{ line: 1, severity: 'warning', message: 'w' }]);
    expect(container.querySelector('.cm-warning-line')).toBeTruthy();
    editor.getView().destroy();
    container.remove();
  });

  it('setEditable toggles read-only and selectAll selects full document', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createEditorPane(container);
    editor.setEditable(false);
    expect(editor.getView().state.readOnly).toBe(true);
    editor.setEditable(true);
    editor.selectAll();
    const sel = editor.getView().state.selection.main;
    expect(sel.from).toBe(0);
    expect(sel.to).toBe(editor.getView().state.doc.length);
    editor.getView().destroy();
    container.remove();
  });

  it('focus targets the CodeMirror view', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createEditorPane(container);
    editor.focus();
    expect(editor.getView().hasFocus).toBe(true);
    editor.getView().destroy();
    container.remove();
  });
});
