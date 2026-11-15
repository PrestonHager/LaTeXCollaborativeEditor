import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { GoogleDriveProvider } from './googleDrive';
import { ACCOUNTS_STORAGE_KEY, rememberAccount, rememberedAccount, setKeepSignedInChoice } from './accountMemory';
import { loadToken, resetVaultForTests, saveToken } from './tokenVault';

// Remembering sign-ins between visits (#201): the default (account only) and "Keep me signed in".

const loadScript = vi.fn(async () => undefined);
vi.mock('./scriptLoader', () => ({ loadScript: (...args: unknown[]) => loadScript(...(args as [])) }));

type TokenClientConfig = {
  login_hint?: string;
  callback: (resp: { access_token?: string; error?: string; expires_in?: number }) => void;
  error_callback: (err: { type?: string; message?: string }) => void;
};

function stubGis(respond: (config: TokenClientConfig, prompt: string) => void) {
  const revoke = vi.fn((_token: string, done: () => void) => done());
  const requestAccessToken = vi.fn();
  const initTokenClient = vi.fn((config: TokenClientConfig) => {
    requestAccessToken.mockImplementation(({ prompt }: { prompt: string }) => respond(config, prompt));
    return { requestAccessToken };
  });
  window.google = { accounts: { oauth2: { initTokenClient, revoke } } };
  return { initTokenClient, requestAccessToken, revoke };
}

const HOUR = 3600_000;
const SESSION_KEY = 'drive_session_token';

