import { createEditorPane } from './editor';

describe('createEditorPane', () => {
  it('emits text changes from user input', () => {
    const container = document.createElement('div');
    const editor = createEditorPane(container);
    const seen: Array<{ text: string; sync?: boolean }> = [];
    editor.onTextChanged((text, sync) => seen.push({ text, sync }));

    const textarea = container.querySelector('textarea')!;
    textarea.value = 'hello';
    textarea.dispatchEvent(new Event('input'));

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
});
