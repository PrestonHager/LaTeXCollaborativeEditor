import { createEditorPane } from './ui/editor';
import { createFileMenu } from './ui/fileMenu';
import { LocalDownloadStorage } from './storage/localDownload';
import { AutosaveController } from './storage/autosave';

describe('App integration behavior', () => {
  it('connects editor changes to autosave lifecycle', async () => {
    vi.useFakeTimers();
    const editorHost = document.createElement('div');
    const editor = createEditorPane(editorHost);
    const statuses: string[] = [];
    const save = vi.fn(async () => {});
    const provider = { connect: async () => true, save, status: () => 'x' };

    const autosave = new AutosaveController({
      provider: () => provider,
      getContent: () => editor.getText(),
      getFileName: () => 'document.tex',
      onStatus: (s) => statuses.push(s),
    });
    autosave.enable();

    editor.onTextChanged(() => autosave.markDirty());
    editor.setText('integration-content', true);
    vi.advanceTimersByTime(4000);
    await Promise.resolve();
    await Promise.resolve();

    expect(save).toHaveBeenCalledWith('integration-content', 'document.tex');
    expect(statuses).toContain('Saved');
    vi.useRealTimers();
  });

  it('wires file menu download action to local storage adapter', () => {
    const local = new LocalDownloadStorage();
    const downloadSpy = vi.spyOn(local, 'download').mockImplementation(() => {});

    const host = document.createElement('div');
    createFileMenu(host, {
      onOpenLocal: () => undefined,
      onOpenDrive: async () => undefined,
      onDownload: () => local.download('doc.tex', 'x'),
      onConnectDrive: async () => undefined,
      onSaveToDrive: async () => undefined,
      onMoveDrive: async () => undefined,
      onRenameDrive: async () => undefined,
      onSaveNow: async () => undefined,
    });

    const buttons = Array.from(host.querySelectorAll('button'));
    const downloadBtn = buttons.find((b) => b.textContent === 'Download .tex');
    expect(downloadBtn).toBeTruthy();
    downloadBtn!.click();
    expect(downloadSpy).toHaveBeenCalledWith('doc.tex', 'x');
  });
});
