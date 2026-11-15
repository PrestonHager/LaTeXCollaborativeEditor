import { NO_WEBRTC_MESSAGE, explainNoWebRtc, hasWebRtc, noWebRtcAdvice, noWebRtcTitle, webAppUrl, webRoomLink } from './p2pSupport';

describe('hasWebRtc', () => {
  it('needs an RTCPeerConnection constructor', () => {
    expect(hasWebRtc({ RTCPeerConnection: class {} })).toBe(true);
    expect(hasWebRtc({ RTCPeerConnection: function RTCPeerConnection() {} })).toBe(true);
    expect(hasWebRtc({})).toBe(false);
    expect(hasWebRtc({ RTCPeerConnection: undefined })).toBe(false);
    expect(hasWebRtc({ RTCPeerConnection: {} })).toBe(false);
    expect(hasWebRtc(undefined)).toBe(false);
    // jsdom has no WebRTC, like the Linux desktop app.
    expect(hasWebRtc()).toBe(false);
  });

  it('never throws', () => {
    const hostile = Object.defineProperty({}, 'RTCPeerConnection', {
      get: () => {
        throw new Error('blocked');
      },
    });
    expect(hasWebRtc(hostile)).toBe(false);
  });
});

describe('webAppUrl', () => {
  it('is the site the docs live under', () => {
    expect(webAppUrl('https://latex.prestonhager.com/docs/')).toBe('https://latex.prestonhager.com/');
    expect(webAppUrl('https://owner.github.io/repo/docs/')).toBe('https://owner.github.io/repo/');
  });

  it("is null when the docs base isn't a public site's /docs/", () => {
    expect(webAppUrl('tauri://localhost/docs/')).toBeNull();
    expect(webAppUrl('http://127.0.0.1:8000/')).toBeNull();
    expect(webAppUrl('https://docs.example.com/')).toBeNull();
    expect(webAppUrl('not a url')).toBeNull();
  });

  it('builds a room link on it', () => {
    expect(webRoomLink('https://latex.prestonhager.com/', 'abc-123')).toBe('https://latex.prestonhager.com/?room=abc-123');
  });
});

describe('noWebRtc text', () => {
  it('names the action and what to do instead', () => {
    expect(noWebRtcTitle('share')).toBe("Can't share from this window");
    expect(noWebRtcTitle('join')).toBe("Can't join from this window");
    expect(noWebRtcAdvice('join', false)).toBe('Open the link in a recent version of Chrome, Edge, Firefox or Safari.');
    expect(noWebRtcAdvice('share', false)).toBe('Share from a recent version of Chrome, Edge, Firefox or Safari.');
    expect(noWebRtcAdvice('join', true)).toBe('Open the room in your web browser instead.');
    expect(noWebRtcAdvice('share', true)).toMatch(/^Share from the web app in your browser instead\./);
    expect(noWebRtcAdvice('join', true, false)).toBe('Open the web app in a recent version of Chrome, Edge, Firefox or Safari to join the room.');
    expect(noWebRtcAdvice('share', true, false)).toBe('Open the web app in a recent version of Chrome, Edge, Firefox or Safari to share.');
  });
});

describe('explainNoWebRtc', () => {
  const setup = (overrides: { desktop?: boolean; link?: string | null; confirmed?: boolean; opened?: boolean; copyFails?: boolean } = {}) => {
    const deps = {
      confirm: vi.fn(async () => overrides.confirmed ?? true),
      notice: vi.fn(async () => undefined),
      openExternal: vi.fn(async () => overrides.opened ?? true),
      copyText: vi.fn(async () => {
        if (overrides.copyFails) throw new Error('denied');
      }),
      notify: vi.fn(),
    };
    const run = (action: 'share' | 'join') =>
      explainNoWebRtc({ action, desktop: overrides.desktop ?? false, link: overrides.link === undefined ? 'https://site/?room=r' : overrides.link, ...deps });
    return { deps, run };
  };

  it('in a browser, shows the message and suggests a supported browser', async () => {
    const { deps, run } = setup();
    await run('join');
    expect(deps.notice).toHaveBeenCalledWith({
      title: "Can't join from this window",
      message: `${NO_WEBRTC_MESSAGE} Open the link in a recent version of Chrome, Edge, Firefox or Safari.`,
      closeLabel: 'Close',
    });
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.openExternal).not.toHaveBeenCalled();
  });

  it('in the desktop app, offers to open the room in the browser', async () => {
    const { deps, run } = setup({ desktop: true });
    await run('join');
    expect(deps.confirm).toHaveBeenCalledWith({
      title: "Can't join from this window",
      message: `${NO_WEBRTC_MESSAGE} Open the room in your web browser instead.`,
      confirmLabel: 'Open in browser',
      cancelLabel: 'Not now',
    });
    expect(deps.openExternal).toHaveBeenCalledWith('https://site/?room=r');
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('opens nothing when the person says not now', async () => {
    const { deps, run } = setup({ desktop: true, confirmed: false });
    await run('share');
    expect(deps.openExternal).not.toHaveBeenCalled();
    expect(deps.copyText).not.toHaveBeenCalled();
  });

  it('copies the link when the browser could not be opened', async () => {
    const { deps, run } = setup({ desktop: true, opened: false });
    await run('join');
    expect(deps.copyText).toHaveBeenCalledWith('https://site/?room=r');
    expect(deps.notify).toHaveBeenCalledWith("Couldn't open your browser. The link is copied: paste it into your browser.");
  });

  it('shows the link when copying fails too', async () => {
    const { deps, run } = setup({ desktop: true, opened: false, copyFails: true });
    await run('join');
    expect(deps.notify).toHaveBeenCalledWith("Couldn't open your browser. Open this link in it: https://site/?room=r");
  });

  it('in the desktop app with no web app address, only explains', async () => {
    const { deps, run } = setup({ desktop: true, link: null });
    await run('share');
    expect(deps.notice).toHaveBeenCalledWith(expect.objectContaining({ title: "Can't share from this window", message: expect.stringContaining('Open the web app in') }));
    expect(deps.confirm).not.toHaveBeenCalled();
  });
});