describe('GoogleDriveProvider sign-ins between visits', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetVaultForTests();
    globalThis.indexedDB = new IDBFactory();
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id');
    loadScript.mockReset();
    loadScript.mockResolvedValue(undefined);
    window.google = undefined;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  describe('by default', () => {
    it('remembers that Drive connected and as whom, but keeps no token outside this tab', async () => {
      stubGis((config) => config.callback({ access_token: 'tok-1', expires_in: 3600 }));
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ user: { emailAddress: 'ada@example.com' } })));
      const provider = new GoogleDriveProvider();
      expect(await provider.connect()).toBe(true);
      await provider.loadAccount();
      expect(rememberedAccount('googleDrive')).toEqual({ connected: true, account: 'ada@example.com', keepSignedIn: false });
      expect(localStorage.getItem(ACCOUNTS_STORAGE_KEY)).not.toContain('tok-1');
      await expect(loadToken('googleDrive', 0)).resolves.toBeNull();
      expect(provider.keepSignedIn()).toBe(false);
    });

    it('signs back in silently on a new visit, with the remembered account as a hint', async () => {
      rememberAccount('googleDrive', 'ada@example.com');
      const gis = stubGis((config, prompt) => {
        expect(prompt).toBe('none');
        expect(config.login_hint).toBe('ada@example.com');
        config.callback({ access_token: 'silent', expires_in: 3600 });
      });
      const provider = new GoogleDriveProvider();
      expect(provider.isSignedIn()).toBe(false);
      await expect(provider.restoreSession()).resolves.toBe(true);
      expect(provider.hasUsableToken()).toBe(true);
      expect(provider.status()).toBe('Drive: Session restored');
      expect(gis.requestAccessToken).toHaveBeenCalledTimes(1);
      // Already signed in, so a second call asks nothing.
      await expect(provider.restoreSession()).resolves.toBe(true);
      expect(gis.requestAccessToken).toHaveBeenCalledTimes(1);
    });

    it('says the sign-in expired when the silent sign-in needs the person', async () => {
      rememberAccount('googleDrive', 'ada@example.com');
      stubGis((config) => config.callback({ error: 'interaction_required' }));
      const provider = new GoogleDriveProvider();
      await expect(provider.restoreSession()).resolves.toBe(false);
      expect(provider.status()).toBe('Drive: Sign-in expired');
      // Still remembered, so the Accounts panel can say "Expired" and offer Connect.
      expect(rememberedAccount('googleDrive')?.connected).toBe(true);
    });

    it('describes a silent sign-in Google refused as expired on connect too', async () => {
      stubGis((config) => config.callback({ error: 'login_required' }));
      const provider = new GoogleDriveProvider();
      await expect(provider.connect()).resolves.toBe(false);
      expect(provider.status()).toBe('Drive: Sign-in expired. Connect Google Drive to sign in again.');
    });

    it('gives up on a silent sign-in that never answers', async () => {
      vi.useFakeTimers();
      rememberAccount('googleDrive', null);
      stubGis(() => undefined);
      const provider = new GoogleDriveProvider();
      const restoring = provider.restoreSession();
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(restoring).resolves.toBe(false);
    });

    it('copes with the sign-in script failing, or no client id', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      rememberAccount('googleDrive', null);
      loadScript.mockRejectedValueOnce(new Error('offline'));
      await expect(new GoogleDriveProvider().restoreSession()).resolves.toBe(false);
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
      await expect(new GoogleDriveProvider().restoreSession()).resolves.toBe(false);
      expect(loadScript).toHaveBeenCalledTimes(1);
    });

    it('asks nothing when Drive was never connected here', async () => {
      const gis = stubGis(() => undefined);
      await expect(new GoogleDriveProvider().restoreSession()).resolves.toBe(false);
      expect(gis.initTokenClient).not.toHaveBeenCalled();
      expect(loadScript).not.toHaveBeenCalled();
    });
  });

  describe('with "Keep me signed in on this browser"', () => {
    it('keeps the token in IndexedDB and uses it on the next visit without asking Google', async () => {
      setKeepSignedInChoice('googleDrive', true);
      stubGis((config) => config.callback({ access_token: 'kept-tok', expires_in: 3600 }));
      const first = new GoogleDriveProvider();
      await first.connect();
      await vi.waitFor(async () => expect((await loadToken('googleDrive', 0))?.accessToken).toBe('kept-tok'));

      // A new tab: no sessionStorage, the token comes from IndexedDB.
      sessionStorage.clear();
      const gis = stubGis(() => undefined);
      const second = new GoogleDriveProvider();
      expect(second.isSignedIn()).toBe(false);
      await expect(second.restoreSession()).resolves.toBe(true);
      expect(second.getAccessToken()).toBe('kept-tok');
      expect(gis.initTokenClient).not.toHaveBeenCalled();
      // It's this tab's token now as well.
      expect(sessionStorage.getItem(SESSION_KEY)).toContain('kept-tok');
    });

    it('keeps the account looked up later with the token', async () => {
      setKeepSignedInChoice('googleDrive', true);
      stubGis((config) => config.callback({ access_token: 'kept-tok', expires_in: 3600 }));
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ user: { emailAddress: 'ada@example.com' } })));
      const provider = new GoogleDriveProvider();
      await provider.connect();
      await provider.loadAccount();
      expect((await loadToken('googleDrive', 0))?.account).toBe('ada@example.com');
    });

    it('drops an expired kept token and falls back to a silent sign-in', async () => {
      rememberAccount('googleDrive', 'ada@example.com');
      setKeepSignedInChoice('googleDrive', true);
      await saveToken('googleDrive', { accessToken: 'stale', expiresAt: Date.now() + 1_000 });
      stubGis((config) => config.callback({ access_token: 'fresh', expires_in: 3600 }));
      const provider = new GoogleDriveProvider();
      await expect(provider.restoreSession()).resolves.toBe(true);
      expect(provider.getAccessToken()).toBe('fresh');
      await vi.waitFor(async () => expect((await loadToken('googleDrive', 0))?.accessToken).toBe('fresh'));
    });

    it('turning it on keeps the current token; turning it off deletes it', async () => {
      stubGis((config) => config.callback({ access_token: 'tok', expires_in: 3600 }));
      const provider = new GoogleDriveProvider();
      // Off while signed out: nothing to keep.
      await provider.setKeepSignedIn(true);
      await expect(loadToken('googleDrive', 0)).resolves.toBeNull();
      await provider.setKeepSignedIn(false);
      await provider.connect();
      await expect(loadToken('googleDrive', 0)).resolves.toBeNull();
      await provider.setKeepSignedIn(true);
      expect(provider.keepSignedIn()).toBe(true);
      expect((await loadToken('googleDrive', 0))?.accessToken).toBe('tok');
      await provider.setKeepSignedIn(false);
      await expect(loadToken('googleDrive', 0)).resolves.toBeNull();
      expect(provider.keepSignedIn()).toBe(false);
    });

    it('deletes the kept token when the session expires for good, but remembers the account', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      setKeepSignedInChoice('googleDrive', true);
      rememberAccount('googleDrive', 'ada@example.com');
      await saveToken('googleDrive', { accessToken: 'tok', expiresAt: Date.now() + HOUR });
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken: 'tok', expiresAt: Date.now() + HOUR }));
      stubGis((config) => config.callback({ error: 'interaction_required' }));
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
      const provider = new GoogleDriveProvider();
      const lost = vi.fn();
      provider.onSessionLost(lost);
      await expect(provider.listProjects()).rejects.toThrow(/Session expired/);
      expect(lost).toHaveBeenCalled();
      await vi.waitFor(async () => expect(await loadToken('googleDrive', 0)).toBeNull());
      expect(rememberedAccount('googleDrive')?.connected).toBe(true);
    });
  });

  it('log out clears everything kept for Drive and revokes the token', async () => {
    setKeepSignedInChoice('googleDrive', true);
    const gis = stubGis((config) => config.callback({ access_token: 'tok', expires_in: 3600 }));
    const provider = new GoogleDriveProvider();
    await provider.connect();
    await vi.waitFor(async () => expect(await loadToken('googleDrive', 0)).not.toBeNull());
    await provider.disconnect();
    expect(gis.revoke).toHaveBeenCalledWith('tok', expect.any(Function));
    expect(localStorage.getItem(ACCOUNTS_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    await expect(loadToken('googleDrive', 0)).resolves.toBeNull();
    // The next visit asks nothing, since nothing remembers Drive.
    await expect(new GoogleDriveProvider().restoreSession()).resolves.toBe(false);
  });

  it('a log out during the restore wins', async () => {
    rememberAccount('googleDrive', null);
    setKeepSignedInChoice('googleDrive', true);
    await saveToken('googleDrive', { accessToken: 'tok', expiresAt: Date.now() + HOUR });
    const provider = new GoogleDriveProvider();
    const restoring = provider.restoreSession();
    await provider.disconnect();
    await expect(restoring).resolves.toBe(false);
    expect(provider.isSignedIn()).toBe(false);
  });
});
