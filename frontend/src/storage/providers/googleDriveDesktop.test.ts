import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { GoogleDriveProvider } from './googleDrive';
import { rememberAccount, rememberedAccount, wasConnected } from './accountMemory';
import { resetVaultForTests } from './tokenVault';
import { describeDesktopAuthError, DesktopAuthError, desktopAccessToken, desktopSignIn, desktopSignOut } from './desktopGoogleAuth';

// Google sign-in in the desktop app (#177): the shell does it through the system browser and keeps
// the refresh token in the OS keychain. The page only sees short-lived access tokens over IPC.

const loadScript = vi.fn(async () => undefined);
vi.mock('./scriptLoader', () => ({ loadScript: (...args: unknown[]) => loadScript(...(args as [])) }));

type Handler = (args?: Record<string, unknown>) => unknown;

/** A fake Tauri shell. Each command answers with a handler, or rejects with the shell's error code. */
function stubShell(handlers: Record<string, Handler>) {
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    const handler = handlers[command];
    if (!handler) throw `no handler for ${command}`;
    return handler(args);
  });
  vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
  return invoke;
}

const token = (accessToken = 'access-1', expiresIn = 3599) => () => ({ accessToken, expiresIn });
const fail = (code: string) => () => {
  throw code;
};

describe('desktop Google sign-in (#177)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetVaultForTests();
    globalThis.indexedDB = new IDBFactory();
    loadScript.mockReset();
    window.google = undefined;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('the IPC wrapper', () => {
    it('turns the shell answer into a token with an expiry, never asking for a refresh token', async () => {
      const invoke = stubShell({ google_sign_in: token('a', 100), google_access_token: token('b', 0), google_sign_out: () => null });
      expect(await desktopSignIn('ada@example.com', () => 1000)).toEqual({ accessToken: 'a', expiresAt: 101_000 });
      expect(invoke).toHaveBeenCalledWith('google_sign_in', { loginHint: 'ada@example.com' });
      await desktopSignIn(null);
      expect(invoke).toHaveBeenLastCalledWith('google_sign_in', {});
      // A missing or odd lifetime counts as Google's usual hour.
      expect(await desktopAccessToken(() => 0)).toEqual({ accessToken: 'b', expiresAt: 3_600_000 });
      await desktopSignOut();
      expect(invoke).toHaveBeenLastCalledWith('google_sign_out', undefined);
    });

    it('throws errors a person can act on, and knows when the sign-in is gone', async () => {
      stubShell({ google_access_token: fail('expired'), google_sign_in: () => ({}) });
      const error = await desktopAccessToken().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DesktopAuthError);
      expect((error as DesktopAuthError).signedOut).toBe(true);
      expect((error as Error).message).toMatch(/expired/);
      await expect(desktopSignIn()).rejects.toThrow(/Authorization failed/);
      vi.unstubAllGlobals();
      await expect(desktopSignIn()).rejects.toThrow(/not set up/);
      stubShell({ google_sign_in: () => Promise.reject(new Error('boom')) });
      await expect(desktopSignIn()).rejects.toThrow(/Authorization failed/);
    });

    it('describes every shell error code', () => {
      expect(describeDesktopAuthError('not_configured')).toMatch(/not set up/);
      expect(describeDesktopAuthError('signed_out')).toMatch(/Not connected/);
      expect(describeDesktopAuthError('cancelled')).toMatch(/canceled/);
      expect(describeDesktopAuthError('denied')).toMatch(/denied/);
      expect(describeDesktopAuthError('timed_out')).toMatch(/timed out/);
      expect(describeDesktopAuthError('keychain: locked')).toMatch(/keychain/);
      expect(describeDesktopAuthError('network: dns')).toMatch(/reach Google/);
      expect(describeDesktopAuthError('google: invalid_client')).toBe('Authorization failed (invalid_client)');
      expect(describeDesktopAuthError('???')).toBe('Authorization failed');
      expect(new DesktopAuthError('cancelled').signedOut).toBe(false);
    });
  });

  describe('GoogleDriveProvider in the desktop app', () => {
    it('connects through the system browser, with no GIS and no web client id', async () => {
      const invoke = stubShell({ google_sign_in: token('desk-token') });
      rememberAccount('googleDrive', 'ada@example.com');
      const provider = new GoogleDriveProvider();
      expect(await provider.connect()).toBe(true);
      expect(provider.getAccessToken()).toBe('desk-token');
      expect(provider.hasUsableToken()).toBe(true);
      expect(provider.status()).toBe('Drive: Connected');
      expect(invoke).toHaveBeenCalledWith('google_sign_in', { loginHint: 'ada@example.com' });
      expect(loadScript).not.toHaveBeenCalled();
      expect(wasConnected('googleDrive')).toBe(true);
      // Nothing like a refresh token is anywhere the page keeps things.
      expect(JSON.stringify({ ...localStorage })).not.toMatch(/refresh/i);
      expect(sessionStorage.getItem('drive_session_token')).toContain('desk-token');
    });

    it('says why a sign-in failed', async () => {
      stubShell({ google_sign_in: fail('cancelled') });
      const provider = new GoogleDriveProvider();
      expect(await provider.connect()).toBe(false);
      expect(provider.status()).toBe('Drive: Sign-in was canceled.');
      stubShell({ google_sign_in: fail('not_configured') });
      expect(await provider.connect()).toBe(false);
      expect(provider.status()).toMatch(/not set up in this build/);
    });

    it('a log out while the browser is open wins', async () => {
      let finish!: (value: unknown) => void;
      stubShell({ google_sign_in: () => new Promise((resolve) => (finish = resolve)), google_sign_out: () => null });
      const provider = new GoogleDriveProvider();
      const connecting = provider.connect();
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      await provider.disconnect();
      finish({ accessToken: 'late', expiresIn: 3600 });
      expect(await connecting).toBe(false);
      expect(provider.isSignedIn()).toBe(false);
    });

    it('signs back in on the next start from the keychain, with no browser', async () => {
      rememberAccount('googleDrive', 'ada@example.com');
      const invoke = stubShell({ google_access_token: token('fresh') });
      const provider = new GoogleDriveProvider();
      expect(await provider.restoreSession()).toBe(true);
      expect(provider.getAccessToken()).toBe('fresh');
      expect(provider.status()).toBe('Drive: Session restored');
      expect(invoke).toHaveBeenCalledWith('google_access_token', undefined);
      expect(loadScript).not.toHaveBeenCalled();
    });

    it('shows the sign-in as expired when the keychain has none, or Google refused it', async () => {
      rememberAccount('googleDrive', 'ada@example.com');
      stubShell({ google_access_token: fail('expired') });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const provider = new GoogleDriveProvider();
      expect(await provider.restoreSession()).toBe(false);
      expect(provider.status()).toBe('Drive: Sign-in expired');
      expect(warn).toHaveBeenCalled();
    });

    it('refreshes an expired token through the shell before a Drive call', async () => {
      stubShell({ google_access_token: token('renewed') });
      const provider = new GoogleDriveProvider();
      (provider as any).accessToken = 'old';
      (provider as any).tokenExpiresAt = Date.now() - 1000;
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ files: [] }) }));
      vi.stubGlobal('fetch', fetchMock);
      await provider.listProjects();
      expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer renewed' }) }));
    });

    it('ends the session when the shell has no sign-in left', async () => {
      stubShell({ google_access_token: fail('signed_out') });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const provider = new GoogleDriveProvider();
      const lost = vi.fn();
      provider.onSessionLost(lost);
      (provider as any).accessToken = 'old';
      (provider as any).tokenExpiresAt = Date.now() - 1000;
      await expect(provider.listProjects()).rejects.toThrow(/Session expired/);
      expect(lost).toHaveBeenCalled();
      expect(provider.isSignedIn()).toBe(false);
    });

    it('logs out through the shell, which forgets and revokes the refresh token', async () => {
      rememberAccount('googleDrive', 'ada@example.com');
      const invoke = stubShell({ google_sign_in: token('t'), google_sign_out: () => null });
      const provider = new GoogleDriveProvider();
      await provider.connect();
      await provider.disconnect();
      expect(invoke).toHaveBeenCalledWith('google_sign_out', undefined);
      expect(provider.isSignedIn()).toBe(false);
      expect(rememberedAccount('googleDrive')).toBeNull();
      expect(loadScript).not.toHaveBeenCalled();
      // Even with no token in the page, log out still clears the keychain.
      stubShell({ google_sign_out: fail('keychain: locked') });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await provider.disconnect();
      expect(warn).toHaveBeenCalledWith('Could not sign out of Google in the desktop app', expect.anything());
    });
  });
});
