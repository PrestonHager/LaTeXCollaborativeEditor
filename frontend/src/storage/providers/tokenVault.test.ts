import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { deleteToken, loadToken, resetVaultForTests, saveToken } from './tokenVault';
import { TOKEN_DB_NAME } from './accountMemory';

const HOUR = 3600_000;

describe('tokenVault', () => {
  beforeEach(() => {
    resetVaultForTests();
    globalThis.indexedDB = new IDBFactory();
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps a token per provider until it is deleted', async () => {
    const expiresAt = Date.now() + HOUR;
    await saveToken('googleDrive', { accessToken: 'tok', expiresAt, account: 'ada@example.com' });
    await expect(loadToken('googleDrive', 60_000)).resolves.toEqual({ accessToken: 'tok', expiresAt, account: 'ada@example.com' });
    await expect(loadToken('local', 60_000)).resolves.toBeNull();
    await deleteToken('googleDrive');
    await expect(loadToken('googleDrive', 60_000)).resolves.toBeNull();
  });

  it('leaves the account out when it is unknown', async () => {
    const expiresAt = Date.now() + HOUR;
    await saveToken('googleDrive', { accessToken: 'tok', expiresAt });
    await expect(loadToken('googleDrive', 0)).resolves.toEqual({ accessToken: 'tok', expiresAt });
  });

  it('deletes an expired token instead of handing it back', async () => {
    const now = Date.now();
    await saveToken('googleDrive', { accessToken: 'old', expiresAt: now + 30_000 });
    // Within the slack counts as expired.
    await expect(loadToken('googleDrive', 60_000, now)).resolves.toBeNull();
    // It's gone for good, not just skipped.
    await expect(loadToken('googleDrive', 0, now)).resolves.toBeNull();
  });

  it('lets the database be deleted while open, like a log out whose provider could not load', async () => {
    await saveToken('googleDrive', { accessToken: 'tok', expiresAt: Date.now() + HOUR });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(TOKEN_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('blocked'));
    });
    await expect(loadToken('googleDrive', 0)).resolves.toBeNull();
  });

  it('gets by without IndexedDB, and logs no token', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    resetVaultForTests();
    // @ts-expect-error a browser without IndexedDB
    globalThis.indexedDB = undefined;
    await saveToken('googleDrive', { accessToken: 'secret-token', expiresAt: Date.now() + HOUR });
    await expect(loadToken('googleDrive', 0)).resolves.toBeNull();
    await deleteToken('googleDrive');
    expect(warn).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-token');
  });
});
