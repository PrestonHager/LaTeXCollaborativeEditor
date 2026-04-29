import { createFileMenu } from './fileMenu';

describe('createFileMenu', () => {
  it('renders all expected actions and wires click handlers', async () => {
    const container = document.createElement('div');
    const calls: string[] = [];
    const menu = createFileMenu(container, {
      onOpenLocal: () => calls.push('open'),
      onDownload: () => calls.push('download'),
      onConnectDrive: async () => {
        calls.push('connect');
      },
      onSaveNow: async () => {
        calls.push('save');
      },
      mode: 'host',
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Open Local Doc',
      'Download .tex',
      'Connect Google Drive',
      'Save Now',
    ]);

    buttons.forEach((b) => b.click());
    await Promise.resolve();
    expect(calls).toEqual(['open', 'download', 'connect', 'save']);

    menu.setSaveNowEnabled(false);
    expect(buttons[3].hasAttribute('disabled')).toBe(true);
  });

  it('renders download only in client mode', () => {
    const container = document.createElement('div');
    const calls: string[] = [];
    createFileMenu(container, {
      onOpenLocal: () => calls.push('open'),
      onDownload: () => calls.push('download'),
      onConnectDrive: async () => {
        calls.push('connect');
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
