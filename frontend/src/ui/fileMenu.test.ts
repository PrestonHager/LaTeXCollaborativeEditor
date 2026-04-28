import { createFileMenu } from './fileMenu';

describe('createFileMenu', () => {
  it('renders all expected actions and wires click handlers', async () => {
    const container = document.createElement('div');
    const calls: string[] = [];
    createFileMenu(container, {
      onDownload: () => calls.push('download'),
      onConnectDrive: async () => {
        calls.push('connect');
      },
      onSaveNow: async () => {
        calls.push('save');
      },
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Download .tex',
      'Connect Google Drive',
      'Save Now',
    ]);

    buttons.forEach((b) => b.click());
    await Promise.resolve();
    expect(calls).toEqual(['download', 'connect', 'save']);
  });
});
