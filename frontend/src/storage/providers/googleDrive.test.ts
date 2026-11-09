import { GoogleDriveProvider } from './googleDrive';
import { StorageError } from '../errors';
import { AutosaveController } from '../autosave';
import type { StorageProvider } from './types';

const loadScript = vi.fn(async () => undefined);
vi.mock('./scriptLoader', () => ({ loadScript: (...args: unknown[]) => loadScript(...(args as [])) }));

type TokenClientConfig = {
  callback: (resp: { access_token?: string; error?: string; expires_in?: number }) => void;
  error_callback: (err: { type?: string; message?: string }) => void;
};

/** Fake GIS so requestAccessToken calls back with whatever the test wants. */
function stubGis(respond: (config: TokenClientConfig) => void) {
  const requestAccessToken = vi.fn();
  const initTokenClient = vi.fn((config: TokenClientConfig) => {
    requestAccessToken.mockImplementation(() => respond(config));
    return { requestAccessToken };
  });
  window.google = { accounts: { oauth2: { initTokenClient } } };
  return { initTokenClient, requestAccessToken };
}

/** Make a provider that already has a live token. */
function connectedProvider() {
  const provider = new GoogleDriveProvider();
  (provider as any).accessToken = 'token';
  (provider as any).tokenExpiresAt = Date.now() + 60 * 60 * 1000;
  return provider;
}

