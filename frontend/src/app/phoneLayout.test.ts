import { createPhoneLayout, PHONE_PANE_KEY, type PhonePane } from './phoneLayout';

function setup(options: { phone?: boolean; storage?: Storage | null; onPaneChange?: (pane: PhonePane) => void } = {}) {
  document.body.innerHTML = `
    <div id="app">
      <button id="files" type="button">Files</button>
      <button id="show-editor" type="button">Editor</button>
      <button id="show-preview" type="button">Preview</button>
      <div class="workspace">
        <div id="backdrop" hidden></div>
        <aside id="file-pane">
          <ul>
            <li class="file-row"><button class="file-row-main" id="row-a">a.tex</button></li>
            <li class="file-row is-active"><button class="file-row-main" id="row-b">b.tex</button></li>
          </ul>
        </aside>
        <main id="split"><section id="editor-pane" tabindex="-1"></section><section id="preview-pane"></section></main>
      </div>
    </div>`;
  let phone = options.phone ?? true;
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const phoneLayout = createPhoneLayout({
    root: get('app'),
    editorButton: get('show-editor'),
    previewButton: get('show-preview'),
    filesButton: get('files'),
    filePane: get('file-pane'),
    backdrop: get('backdrop'),
    content: get('split'),
    editorPane: get('editor-pane'),
    isPhone: () => phone,
    storage: options.storage === undefined ? sessionStorage : options.storage,
    onPaneChange: options.onPaneChange,
  });
  return { phoneLayout, get, setPhone: (value: boolean) => (phone = value) };
}

