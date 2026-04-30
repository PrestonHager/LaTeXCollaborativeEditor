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

  it('applies warning and info line classes', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const state = EditorState.create({
      doc: 'x\ny\n',
      extensions: diagnosticsExtensions,
    });
    const view = new EditorView({ state, parent });
    setEditorDiagnostics(view, [
      { line: 1, severity: 'warning', message: 'w' },
      { line: 2, severity: 'info', message: 'i' },
    ]);
    expect(parent.querySelector('.cm-warning-line')).toBeTruthy();
    expect(parent.querySelector('.cm-info-line')).toBeTruthy();
    view.destroy();
    parent.remove();
  });

  it('clamps diagnostic line to document bounds', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const state = EditorState.create({
      doc: 'only\n',
      extensions: diagnosticsExtensions,
    });
    const view = new EditorView({ state, parent });
    setEditorDiagnostics(view, [{ line: 99, severity: 'error', message: 'e' }]);
    expect(parent.querySelector('.cm-error-line')).toBeTruthy();
    view.destroy();
    parent.remove();
  });
});
