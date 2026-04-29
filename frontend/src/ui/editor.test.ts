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
});
