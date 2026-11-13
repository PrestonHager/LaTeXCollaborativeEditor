const loadScript = vi.fn(async () => undefined);
vi.mock('./scriptLoader', () => ({ loadScript: (...args: unknown[]) => loadScript(...(args as [])) }));

type Callback = (data: { action: string; docs?: { id: string; name: string; mimeType: string }[] }) => void;

/** A fake google.picker that records how it was built and lets the test answer for the person. */
function stubPicker() {
  const calls: string[] = [];
  let callback: Callback = () => undefined;
  class DocsView {
    constructor(viewId: string) {
      calls.push(`view ${viewId}`);
    }
    setIncludeFolders(on: boolean) {
      calls.push(`includeFolders ${on}`);
      return this;
    }
    setSelectFolderEnabled(on: boolean) {
      calls.push(`selectFolder ${on}`);
      return this;
    }
    setParent(id: string) {
      calls.push(`parent ${id}`);
      return this;
    }
  }
  class PickerBuilder {
    setOAuthToken() {
      return this;
    }
    setDeveloperKey() {
      return this;
    }
    addView() {
      return this;
    }
    setAppId(id: string) {
      calls.push(`appId ${id}`);
      return this;
    }
    enableFeature(feature: string) {
      calls.push(`feature ${feature}`);
      return this;
    }
    setCallback(cb: Callback) {
      callback = cb;
      return this;
    }
    build() {
      return { setVisible: () => calls.push('visible') };
    }
  }
  window.gapi = { load: (_name: string, options: { callback: () => void }) => options.callback() };
  window.google = {
    picker: {
      DocsView,
      PickerBuilder,
      ViewId: { DOCS: 'DOCS', FOLDERS: 'FOLDERS' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
      Feature: { MULTISELECT_ENABLED: 'multiselect' },
    },
  };
  // The callback is set once the scripts load, so answer on a later tick.
  const answer = (data: Parameters<Callback>[0]) => setTimeout(() => callback(data), 0);
  return { calls, answer };
}

const FOLDER = 'application/vnd.google-apps.folder';

describe('Google Picker', () => {
  afterEach(() => {
    window.gapi = undefined;
    window.google = undefined;
  });

  it('picks one project folder or file', async () => {
    const { openGooglePicker } = await import('./googlePicker');
    const { calls, answer } = stubPicker();
    answer({ action: 'picked', docs: [{ id: 'f1', name: 'Paper', mimeType: FOLDER }, { id: 'f2', name: 'x', mimeType: 'text/plain' }] });
    await expect(openGooglePicker({ accessToken: 't', apiKey: 'k', appId: '42', kind: 'project' })).resolves.toEqual({ id: 'f1', name: 'Paper', isFolder: true });
    expect(calls).toContain('appId 42');
    expect(calls).not.toContain('feature multiselect');

    answer({ action: 'cancel' });
    await expect(openGooglePicker({ accessToken: 't', apiKey: 'k', kind: 'folder' })).resolves.toBeNull();
    expect(calls).toContain('view FOLDERS');
  });

  it('picks many files and folders inside the project folder', async () => {
    const { pickProjectFiles } = await import('./googlePicker');
    const { calls, answer } = stubPicker();
    answer({ action: 'picked', docs: [{ id: 'a', name: 'figs', mimeType: FOLDER }, { id: 'b', name: 'plot.png', mimeType: 'image/png' }] });
    await expect(pickProjectFiles({ accessToken: 't', apiKey: 'k', folderId: 'root1' })).resolves.toEqual([
      { id: 'a', name: 'figs', isFolder: true },
      { id: 'b', name: 'plot.png', isFolder: false },
    ]);
    expect(calls).toEqual(expect.arrayContaining(['view DOCS', 'includeFolders true', 'selectFolder true', 'parent root1', 'feature multiselect', 'visible']));
  });
});
