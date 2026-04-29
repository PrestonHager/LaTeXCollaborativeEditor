import { setupShareButton } from './shareButton';

describe('setupShareButton', () => {
  it('writes generated room URL into clickable link and clipboard', async () => {
    const button = document.createElement('button');
    const link = document.createElement('a');
    const copyText = vi.fn(async () => undefined);

    setupShareButton({
      button,
      linkEl: link,
      getRoomId: () => 'room-123',
      getCurrentUrl: () => 'https://latex.prestonhager.com/?foo=bar',
      copyText,
    });

    button.click();
    await Promise.resolve();

    expect(link.href).toBe('https://latex.prestonhager.com/?foo=bar&room=room-123');
    expect(link.textContent).toBe('https://latex.prestonhager.com/?foo=bar&room=room-123');
    expect(copyText).toHaveBeenCalledWith('https://latex.prestonhager.com/?foo=bar&room=room-123');
  });

  it('replaces previous room value when URL already has room param', async () => {
    const button = document.createElement('button');
    const link = document.createElement('a');

    setupShareButton({
      button,
      linkEl: link,
      getRoomId: () => 'next-room',
      getCurrentUrl: () => 'http://localhost:5173/?room=old-room',
      copyText: async () => undefined,
    });

    button.click();
    await Promise.resolve();
    expect(link.textContent).toBe('http://localhost:5173/?room=next-room');
  });
});
