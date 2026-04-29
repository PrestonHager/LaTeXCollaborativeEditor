import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { diagnosticsExtensions, setEditorDiagnostics } from './diagnostics';

describe('editor diagnostics', () => {
  it('highlights error lines with cm-error-line class', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const state = EditorState.create({
      doc: 'a\nb\nc\n',
      extensions: diagnosticsExtensions,
    });
    const view = new EditorView({ state, parent });
    setEditorDiagnostics(view, [{ line: 3, severity: 'error', message: 'boom' }]);

    const highlighted = parent.querySelector('.cm-error-line');
    expect(highlighted).toBeTruthy();

    view.destroy();
    parent.remove();
  });
});
