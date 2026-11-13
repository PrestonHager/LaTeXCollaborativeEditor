import { EditorView } from '@codemirror/view';
import { createEditorPane, editorKeybinds, editorKeymap } from './editor';

// Scrolling the cursor into view measures text, which jsdom can't do, so give it empty boxes.
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

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

  it('setDiagnostics updates lint state', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createEditorPane(container);
    editor.setDiagnostics([{ line: 1, severity: 'warning', message: 'w' }]);
    expect(container.querySelector('.cm-warning-line')).toBeTruthy();
    // The lint gutter loads after the editor, in the same spot as its placeholder.
    await editor.lintReady();
    expect(container.querySelectorAll('.cm-gutter-lint')).toHaveLength(1);
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

  describe('keys', () => {
    const press = (editor: ReturnType<typeof createEditorPane>, init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      editor.getView().contentDOM.dispatchEvent(event);
      return event;
    };

    it("leaves Ctrl+Enter to the app's Compile Now", () => {
      expect(editorKeymap.some((binding) => binding.key === 'Mod-Enter')).toBe(false);
      const container = document.createElement('div');
      document.body.appendChild(container);
      const editor = createEditorPane(container);
      editor.setText('line');
      const event = press(editor, { key: 'Enter', code: 'Enter', keyCode: 13, ctrlKey: true });
      expect(event.defaultPrevented).toBe(false);
      expect(editor.getText()).toBe('line');
      editor.getView().destroy();
      container.remove();
    });

    it('keeps its own keys, like Ctrl+] to indent', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const editor = createEditorPane(container);
      editor.setText('x');
      const event = press(editor, { key: ']', code: 'BracketRight', keyCode: 221, ctrlKey: true });
      expect(event.defaultPrevented).toBe(true);
      expect(editor.getText()).toBe('  x');
      editor.getView().destroy();
      container.remove();
    });
  });

  it("lists the editor's own keys the app's way, for each platform", () => {
    const other = editorKeybinds('other');
    // Indent, undo from the shared undo stack, and delete line.
    expect(other).toContain('Mod+]');
    expect(other).toContain('Mod+Z');
    expect(other).toContain('Mod+Shift+K');
    // Compile Now has Ctrl+Enter, and plain keys like Enter are never listed.
    expect(other).not.toContain('Mod+Enter');
    expect(other).not.toContain('Enter');
    expect([...other].every((keybind) => /Mod|Ctrl|Alt|Meta|F\d/.test(keybind))).toBe(true);
    // Some editor keys are different on a Mac, like Ctrl+A for start of line.
    const mac = editorKeybinds('mac');
    expect(mac).toContain('Mod+]');
    expect(mac).not.toEqual(other);
  });

  it('inserts text in place of the selection, unless it is read-only', () => {
    const container = document.createElement('div');
    const editor = createEditorPane(container);
    editor.setText('Hello world');
    const view = editor.getView();
    view.dispatch({ selection: { anchor: 6, head: 11 } });
    expect(editor.insertText('there')).toBe(true);
    expect(editor.getText()).toBe('Hello there');
    expect(view.state.selection.main.head).toBe(11);
    editor.setEditable(false);
    expect(editor.insertText('!')).toBe(false);
    expect(editor.getText()).toBe('Hello there');
  });
});
