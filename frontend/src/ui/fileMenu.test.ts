import { createFileMenu } from './fileMenu';

describe('createFileMenu', () => {
  it('renders all expected actions and wires click handlers', async () => {
    const container = document.createElement('div');
    const calls: string[] = [];
    const menu = createFileMenu(container, {
      onOpenLocal: () => calls.push('open'),
      onOpenDrive: async () => {
        calls.push('open-drive');
      },
      onDownload: () => calls.push('download'),
      onConnectDrive: async () => {
        calls.push('connect');
      },
      onSaveToDrive: async () => {
        calls.push('save-drive');
      },
      onMoveDrive: async () => {
        calls.push('move');
      },
      onRenameDrive: async () => {
        calls.push('rename');
      },
      onSaveNow: async () => {
        calls.push('save');
      },
      mode: 'host',
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Open Local Doc',
      'Open from Google Drive',
      'Download .tex',
      'Connect Google Drive',
      'Save to Google Drive',
      'Move to Drive Folder',
      'Rename in Drive',
      'Save Now',
    ]);

    buttons.forEach((b) => b.click());
    await Promise.resolve();
    expect(calls).toEqual(['open', 'open-drive', 'download', 'connect', 'save-drive', 'move', 'rename', 'save']);

    menu.setSaveNowEnabled(false);
    expect(buttons[7].hasAttribute('disabled')).toBe(true);
  });

  it('renders download only in client mode', () => {
    const container = document.createElement('div');
    const calls: string[] = [];
    createFileMenu(container, {
      onOpenLocal: () => calls.push('open'),
      onOpenDrive: async () => {
        calls.push('open-drive');
      },
      onDownload: () => calls.push('download'),
      onConnectDrive: async () => {
        calls.push('connect');
      },
      onSaveToDrive: async () => {
        calls.push('save-drive');
      },
      onMoveDrive: async () => {
        calls.push('move');
      },
      onRenameDrive: async () => {
        calls.push('rename');
      },
      onSaveNow: async () => {
        calls.push('save');
      },
      mode: 'client',
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Download .tex']);
    buttons[0].click();
    expect(calls).toEqual(['download']);
  });
});