describe('phone layout', () => {
  afterEach(() => {
    sessionStorage.clear();
    document.body.innerHTML = '';
  });

  it('starts on the editor with the drawer closed', () => {
    const { phoneLayout, get } = setup();
    expect(phoneLayout.pane).toBe('editor');
    expect(get('app').dataset.phonePane).toBe('editor');
    expect(get('show-editor').getAttribute('aria-pressed')).toBe('true');
    expect(get('show-preview').getAttribute('aria-pressed')).toBe('false');
    expect(get('files').getAttribute('aria-expanded')).toBe('false');
    expect(get('backdrop').hidden).toBe(true);
  });

  it('switches panes with the buttons and keeps the choice for the session', () => {
    const changes: PhonePane[] = [];
    const { get } = setup({ onPaneChange: (pane) => changes.push(pane) });
    get('show-preview').click();
    expect(get('app').dataset.phonePane).toBe('preview');
    expect(get('show-preview').getAttribute('aria-pressed')).toBe('true');
    expect(get('show-editor').getAttribute('aria-pressed')).toBe('false');
    expect(sessionStorage.getItem(PHONE_PANE_KEY)).toBe('preview');
    // Clicking the pane that's already shown changes nothing.
    get('show-preview').click();
    expect(changes).toEqual(['preview']);

    // A reload in the same tab comes back to the preview.
    const again = setup();
    expect(again.phoneLayout.pane).toBe('preview');
    again.get('show-editor').click();
    expect(sessionStorage.getItem(PHONE_PANE_KEY)).toBe('editor');
  });

  it('ignores a stored value it does not know', () => {
    sessionStorage.setItem(PHONE_PANE_KEY, 'files');
    expect(setup().phoneLayout.pane).toBe('editor');
  });

  it('works when storage is missing or throws', () => {
    const { phoneLayout, get } = setup({ storage: null });
    get('show-preview').click();
    expect(phoneLayout.pane).toBe('preview');

    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    } as unknown as Storage;
    const other = setup({ storage: broken });
    expect(other.phoneLayout.pane).toBe('editor');
    other.get('show-preview').click();
    expect(other.phoneLayout.pane).toBe('preview');
  });

  it('falls back to sessionStorage, and to memory when touching it throws', () => {
    const fromDefault = () =>
      createPhoneLayout({
        root: document.createElement('div'),
        editorButton: document.createElement('button'),
        previewButton: document.createElement('button'),
        filesButton: document.createElement('button'),
        filePane: document.createElement('aside'),
        backdrop: document.createElement('div'),
        content: document.createElement('main'),
        editorPane: document.createElement('section'),
        isPhone: () => true,
      });
    sessionStorage.setItem(PHONE_PANE_KEY, 'preview');
    expect(fromDefault().pane).toBe('preview');

    const spy = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    const layout = fromDefault();
    expect(layout.pane).toBe('editor');
    layout.showPane('preview');
    expect(layout.pane).toBe('preview');
    spy.mockRestore();
  });

  it('opens the drawer over the editor and focuses the open file', () => {
    const { phoneLayout, get } = setup();
    get('show-preview').click();
    get('files').click();
    expect(phoneLayout.filesOpen).toBe(true);
    expect(phoneLayout.pane).toBe('editor');
    expect(get('app').classList.contains('is-files-open')).toBe(true);
    expect(get('files').getAttribute('aria-expanded')).toBe('true');
    expect(get('backdrop').hidden).toBe(false);
    expect(get('split').inert).toBe(true);
    expect(document.activeElement).toBe(get('row-b'));
    // Opening it again does nothing.
    phoneLayout.openFiles();
    expect(phoneLayout.filesOpen).toBe(true);
  });

  it('closes the drawer from the Files button, the backdrop and Escape, and gives focus back', () => {
    const { phoneLayout, get } = setup();
    get('files').click();
    get('files').click();
    expect(phoneLayout.filesOpen).toBe(false);
    expect(get('split').inert).toBe(false);
    expect(document.activeElement).toBe(get('files'));

    get('files').click();
    get('backdrop').click();
    expect(phoneLayout.filesOpen).toBe(false);

    get('files').click();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    get('row-a').dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(phoneLayout.filesOpen).toBe(false);
    expect(document.activeElement).toBe(get('files'));

    // Escape with the drawer closed, and other keys, are left alone.
    const closedEscape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    get('row-a').dispatchEvent(closedEscape);
    expect(closedEscape.defaultPrevented).toBe(false);
    phoneLayout.openFiles();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    get('row-a').dispatchEvent(enter);
    expect(phoneLayout.filesOpen).toBe(true);
    // Closing twice is fine.
    phoneLayout.closeFiles();
    phoneLayout.closeFiles();
    expect(phoneLayout.filesOpen).toBe(false);
  });

  it('closes the drawer and shows the editor after a file is picked', () => {
    const { phoneLayout, get } = setup();
    get('show-preview').click();
    get('files').click();
    // The tree redraws on open, so focus may be on the body by now.
    (document.activeElement as HTMLElement).blur();
    phoneLayout.fileOpened();
    expect(phoneLayout.filesOpen).toBe(false);
    expect(phoneLayout.pane).toBe('editor');
    expect(document.activeElement).toBe(get('editor-pane'));
  });

  it('shows the editor without moving focus when a file opens from elsewhere', () => {
    const { phoneLayout, get } = setup();
    get('show-preview').click();
    get('files').focus();
    phoneLayout.fileOpened();
    expect(phoneLayout.pane).toBe('editor');
    expect(document.activeElement).toBe(get('files'));
  });

  it('leaves desktop and tablet alone', () => {
    const { phoneLayout, get } = setup({ phone: false });
    get('show-preview').click();
    phoneLayout.fileOpened();
    expect(phoneLayout.pane).toBe('preview');
  });

  it('closes the drawer when the window grows past phone width', () => {
    const { phoneLayout, setPhone } = setup();
    phoneLayout.openFiles();
    phoneLayout.viewportChanged();
    expect(phoneLayout.filesOpen).toBe(true);
    setPhone(false);
    phoneLayout.viewportChanged();
    expect(phoneLayout.filesOpen).toBe(false);
  });
});
