// "Keep me signed in on this browser" (#201): the tokens of providers the person opted in for, in their
// own IndexedDB database, so they outlive the tab. It loads with the provider chunks, not the page.
//
// NOTE: a token here works for anyone who can open this browser profile until it expires or the person
// logs out, which is why it's opt-in with a shared-computer warning. Tokens never leave this module
// except to the provider that asked, and errors are logged without them.
import { TOKEN_DB_NAME } from './accountMemory';
import type { ProviderId } from './registry';

const STORE = 'tokens';

export type VaultToken = { accessToken: string; expiresAt: number; account?: string };
type Row = VaultToken & { provider: ProviderId };

let dbPromise: Promise<IDBDatabase> | null = null;

function openVault(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available in this browser.'));
        return;
      }
      const request = indexedDB.open(TOKEN_DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'provider' });
      };
      request.onsuccess = () => {
        const db = request.result;
        // Let a log out in another tab delete the database instead of waiting on this one.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Sign-in storage is busy in another tab.'));
    }).catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openVault();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Keep a provider's token for later visits. Best effort: a failure only means signing in again. */
export async function saveToken(provider: ProviderId, token: VaultToken): Promise<void> {
  try {
    const row: Row = { provider, accessToken: token.accessToken, expiresAt: token.expiresAt };
    if (token.account) row.account = token.account;
    await run('readwrite', (store) => store.put(row));
  } catch (error) {
    console.warn(`Could not keep the ${provider} sign-in on this browser`, describe(error));
  }
}

/**
 * A provider's kept token, or null. One that expired (or is within slackMs of it) is deleted on the
 * spot, so an expired token never lingers.
 */
export async function loadToken(provider: ProviderId, slackMs: number, now = Date.now()): Promise<VaultToken | null> {
  try {
    const row = (await run('readonly', (store) => store.get(provider))) as Row | undefined;
    if (!row) return null;
    if (typeof row.accessToken !== 'string' || !row.accessToken || typeof row.expiresAt !== 'number' || row.expiresAt <= now + slackMs) {
      await deleteToken(provider);
      return null;
    }
    return { accessToken: row.accessToken, expiresAt: row.expiresAt, ...(typeof row.account === 'string' ? { account: row.account } : {}) };
  } catch (error) {
    console.warn(`Could not read the ${provider} sign-in kept on this browser`, describe(error));
    return null;
  }
}

/** Forget a provider's kept token, for Log out, an expired token, or "Keep me signed in" turned off. */
export async function deleteToken(provider: ProviderId): Promise<void> {
  try {
    await run('readwrite', (store) => store.delete(provider));
  } catch (error) {
    console.warn(`Could not clear the ${provider} sign-in kept on this browser`, describe(error));
  }
}

/** Close the database, for tests that delete it. */
export function resetVaultForTests() {
  void dbPromise?.then((db) => db.close()).catch(() => undefined);
  dbPromise = null;
}

// Only the error's name and message, so nothing the request held ends up in the console.
const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));