describe('GoogleDriveProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    loadScript.mockReset();
    loadScript.mockResolvedValue(undefined);
    window.google = undefined;
  });

  it('connects and exposes access token', async () => {
    const gis = stubGis((config) => config.callback({ access_token: 'token-123', expires_in: 3600 }));
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id');

    const provider = new GoogleDriveProvider();
    const ok = await provider.connect();

    expect(ok).toBe(true);
    expect(provider.getAccessToken()).toBe('token-123');
    expect(provider.hasUsableToken()).toBe(true);
    expect(provider.status()).toBe('Drive: Connected');
    expect(localStorage.getItem('drive_access_token')).toContain('token-123');
    // Only one popup, a second one would be blocked by the browser.
    expect(gis.requestAccessToken).toHaveBeenCalledTimes(1);
  });

  it('reports a blocked popup instead of hanging', async () => {
    stubGis((config) => config.error_callback({ type: 'popup_failed_to_open' }));
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id');

    const provider = new GoogleDriveProvider();
    const ok = await provider.connect();

    expect(ok).toBe(false);
    expect(provider.status()).toContain('popup was blocked');
  });

  it('reports a closed popup as canceled', async () => {
    stubGis((config) => config.error_callback({ type: 'popup_closed' }));
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id');
    const provider = new GoogleDriveProvider();
    expect(await provider.connect()).toBe(false);
    expect(provider.status()).toBe('Drive: Sign-in was canceled.');
  });

  it('reports a denied token response', async () => {
    stubGis((config) => config.callback({ error: 'access_denied' }));
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id');
    const provider = new GoogleDriveProvider();
    expect(await provider.connect()).toBe(false);
    expect(provider.status()).toContain('Access was denied');
  });

  it('reuses cached access token without prompting oauth again', async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    localStorage.setItem('drive_access_token', JSON.stringify({ accessToken: 'cached-token', expiresAt }));
    const gis = stubGis(() => undefined);

    const provider = new GoogleDriveProvider();
    const ok = await provider.connect();

    expect(ok).toBe(true);
    expect(provider.getAccessToken()).toBe('cached-token');
    expect(gis.initTokenClient).not.toHaveBeenCalled();
  });

  it('treats a token that expired mid-session as unusable', () => {
    const provider = connectedProvider();
    expect(provider.hasUsableToken()).toBe(true);
    (provider as any).tokenExpiresAt = Date.now() + 30_000;
    expect(provider.hasUsableToken()).toBe(false);
  });

  describe('when the token expires mid-session', () => {
    /** Make a provider whose token just expired, with a file already linked. */
    function expiredProvider() {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id');
      const provider = connectedProvider();
      (provider as any).fileRef = { id: 'fid', name: 'x.tex' };
      (provider as any).tokenExpiresAt = Date.now() - 1000;
      return provider;
    }

    const authHeader = (call: unknown[]) => (call[1] as RequestInit & { headers: Record<string, string> }).headers.Authorization;

    it('silently gets a new token and keeps saving to Drive', async () => {
      const provider = expiredProvider();
      const gis = stubGis((config) => config.callback({ access_token: 'fresh-token', expires_in: 3600 }));
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);
      const lost = vi.fn();
      provider.onSessionLost(lost);

      await provider.save('next', 'x.tex');

      expect(gis.requestAccessToken).toHaveBeenCalledWith({ prompt: '' });
      expect(authHeader(fetchMock.mock.calls[0])).toBe('Bearer fresh-token');
      expect(provider.hasUsableToken()).toBe(true);
      expect(lost).not.toHaveBeenCalled();
    });

    it('shares one refresh between saves that run at the same time', async () => {
      const provider = expiredProvider();
      const gis = stubGis((config) => config.callback({ access_token: 'fresh-token', expires_in: 3600 }));
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

      await Promise.all([provider.save('a', 'x.tex'), provider.save('b', 'x.tex')]);

      expect(gis.requestAccessToken).toHaveBeenCalledTimes(1);
    });

    it('retries once with a new token when Drive returns 401', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id');
      const provider = connectedProvider();
      (provider as any).fileRef = { id: 'fid', name: 'x.tex' };
      stubGis((config) => config.callback({ access_token: 'fresh-token', expires_in: 3600 }));
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      await provider.save('next', 'x.tex');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(authHeader(fetchMock.mock.calls[1])).toBe('Bearer fresh-token');
    });

    it('gives up after a second 401 and ends the session', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id');
      const provider = connectedProvider();
      (provider as any).fileRef = { id: 'fid', name: 'x.tex' };
      stubGis((config) => config.callback({ access_token: 'fresh-token', expires_in: 3600 }));
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
      const lost = vi.fn();
      provider.onSessionLost(lost);

      await expect(provider.save('next', 'x.tex')).rejects.toMatchObject({ retryable: false, status: 401 });
      expect(lost).toHaveBeenCalledTimes(1);
      expect(provider.isSignedIn()).toBe(false);
    });

    it('ends the session and reports it when the silent refresh fails', async () => {
      const provider = expiredProvider();
      stubGis((config) => config.error_callback({ type: 'popup_failed_to_open' }));
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const lost = vi.fn();
      provider.onSessionLost(lost);

      await expect(provider.save('next', 'x.tex')).rejects.toMatchObject({
        message: expect.stringMatching(/Session expired/),
        retryable: false,
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(lost).toHaveBeenCalledTimes(1);
      expect(provider.isSignedIn()).toBe(false);
      expect(provider.status()).toBe('Drive: Session expired');
      expect(localStorage.getItem('drive_access_token')).toBeNull();
      // After that we're signed out, so later saves fail fast without asking GIS again.
      await expect(provider.save('next', 'x.tex')).rejects.toThrow(/Not connected/);
      expect(lost).toHaveBeenCalledTimes(1);
    });

    it('gives up on a refresh that never answers', async () => {
      vi.useFakeTimers();
      try {
        const provider = expiredProvider();
        stubGis(() => undefined);
        vi.stubGlobal('fetch', vi.fn());
        const lost = vi.fn();
        provider.onSessionLost(lost);

        const failure = expect(provider.save('next', 'x.tex')).rejects.toThrow(/Session expired/);
        await vi.advanceTimersByTimeAsync(20_000);
        await failure;
        expect(lost).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('ends the session when the sign-in script fails to load', async () => {
      const provider = expiredProvider();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      loadScript.mockRejectedValueOnce(new Error('blocked'));
      vi.stubGlobal('fetch', vi.fn());
      await expect(provider.save('next', 'x.tex')).rejects.toThrow(/Session expired/);
      expect(provider.isSignedIn()).toBe(false);
    });

    it('lets autosave fall back to local storage so the edit is kept', async () => {
      const provider = expiredProvider();
      stubGis((config) => config.error_callback({ type: 'popup_failed_to_open' }));
      vi.stubGlobal('fetch', vi.fn());
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const local = { label: 'Local', save: vi.fn(async () => undefined), status: () => 'ok', connect: async () => true };
      let active: StorageProvider = provider;
      const autosave = new AutosaveController({
        provider: () => active,
        getContent: () => 'latest edit',
        getFileName: () => 'x.tex',
        onStatus: () => undefined,
      });
      // Do what main.ts does: switch to local and save again.
      provider.onSessionLost(() => {
        active = local as unknown as StorageProvider;
        void autosave.saveNow();
      });

      expect(await autosave.saveNow()).toBe(false);
      expect(await autosave.saveNow()).toBe(true);
      expect(local.save).toHaveBeenCalledWith('latest edit', 'x.tex');
    });
  });

  it('opens document and persists selected file', async () => {
    const provider = connectedProvider();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'f1', name: 'doc.tex' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => 'content',
        }),
    );

    const opened = await provider.openDocument('f1');

    expect(opened).toEqual({ name: 'doc.tex', content: 'content' });
    expect(provider.getCurrentFileRef()).toEqual({ id: 'f1', name: 'doc.tex' });
    expect(localStorage.getItem('drive_active_file_ref')).toContain('doc.tex');
  });

  it('explains a 404 on open as a missing or inaccessible file', async () => {
    const provider = connectedProvider();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) }));
    await expect(provider.openDocument('f1')).rejects.toThrow(/not found or this app does not have access/);
  });

  it('clears the token and asks to reconnect on 401', async () => {
    const provider = connectedProvider();
    localStorage.setItem('drive_access_token', JSON.stringify({ accessToken: 'token', expiresAt: Date.now() + 3600_000 }));
    (provider as any).fileRef = { id: 'fid', name: 'x.tex' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid Credentials' } }) }),
    );

    const failure = provider.save('next', 'x.tex');
    await expect(failure).rejects.toBeInstanceOf(StorageError);
    await expect(failure).rejects.toMatchObject({ retryable: false, status: 401 });
    expect(provider.hasUsableToken()).toBe(false);
    expect(localStorage.getItem('drive_access_token')).toBeNull();
  });

  it('includes the Google error message for server errors', async () => {
    const provider = connectedProvider();
    (provider as any).fileRef = { id: 'fid', name: 'x.tex' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: { message: 'Backend Error' } }) }),
    );
    await expect(provider.save('next', 'x.tex')).rejects.toMatchObject({
      message: 'Drive: Could not save file (HTTP 500: Backend Error).',
      retryable: true,
    });
  });

  it('turns network failures into a readable error', async () => {
    const provider = connectedProvider();
    (provider as any).fileRef = { id: 'fid', name: 'x.tex' };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')));
    await expect(provider.save('next', 'x.tex')).rejects.toThrow(/Check your connection/);
  });

  it('refuses to save without a token', async () => {
    const provider = new GoogleDriveProvider();
    await expect(provider.save('x', 'x.tex')).rejects.toThrow(/Not connected/);
  });

  it('renames and moves current file', async () => {
    const provider = connectedProvider();
    (provider as any).fileRef = { id: 'f1', name: 'old.tex' };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ parents: ['p1'] }) })
        .mockResolvedValueOnce({ ok: true }),
    );

    await provider.renameFile('f1', 'new.tex');
    await provider.moveFile('f1', 'folder2');

    expect(provider.getCurrentFileRef()).toEqual({ id: 'f1', name: 'new.tex' });
  });

  it('saveAs renames the linked file instead of creating a duplicate', async () => {
    const provider = connectedProvider();
    (provider as any).fileRef = { id: 'f1', name: 'old.tex' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await provider.saveAs('body', 'old.tex', 'new.tex');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/files/f1');
    expect(fetchMock.mock.calls[1][0]).toContain('/files/f1?uploadType=media');
    expect(provider.getCurrentFileRef()).toEqual({ id: 'f1', name: 'new.tex' });
  });

  it('saveAs creates a file when nothing is linked yet', async () => {
    const provider = connectedProvider();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'n1' }) }));
    await provider.saveAs('body', 'old.tex', 'new.tex');
    expect(provider.getCurrentFileRef()).toEqual({ id: 'n1', name: 'new.tex' });
  });

  it('detachFile forgets the linked file', () => {
    localStorage.setItem('drive_active_file_ref', JSON.stringify({ id: 'f1', name: 'a.tex' }));
    const provider = new GoogleDriveProvider();
    expect(provider.getCurrentFileRef()).toEqual({ id: 'f1', name: 'a.tex' });
    provider.detachFile();
    expect(provider.getCurrentFileRef()).toBeNull();
    expect(localStorage.getItem('drive_active_file_ref')).toBeNull();
  });

  it('connect returns false when client id is missing', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    const provider = new GoogleDriveProvider();
    const ok = await provider.connect();
    expect(ok).toBe(false);
    expect(provider.status()).toBe('Drive config missing');
  });

  it('connect catches script/bootstrap failures', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'id');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    loadScript.mockRejectedValueOnce(new Error('blocked'));
    const provider = new GoogleDriveProvider();
    const ok = await provider.connect();
    expect(ok).toBe(false);
    expect(provider.status()).toBe('Drive: Connection failed');
  });

  it('save creates a new Drive file when none is open', async () => {
    const provider = connectedProvider();
    (provider as any).fileRef = null;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'new-id' }),
      }),
    );
    await provider.save('tex', 'fresh.tex');
    expect(provider.getCurrentFileRef()).toEqual({ id: 'new-id', name: 'fresh.tex' });
  });

  it('a slow first save does not replace a file opened while it ran', async () => {
    const provider = connectedProvider();
    let finishCreate: (value: unknown) => void = () => undefined;
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(new Promise((resolve) => { finishCreate = resolve; }))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'b', name: 'b.tex' }) })
      .mockResolvedValueOnce({ ok: true, text: async () => 'b content' })
      .mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    // First, start the first save of an unsaved doc and leave createFile hanging.
    const firstSave = provider.save('a content', 'a.tex');
    // Now open file B while that save is still in flight.
    await provider.openDocument('b');
    // Then let the create finish, which used to link the new file A.
    finishCreate({ ok: true, json: async () => ({ id: 'a' }) });
    await firstSave;

    expect(provider.getCurrentFileRef()).toEqual({ id: 'b', name: 'b.tex' });
    expect(localStorage.getItem('drive_active_file_ref')).toContain('"b"');

    // Finally, the next autosave has to write into B, not A.
    await provider.save('b edits', 'b.tex');
    expect(fetchMock.mock.calls[3][0]).toContain('/files/b?uploadType=media');
  });

  it('a slow first save does not relink after detachFile', async () => {
    const provider = connectedProvider();
    let finishCreate: (value: unknown) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(new Promise((resolve) => { finishCreate = resolve; })));

    const firstSave = provider.save('a content', 'a.tex');
    provider.detachFile();
    finishCreate({ ok: true, json: async () => ({ id: 'a' }) });
    await firstSave;

    expect(provider.getCurrentFileRef()).toBeNull();
  });

  it('saveAs does not write into a file opened during the rename', async () => {
    const provider = connectedProvider();
    (provider as any).fileRef = { id: 'a', name: 'a.tex' };
    let finishRename: (value: unknown) => void = () => undefined;
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(new Promise((resolve) => { finishRename = resolve; }))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'b', name: 'b.tex' }) })
      .mockResolvedValueOnce({ ok: true, text: async () => 'b content' });
    vi.stubGlobal('fetch', fetchMock);

    const rename = provider.saveAs('a content', 'a.tex', 'renamed.tex');
    await provider.openDocument('b');
    finishRename({ ok: true });
    await rename;

    // The rename went to A and nothing got written into B.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(provider.getCurrentFileRef()).toEqual({ id: 'b', name: 'b.tex' });
  });

  it('save updates existing file in place', async () => {
    const provider = connectedProvider();
    (provider as any).fileRef = { id: 'fid', name: 'x.tex' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true }));
    await provider.save('next', 'x.tex');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/files/fid?uploadType=media'),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('ignores corrupt stored file ref JSON', () => {
    localStorage.setItem('drive_active_file_ref', '{not-json');
    const provider = new GoogleDriveProvider();
    expect(provider.getCurrentFileRef()).toBeNull();
  });

  it('ignores corrupt stored token JSON', () => {
    localStorage.setItem('drive_access_token', '{bad');
    const provider = new GoogleDriveProvider();
    expect((provider as any).accessToken).toBe('');
  });

  it('drops expired cached token on construction', () => {
    localStorage.setItem(
      'drive_access_token',
      JSON.stringify({ accessToken: 'expired', expiresAt: Date.now() - 120_000 }),
    );
    const provider = new GoogleDriveProvider();
    expect((provider as any).accessToken).toBe('');
    expect(localStorage.getItem('drive_access_token')).toBeNull();
  });

  it('moveFile sends removeParents when Drive returns parents', async () => {
    const provider = connectedProvider();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ parents: ['oldp'] }),
        })
        .mockResolvedValueOnce({ ok: true }),
    );
    await provider.moveFile('f1', 'folder2');
    const patchUrl = (fetch as any).mock.calls[1][0] as string;
    expect(patchUrl).toContain('removeParents=oldp');
    expect(patchUrl).toContain('addParents=folder2');
  });
});
