import { applyDesktopWording, desktopWording, externalTarget, routeExternalLinks, setUpDesktopUi } from './desktopUi';

const HERE = 'tauri://localhost/index.html';
const WEB_APP = 'https://latex.example.com/';

describe('desktopWording', () => {
  it('says "this app" where the web says "this browser"', () => {
    expect(desktopWording('Open a project saved in this browser.')).toBe('Open a project saved in this app.');
    expect(desktopWording('This browser is blocking storage, so settings only last until you close this tab. Export them to keep a copy.')).toBe(
      "This app can't save settings right now, so they only last until you close it. Export them to keep a copy.",
    );
    expect(desktopWording('Profile (this browser only)')).toBe('Profile (this app only)');
    expect(desktopWording('Sign out of Google Drive in this tab. Edits save in this browser after that.')).toBe(
      'Sign out of Google Drive in this app. Edits save in this app after that.',
    );
    expect(desktopWording('Browser storage')).toBe('App storage');
  });

  it('rewrites whole sentences that only make sense in a browser', () => {
    expect(
      desktopWording("Shortcuts are saved in this browser profile only, so changing one here doesn't change it in your other browsers."),
    ).toBe("Shortcuts are saved in this app only, so changing one here doesn't change it in a browser.");
    expect(desktopWording('Themes are saved in this browser and shared with its other tabs. Never sent.')).toBe('Themes are saved in this app. Never sent.');
    expect(desktopWording('The file is made in this browser; only Google Drive sends it anywhere.')).toBe(
      'The file is made on this computer; only Google Drive sends it anywhere.',
    );
    expect(desktopWording('A collaborative LaTeX editor that runs in your browser.')).toBe('A collaborative LaTeX editor that runs on your computer.');
  });

  it('leaves other text alone', () => {
    expect(desktopWording('Edits and files go straight between browsers.')).toBe('Edits and files go straight between browsers.');
    expect(desktopWording('Nothing here')).toBe('Nothing here');
  });
});

describe('applyDesktopWording', () => {
  it('rewrites text and readable attributes, but not what people typed or the editor', () => {
    document.body.innerHTML = `
      <p id="hint">Saved in this browser.</p>
      <button id="item" data-description="Delete every project saved in this browser." aria-label="Clear this browser">x</button>
      <input id="field" placeholder="Search this browser" value="this browser" />
      <div class="cm-editor"><span id="code">this browser</span></div>
      <div contenteditable="true" id="typed">this browser</div>`;
    expect(applyDesktopWording(document.body)).toBe(4);
    expect(document.getElementById('hint')!.textContent).toBe('Saved in this app.');
    expect(document.getElementById('item')!.dataset.description).toBe('Delete every project saved in this app.');
    expect(document.getElementById('item')!.getAttribute('aria-label')).toBe('Clear this app');
    expect((document.getElementById('field') as HTMLInputElement).placeholder).toBe('Search this app');
    expect((document.getElementById('field') as HTMLInputElement).value).toBe('this browser');
    expect(document.getElementById('code')!.textContent).toBe('this browser');
    expect(document.getElementById('typed')!.textContent).toBe('this browser');
    expect(applyDesktopWording(document.body)).toBe(0);
  });

  it('defaults to the whole document', () => {
    document.body.innerHTML = '<p>this browser</p>';
    expect(applyDesktopWording()).toBe(1);
  });
});

describe('externalTarget', () => {
  it('sends https links to other sites to the browser', () => {
    expect(externalTarget('https://github.com/x', '_blank', HERE, WEB_APP)).toBe('https://github.com/x');
    expect(externalTarget('https://github.com/x', '', HERE, null)).toBe('https://github.com/x');
  });

  it('opens nothing but https outside the app', () => {
    expect(externalTarget('http://example.com/', '_blank', HERE, WEB_APP)).toBeNull();
    expect(externalTarget('mailto:a@example.com', '_blank', HERE, WEB_APP)).toBeNull();
    expect(externalTarget('javascript:alert(1)', '_blank', HERE, WEB_APP)).toBeNull();
    expect(externalTarget('http://[bad', '_blank', HERE, WEB_APP)).toBeNull();
  });

  it("opens the app's own pages that want a new window on the website", () => {
    expect(externalTarget('./privacy.html', '_blank', HERE, WEB_APP)).toBe('https://latex.example.com/privacy.html');
    expect(externalTarget('./tos.html#terms', '_blank', HERE, WEB_APP)).toBe('https://latex.example.com/tos.html#terms');
    expect(externalTarget('./privacy.html', '_blank', HERE, null)).toBeNull();
    expect(externalTarget('#section', '', HERE, WEB_APP)).toBeNull();
    expect(externalTarget('./privacy.html', '', HERE, WEB_APP)).toBeNull();
    expect(externalTarget('./', '_blank', HERE, WEB_APP)).toBeNull();
  });
});

describe('routeExternalLinks', () => {
  const click = (el: Element, init: MouseEventInit = {}) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(event);
    return event;
  };

  it('opens external links in the browser instead of the window', async () => {
    document.body.innerHTML = '<a id="out" href="https://github.com/x" target="_blank"><span id="inner">GitHub</span></a><a id="in" href="#top">Top</a>';
    const open = vi.fn(async () => true);
    const onFail = vi.fn();
    const stop = routeExternalLinks(document, { webApp: WEB_APP, open, onFail });
    expect(click(document.getElementById('inner')!).defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith('https://github.com/x');
    expect(click(document.getElementById('in')!).defaultPrevented).toBe(false);
    expect(click(document.body).defaultPrevented).toBe(false);
    await Promise.resolve();
    expect(onFail).not.toHaveBeenCalled();
    stop();
    // jsdom can't navigate, so stop the click once it has passed through.
    document.addEventListener('click', (event) => event.preventDefault(), { once: true });
    click(document.getElementById('out')!);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('says so when the browser could not be opened', async () => {
    document.body.innerHTML = '<a id="out" href="https://github.com/x">GitHub</a>';
    const onFail = vi.fn();
    const stop = routeExternalLinks(document, { webApp: null, open: async () => false, onFail });
    click(document.getElementById('out')!);
    await vi.waitFor(() => expect(onFail).toHaveBeenCalledWith('https://github.com/x'));
    stop();
  });

  it('leaves clicks someone else handled, and right clicks', () => {
    document.body.innerHTML = '<a id="out" href="https://github.com/x">GitHub</a>';
    const open = vi.fn(async () => true);
    const stop = routeExternalLinks(document, { webApp: null, open });
    const handled = new MouseEvent('click', { bubbles: true, cancelable: true });
    handled.preventDefault();
    document.getElementById('out')!.dispatchEvent(handled);
    document.addEventListener('click', (event) => event.preventDefault(), { once: true });
    click(document.getElementById('out')!, { button: 2 });
    expect(open).not.toHaveBeenCalled();
    stop();
  });

  it('uses the opener plugin by default', () => {
    document.body.innerHTML = '<a id="out" href="https://github.com/x">GitHub</a>';
    const stop = routeExternalLinks(document, { webApp: null });
    // jsdom isn't the desktop app, so the opener resolves false and nothing throws.
    expect(click(document.getElementById('out')!).defaultPrevented).toBe(true);
    stop();
  });
});

describe('setUpDesktopUi', () => {
  it('rewrites the wording and routes links', () => {
    document.body.innerHTML = '<p id="p">Saved in this browser.</p>';
    setUpDesktopUi(document, { webApp: null, open: async () => true });
    expect(document.getElementById('p')!.textContent).toBe('Saved in this app.');
  });
});
