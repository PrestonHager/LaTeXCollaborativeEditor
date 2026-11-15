import { setupShareButton, type ShareElements } from './shareButton';

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, root: HTMLElement) => root.appendChild(document.createElement(tag));

/** The popover's parts, in a root that's in the document so focus and outside clicks work. */
function elements(): ShareElements {
  const root = document.body.appendChild(document.createElement('div'));
  return {
    root,
    button: make('button', root),
    popover: make('div', root),
    title: make('h2', root),
    startView: make('div', root),
    startButton: make('button', root),
    resumeButton: make('button', root),
    activeView: make('div', root),
    linkEl: make('a', root),
    copyButton: make('button', root),
    newLinkButton: make('button', root),
    stopButton: make('button', root),
  };
}

type Options = Partial<Parameters<typeof setupShareButton>[0]>;

function setup(options: Options = {}) {
  const els = elements();
  const copyText = vi.fn(async (_value: string) => undefined);
  const startRoom = vi.fn((resumeId?: string) => resumeId ?? 'room-1');
  const newRoom = vi.fn(() => 'fresh');
  const stopSharing = vi.fn();
  const onStatus = vi.fn();
  const controls = setupShareButton({
    ...els,
    getCurrentUrl: () => 'https://host/?foo=bar',
    copyText,
    onStatus,
    startRoom,
    newRoom,
    stopSharing,
    ...options,
  });
  return { els, controls, copyText, startRoom, newRoom, stopSharing, onStatus };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('setupShareButton', () => {
  it('opens the popover without starting a room (issue #224)', () => {
    const { els, controls, startRoom, copyText } = setup();
    expect(els.popover.getAttribute('aria-hidden')).toBe('true');
    expect(els.popover.inert).toBe(true);

    els.button.click();
    expect(controls.isOpen).toBe(true);
    expect(els.button.getAttribute('aria-expanded')).toBe('true');
    expect(els.popover.getAttribute('aria-hidden')).toBe('false');
    expect(els.title.textContent).toBe('Share this project');
    expect(els.startView.hidden).toBe(false);
    expect(els.activeView.hidden).toBe(true);
    expect(els.resumeButton.hidden).toBe(true);
    expect(document.activeElement).toBe(els.startButton);
    expect(startRoom).not.toHaveBeenCalled();
    expect(copyText).not.toHaveBeenCalled();
    expect(els.linkEl.textContent).toBe('');
    expect(controls.roomId).toBeNull();

    // Clicking Share again closes it.
    els.button.click();
    expect(controls.isOpen).toBe(false);
  });

  it('keeps the popover inside the window when Share sits near the right edge (#186)', () => {
    const { els } = setup();
    // jsdom has no layout: offsetParent is null, so offsetLeft is the popover's left edge in the window.
    Object.defineProperty(els.popover, 'offsetLeft', { configurable: true, get: () => 198 });
    Object.defineProperty(els.popover, 'offsetWidth', { configurable: true, get: () => 328 });
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    try {
      els.button.click();
      // 198 + 328 - (360 - 16) = 182px too far right.
      expect(els.popover.style.getPropertyValue('--popover-shift')).toBe('-182px');
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    }
  });

  it('Start sharing creates the room, then shows and copies the link', async () => {
    const { els, controls, startRoom, copyText, onStatus } = setup();
    els.button.click();
    els.startButton.click();
    expect(startRoom).toHaveBeenCalledWith();
    expect(controls.roomId).toBe('room-1');
    expect(els.title.textContent).toBe('Sharing is on');
    expect(els.startView.hidden).toBe(true);
    expect(els.activeView.hidden).toBe(false);
    expect(els.linkEl.href).toBe('https://host/?foo=bar&room=room-1');
    expect(els.linkEl.textContent).toBe('https://host/?foo=bar&room=room-1');
    expect(els.button.dataset.sharing).toBe('true');
    expect(document.activeElement).toBe(els.copyButton);
    expect(copyText).toHaveBeenCalledWith('https://host/?foo=bar&room=room-1');
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('Share link copied to clipboard'));

    // Opening it again shows the link, and Copy copies it again.
    els.button.click();
    els.button.click();
    expect(document.activeElement).toBe(els.copyButton);
    els.copyButton.click();
    expect(copyText).toHaveBeenCalledTimes(2);
    expect(startRoom).toHaveBeenCalledTimes(1);
  });

  it('reports a failed copy', async () => {
    const { els, onStatus } = setup({ copyText: async () => Promise.reject(new Error('denied')) });
    els.startButton.click();
    await vi.waitFor(() => expect(onStatus).toHaveBeenLastCalledWith(expect.stringContaining('Could not copy')));
  });

  it('reports when the room cannot be created', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { els, controls, onStatus } = setup({
      startRoom: () => {
        throw new Error('no crypto');
      },
    });
    els.startButton.click();
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('Could not start a share session'));
    expect(controls.roomId).toBeNull();
    expect(els.startView.hidden).toBe(false);
  });

  it('replaces a room already in the URL', () => {
    const { els } = setup({ getCurrentUrl: () => 'http://localhost:5173/?room=old-room' });
    els.startButton.click();
    expect(els.linkEl.textContent).toBe('http://localhost:5173/?room=room-1');
  });

  it('offers to resume the room from before a reload, without joining it', () => {
    const { els, controls, startRoom, copyText } = setup({ resumeRoomId: 'saved' });
    // Nothing joins and nothing is copied until it's picked.
    expect(startRoom).not.toHaveBeenCalled();
    expect(controls.roomId).toBeNull();
    els.button.click();
    expect(els.resumeButton.hidden).toBe(false);
    expect(els.startView.hidden).toBe(false);
    expect(copyText).not.toHaveBeenCalled();

    els.resumeButton.click();
    expect(startRoom).toHaveBeenCalledWith('saved');
    expect(els.linkEl.textContent).toBe('https://host/?foo=bar&room=saved');
    expect(copyText).toHaveBeenCalledWith('https://host/?foo=bar&room=saved');
    // Once it's used, the offer goes away.
    expect(els.resumeButton.hidden).toBe(true);
  });

  it('Start sharing ignores the remembered room and makes a new one', () => {
    const { els, startRoom } = setup({ resumeRoomId: 'saved' });
    els.startButton.click();
    expect(startRoom).toHaveBeenCalledWith();
    expect(els.linkEl.textContent).toBe('https://host/?foo=bar&room=room-1');
  });

  it('New link swaps in a fresh room after confirming', async () => {
    let confirmed = false;
    const { els, newRoom, copyText } = setup({
      // The real one is the in-app dialog, which answers later.
      confirmNewLink: async () => confirmed,
    });
    els.startButton.click();

    // A declined confirm leaves the old link alone.
    els.newLinkButton.click();
    await Promise.resolve();
    expect(newRoom).not.toHaveBeenCalled();
    expect(els.linkEl.textContent).toBe('https://host/?foo=bar&room=room-1');

    confirmed = true;
    els.newLinkButton.click();
    await vi.waitFor(() => expect(newRoom).toHaveBeenCalled());
    expect(els.linkEl.textContent).toBe('https://host/?foo=bar&room=fresh');
    expect(copyText).toHaveBeenLastCalledWith('https://host/?foo=bar&room=fresh');
  });

  it('Stop sharing leaves the room after confirming, and forgets the link', async () => {
    let confirmed = false;
    const { els, controls, stopSharing, onStatus } = setup({ resumeRoomId: 'saved', confirmStop: async () => confirmed });
    els.button.click();
    els.resumeButton.click();

    els.stopButton.click();
    await Promise.resolve();
    expect(stopSharing).not.toHaveBeenCalled();
    expect(controls.roomId).toBe('saved');

    confirmed = true;
    els.stopButton.click();
    await vi.waitFor(() => expect(stopSharing).toHaveBeenCalledTimes(1));
    expect(controls.roomId).toBeNull();
    expect(els.title.textContent).toBe('Share this project');
    expect(els.startView.hidden).toBe(false);
    expect(els.activeView.hidden).toBe(true);
    // There's nothing to resume after a deliberate stop.
    expect(els.resumeButton.hidden).toBe(true);
    expect(els.linkEl.hasAttribute('href')).toBe(false);
    expect(els.linkEl.textContent).toBe('');
    expect(els.button.dataset.sharing).toBe('false');
    expect(document.activeElement).toBe(els.startButton);
    expect(onStatus).toHaveBeenLastCalledWith(expect.stringContaining('Stopped sharing'));
  });

  it('Stop sharing works without a confirm, and does nothing when not sharing', async () => {
    const { els, stopSharing } = setup();
    els.stopButton.click();
    await Promise.resolve();
    expect(stopSharing).not.toHaveBeenCalled();
    els.startButton.click();
    // Closed popover: the state still updates.
    els.button.click();
    els.button.click();
    els.stopButton.click();
    await vi.waitFor(() => expect(stopSharing).toHaveBeenCalled());
  });

  it('guests see their room link with Copy only', () => {
    const { els, controls, copyText } = setup({ guestRoomId: 'guest-room', startRoom: undefined, newRoom: undefined, stopSharing: undefined });
    expect(controls.roomId).toBe('guest-room');
    expect(els.title.textContent).toBe('Invite others');
    expect(els.activeView.hidden).toBe(false);
    expect(els.newLinkButton.hidden).toBe(true);
    expect(els.stopButton.hidden).toBe(true);
    expect(els.linkEl.textContent).toBe('https://host/?foo=bar&room=guest-room');
    els.button.click();
    expect(copyText).not.toHaveBeenCalled();
    controls.copyOrOpen();
    expect(copyText).toHaveBeenCalledWith('https://host/?foo=bar&room=guest-room');
  });

  it('copyOrOpen opens the popover until sharing starts, then copies', () => {
    const { els, controls, copyText, startRoom } = setup();
    controls.copyOrOpen();
    expect(controls.isOpen).toBe(true);
    expect(startRoom).not.toHaveBeenCalled();
    els.startButton.click();
    controls.close();
    copyText.mockClear();
    controls.copyOrOpen();
    expect(controls.isOpen).toBe(false);
    expect(copyText).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and on a click outside', () => {
    const { els, controls } = setup();
    els.button.click();
    els.startButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(controls.isOpen).toBe(false);
    expect(document.activeElement).toBe(els.button);
    // Escape while closed is left for others.
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    els.button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);

    controls.open();
    els.popover.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(controls.isOpen).toBe(true);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(controls.isOpen).toBe(false);
  });

  it('uses navigator.clipboard when copyText is omitted', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { els } = setup({ copyText: undefined });
    els.startButton.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('https://host/?foo=bar&room=room-1');
  });

  it('falls back to the visible link when the clipboard API is missing', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    const { els, onStatus } = setup({ copyText: undefined });
    els.startButton.click();
    expect(els.linkEl.href).toContain('room=room-1');
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('Could not copy')));
  });

  it("never opens or asks for a room when this window can't share (issue #205)", () => {
    const unavailable = vi.fn();
    const { els, controls, startRoom, copyText } = setup({ unavailable, resumeRoomId: 'old-room' });
    els.button.click();
    controls.copyOrOpen();
    expect(unavailable).toHaveBeenCalledTimes(2);
    expect(controls.isOpen).toBe(false);
    expect(startRoom).not.toHaveBeenCalled();
    expect(copyText).not.toHaveBeenCalled();
  });
});
