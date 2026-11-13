import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { diagnosticsExtensions, diagnosticsToLint, lintGutterPlaceholder, loadLintExtensions, setEditorDiagnostics } from './diagnostics';

describe('lint gutter loading', () => {
  it('turns diagnostics into lint markers on their lines', () => {
    const state = EditorState.create({ doc: 'one\ntwo\n', extensions: diagnosticsExtensions });
    const view = new EditorView({ state, parent: document.createElement('div') });
    setEditorDiagnostics(view, [
      { line: 2, severity: 'error', message: 'bad' },
      { line: 0, severity: 'info', message: 'clamped' },
    ]);
    expect(diagnosticsToLint(view)).toEqual([
      { from: 4, to: 7, severity: 'error', message: 'bad' },
      { from: 0, to: 3, severity: 'info', message: 'clamped' },
    ]);
    view.destroy();
  });

  it('holds the gutter space with a placeholder until @codemirror/lint loads', async () => {
    const parent = document.createElement('div');
    const compartment = new Compartment();
    const view = new EditorView({
      state: EditorState.create({ doc: 'x', extensions: [diagnosticsExtensions, compartment.of(lintGutterPlaceholder)] }),
      parent,
    });
    expect(parent.querySelector('.cm-gutter-lint')).toBeTruthy();
    view.dispatch({ effects: compartment.reconfigure(await loadLintExtensions()) });
    expect(parent.querySelectorAll('.cm-gutter-lint')).toHaveLength(1);
    view.destroy();
  });

  it('passes a failed load on to the caller', async () => {
    await expect(loadLintExtensions(() => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
  });
});

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
    // Out of order on purpose: a later line first must not throw.
    setEditorDiagnostics(view, [
      { line: 2, severity: 'info', message: 'i' },
      { line: 1, severity: 'warning', message: 'w' },
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
