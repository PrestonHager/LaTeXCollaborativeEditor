import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LazyGoogleDriveProvider } from './lazyGoogleDrive';
import { StorageError } from '../errors';
import { OfflineError } from '../../app/lazy';

const TOKEN_KEY = 'drive_session_token';

/** A stand-in for the real provider, with every method the facade forwards to. */
function fakeProvider() {
  return {
    status: vi.fn(() => 'Drive: Connected'),
    getAccessToken: vi.fn(() => 'live-token'),
    hasUsableToken: vi.fn(() => true),
    isSignedIn: vi.fn(() => true),
    onSessionLost: vi.fn(),
    accountLabel: vi.fn(() => 'me@example.com'),
    loadAccount: vi.fn(async () => 'me@example.com'),
    disconnect: vi.fn(async () => {}),
    currentProjectId: vi.fn((id: string) => `alias-${id}`),
    connect: vi.fn(async () => true),
    fileVersion: vi.fn(() => 'v1'),
    pathOfDriveId: vi.fn(() => 'main.tex'),
    listProjects: vi.fn(async () => [{ id: 'p', name: 'P' }]),
    createProject: vi.fn(async (name: string) => ({ id: 'new', name })),
    openProject: vi.fn(async (id: string) => ({ id, name: 'P', entries: [] })),
    readFile: vi.fn(async () => new Uint8Array([1])),
    writeFile: vi.fn(async () => ({ version: 'v2' })),
    createFolder: vi.fn(async () => {}),
    move: vi.fn(async () => {}),
    remove: vi.fn(async () => 'trash-token'),
    restore: vi.fn(async () => true),
    renameProject: vi.fn(async () => {}),
    setMainFile: vi.fn(async () => {}),
    moveProject: vi.fn(async () => {}),
    projectFolderId: vi.fn(async () => 'folder'),
    driveFetch: vi.fn(async () => new Response('ok')),
  };
}

function setup(load?: () => Promise<unknown>, online = true) {
  const provider = fakeProvider();
  const loader = vi.fn(load ?? (async () => ({ GoogleDriveProvider: vi.fn(function () { return provider; }) })));
  const drive = new LazyGoogleDriveProvider(loader as never, () => online);
  return { drive, provider, loader };
}

