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

  it('reports copy success and failure through onStatus', async () => {
    const button = document.createElement('button');
    const link = document.createElement('a');
    const onStatus = vi.fn();
    let fail = false;
    setupShareButton({
      button,
      linkEl: link,
      getRoomId: () => 'r',
      getCurrentUrl: () => 'https://host/',
      copyText: async () => {
        if (fail) throw new Error('denied');
      },
      onStatus,
    });

    button.click();
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('Share link copied to clipboard'));
    fail = true;
    button.click();
    await vi.waitFor(() => expect(onStatus).toHaveBeenLastCalledWith(expect.stringContaining('Could not copy')));
  });

  it('reports when the room cannot be created', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const button = document.createElement('button');
    const link = document.createElement('a');
    const onStatus = vi.fn();
    setupShareButton({
      button,
      linkEl: link,
      getRoomId: () => {
        throw new Error('no crypto');
      },
      getCurrentUrl: () => 'https://host/',
      onStatus,
    });
    button.click();
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('Could not start a share session'));
    expect(link.textContent).toBe('');
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

  it('shows the saved room link on load without copying', () => {
    const button = document.createElement('button');
    const link = document.createElement('a');
    const newLink = document.createElement('button');
    const copyText = vi.fn(async () => undefined);

    setupShareButton({
      button,
      linkEl: link,
      getRoomId: () => 'saved',
      getCurrentUrl: () => 'https://host/',
      copyText,
      initialRoomId: 'saved',
      newLinkButton: newLink,
      getNewRoomId: () => 'fresh',
    });

    expect(link.textContent).toBe('https://host/?room=saved');
    expect(newLink.hidden).toBe(false);
    expect(copyText).not.toHaveBeenCalled();
  });

  it('keeps New link hidden until there is a link', async () => {
    const button = document.createElement('button');
    const link = document.createElement('a');
    const newLink = document.createElement('button');

    setupShareButton({
      button,
      linkEl: link,
      getRoomId: () => 'r',
      getCurrentUrl: () => 'https://host/',
      copyText: async () => undefined,
      newLinkButton: newLink,
      getNewRoomId: () => 'fresh',
    });

    expect(newLink.hidden).toBe(true);
    button.click();
    expect(newLink.hidden).toBe(false);
  });

  it('New link swaps in a fresh room after confirming', async () => {
    const button = document.createElement('button');
    const link = document.createElement('a');
    const newLink = document.createElement('button');
    const copyText = vi.fn(async () => undefined);
    const getNewRoomId = vi.fn(() => 'fresh');
    let confirmed = false;

    setupShareButton({
      button,
      linkEl: link,
      getRoomId: () => 'old',
      getCurrentUrl: () => 'https://host/',
      copyText,
      initialRoomId: 'old',
      newLinkButton: newLink,
      getNewRoomId,
      confirmNewLink: () => confirmed,
    });

    // First, a declined confirm leaves the old link alone.
    newLink.click();
    expect(getNewRoomId).not.toHaveBeenCalled();
    expect(link.textContent).toBe('https://host/?room=old');

    // Now confirm and the new link is shown and copied.
    confirmed = true;
    newLink.click();
    await Promise.resolve();
    expect(getNewRoomId).toHaveBeenCalledTimes(1);
    expect(link.textContent).toBe('https://host/?room=fresh');
    expect(copyText).toHaveBeenCalledWith('https://host/?room=fresh');
  });

  it('uses navigator.clipboard when copyText is omitted', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    const button = document.createElement('button');
    const link = document.createElement('a');
    setupShareButton({
      button,
      linkEl: link,
      getRoomId: () => 'r1',
      getCurrentUrl: () => 'https://host/',
    });

    button.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('https://host/?room=r1');
  });

  it('uses default copy when clipboard API is missing', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });

    const button = document.createElement('button');
    const link = document.createElement('a');
    setupShareButton({
      button,
      linkEl: link,
      getRoomId: () => 'r0',
      getCurrentUrl: () => 'https://host/',
    });

    button.click();
    await Promise.resolve();
    expect(link.href).toContain('room=r0');
  });

  it('ignores clipboard rejection from default copy handler', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    const button = document.createElement('button');
    const link = document.createElement('a');
    setupShareButton({
      button,
      linkEl: link,
      getRoomId: () => 'r2',
      getCurrentUrl: () => 'https://host/',
    });

    button.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(link.href).toContain('room=r2');
  });
});
