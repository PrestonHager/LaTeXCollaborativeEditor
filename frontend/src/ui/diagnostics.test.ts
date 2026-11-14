import { Compartment, EditorState, type Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { diagnosticsExtensions, diagnosticsToLint, lintGutterPlaceholder, loadLintExtensions, setEditorDiagnostics, setProjectDiagnostics, setsDiagnostics } from './diagnostics';

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

  it('keeps the project checks apart from the preview, and marks just the key when given a column', () => {
    const state = EditorState.create({ doc: 'see \\ref{x}\ntwo\n', extensions: diagnosticsExtensions });
    const view = new EditorView({ state, parent: document.createElement('div') });
    setEditorDiagnostics(view, [{ line: 2, severity: 'error', message: 'preview' }]);
    setProjectDiagnostics(view, [
      { line: 1, column: 9, length: 1, severity: 'warning', message: 'undefined' },
      { line: 1, column: 40, length: 5, severity: 'warning', message: 'past the end' },
      { line: 1, column: 0, severity: 'warning', message: 'no length' },
    ]);
    // A new compile replaces only the preview's.
    setEditorDiagnostics(view, [{ line: 2, severity: 'error', message: 'preview again' }]);
    expect(diagnosticsToLint(view)).toEqual([
      { from: 12, to: 15, severity: 'error', message: 'preview again' },
      { from: 9, to: 10, severity: 'warning', message: 'undefined' },
      { from: 11, to: 11, severity: 'warning', message: 'past the end' },
      { from: 0, to: 0, severity: 'warning', message: 'no length' },
    ]);
    expect(view.dom.querySelectorAll('.cm-warning-line')).toHaveLength(1);
    view.destroy();
  });

  it('shows a problem the preview and the project checks both found once', () => {
    const state = EditorState.create({ doc: 'a\nb\n', extensions: diagnosticsExtensions });
    const view = new EditorView({ state, parent: document.createElement('div') });
    setEditorDiagnostics(view, [{ line: 1, severity: 'warning', message: 'preview', subject: 'cite:k' }, { line: 2, severity: 'info', message: 'note' }]);
    setProjectDiagnostics(view, [
      { line: 1, severity: 'warning', message: 'project', subject: 'cite:k' },
      { line: 1, severity: 'warning', message: 'other key', subject: 'cite:j' },
      { line: 2, severity: 'warning', message: 'other line', subject: 'cite:k' },
    ]);
    expect(diagnosticsToLint(view).map((d) => d.message)).toEqual(['preview', 'note', 'other key', 'other line']);
    view.destroy();
  });

  it('tells the linter to read again when either set changes', () => {
    const transactions: Transaction[] = [];
    const state = EditorState.create({
      doc: 'x',
      extensions: [diagnosticsExtensions, EditorView.updateListener.of((update) => transactions.push(...update.transactions))],
    });
    const view = new EditorView({ state, parent: document.createElement('div') });
    setEditorDiagnostics(view, []);
    setProjectDiagnostics(view, []);
    view.dispatch({ changes: { from: 0, insert: 'y' } });
    expect(transactions.map(setsDiagnostics)).toEqual([true, true, false]);
    view.destroy();
  });

  it('refreshes the lint gutter when diagnostics are set without an edit', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const lint = await loadLintExtensions();
    vi.useFakeTimers();
    const view = new EditorView({
      state: EditorState.create({ doc: 'a\nb\n', extensions: [diagnosticsExtensions, lint] }),
      parent,
    });
    try {
      await vi.advanceTimersByTimeAsync(2000);
      setProjectDiagnostics(view, [{ line: 2, severity: 'warning', message: 'later' }]);
      await vi.advanceTimersByTimeAsync(2000);
      expect(parent.querySelector('.cm-lint-marker-warning')).toBeTruthy();
    } finally {
      vi.useRealTimers();
      view.destroy();
      parent.remove();
    }
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