describe('LazyGoogleDriveProvider', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('answers the startup questions from storage without loading the provider', () => {
    localStorage.setItem('drive_access_token', 'old');
    const { drive, loader } = setup();
    expect(localStorage.getItem('drive_access_token')).toBeNull();
    expect(drive.label).toBe('Google Drive');
    expect(drive.status()).toBe('Autosave Off');
    expect(drive.isSignedIn()).toBe(false);
    expect(drive.hasUsableToken()).toBe(false);
    expect(drive.getAccessToken()).toBe('');
    expect(drive.accountLabel()).toBeNull();
    expect(drive.currentProjectId('p1')).toBe('p1');
    expect(drive.fileVersion('p1', 'main.tex')).toBeUndefined();
    expect(drive.pathOfDriveId('p1', 'id')).toBeUndefined();
    expect(loader).not.toHaveBeenCalled();
  });

  it('reads a token kept from before a reload', () => {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken: 'kept', expiresAt: Date.now() + 3600_000, account: 'me@example.com' }));
    const { drive, loader } = setup();
    expect(drive.isSignedIn()).toBe(true);
    expect(drive.hasUsableToken()).toBe(true);
    expect(drive.getAccessToken()).toBe('kept');
    expect(drive.accountLabel()).toBe('me@example.com');
    expect(loader).not.toHaveBeenCalled();
  });

  it('reads the old single-file link and forgets it', () => {
    localStorage.setItem('drive_active_file_ref', JSON.stringify({ id: 'f1', name: 'doc.tex', documentId: 'd1' }));
    const { drive } = setup();
    expect(drive.legacyProjectId('d1', 'doc.tex')).toBe('file:f1');
    expect(drive.legacyProjectId('other', 'doc.tex')).toBeNull();
    drive.forgetLegacyFile();
    expect(drive.legacyProjectId('d1', 'doc.tex')).toBeNull();
  });

  it('loads the provider once and forwards every call to it', async () => {
    const { drive, provider, loader } = setup();
    const lost = vi.fn();
    drive.onSessionLost(lost);
    await expect(drive.connect()).resolves.toBe(true);
    expect(provider.onSessionLost).toHaveBeenCalledWith(lost);
    await expect(drive.listProjects()).resolves.toEqual([{ id: 'p', name: 'P' }]);
    await drive.createProject('New');
    await drive.openProject('p');
    await drive.readFile('p', 'a.tex');
    await drive.writeFile('p', 'a.tex', 'x', { force: true });
    await drive.createFolder('p', 'f');
    await drive.move('p', 'a', 'b');
    await expect(drive.remove('p', 'a')).resolves.toBe('trash-token');
    await expect(drive.restore('p', 'a', 't')).resolves.toBe(true);
    await drive.renameProject('p', 'Q');
    await drive.setMainFile('p', 'main.tex');
    await drive.moveProject('p', 'folder');
    await expect(drive.projectFolderId('p')).resolves.toBe('folder');
    await drive.driveFetch('https://example.com', {}, 'test');
    await expect(drive.loadAccount()).resolves.toBe('me@example.com');
    expect(provider.writeFile).toHaveBeenCalledWith('p', 'a.tex', 'x', { force: true });
    // Once loaded, the sync answers come from the provider.
    expect(drive.status()).toBe('Drive: Connected');
    expect(drive.getAccessToken()).toBe('live-token');
    expect(drive.hasUsableToken()).toBe(true);
    expect(drive.isSignedIn()).toBe(true);
    expect(drive.accountLabel()).toBe('me@example.com');
    expect(drive.currentProjectId('p')).toBe('alias-p');
    expect(drive.fileVersion('p', 'a')).toBe('v1');
    expect(drive.pathOfDriveId('p', 'id')).toBe('main.tex');
    drive.onSessionLost(lost);
    expect(provider.onSessionLost).toHaveBeenCalledTimes(2);
    await drive.disconnect();
    expect(provider.disconnect).toHaveBeenCalled();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('preloads without waiting', async () => {
    const { drive, loader } = setup();
    drive.preload();
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("says Drive couldn't load, and tries again on the next call", async () => {
    const provider = fakeProvider();
    const load = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module')).mockResolvedValue({
      GoogleDriveProvider: vi.fn(function () { return provider; }),
    });
    const drive = new LazyGoogleDriveProvider(load, () => true);
    await expect(drive.connect()).resolves.toBe(false);
    expect(drive.status()).toBe("Drive: Google Drive couldn't load. Check your connection, then reload the page.");
    await expect(drive.connect()).resolves.toBe(true);
    expect(drive.status()).toBe('Drive: Connected');
  });

  it('rejects calls with a StorageError while offline, without trying the load', async () => {
    const { drive, loader } = setup(undefined, false);
    const error = await drive.listProjects().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).message).toBe("Drive: You're offline. Google Drive will work once you're back online.");
    expect((error as StorageError & { cause: unknown }).cause).toBeInstanceOf(OfflineError);
    expect(loader).not.toHaveBeenCalled();
    await expect(drive.loadAccount()).resolves.toBeNull();
  });

  it('looks up the account only with a usable token, and treats a failed load as unknown', async () => {
    const { drive, loader } = setup(() => Promise.reject(new Error('gone')));
    await expect(drive.loadAccount()).resolves.toBeNull();
    expect(loader).not.toHaveBeenCalled();
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken: 'kept', expiresAt: Date.now() + 3600_000 }));
    await expect(drive.loadAccount()).resolves.toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('disconnects without loading when this tab never signed in', async () => {
    localStorage.setItem('drive_active_file_ref', JSON.stringify({ id: 'f1', name: 'doc.tex' }));
    const { drive, loader } = setup();
    await drive.disconnect();
    expect(loader).not.toHaveBeenCalled();
    expect(drive.status()).toBe('Drive: Disconnected');
    expect(localStorage.getItem('drive_active_file_ref')).toBeNull();
  });

  it('still forgets the token on disconnect when the provider cannot load', async () => {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken: 'kept', expiresAt: Date.now() + 3600_000 }));
    const { drive } = setup(() => Promise.reject(new Error('gone')));
    await drive.disconnect();
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(drive.isSignedIn()).toBe(false);
    expect(drive.status()).toBe('Drive: Disconnected');
  });
});
