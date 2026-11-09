// A small promise wrapper around the one IndexedDB database the app uses.

export const DB_NAME = 'latex-editor';
const DB_VERSION = 1;

export const PROJECTS_STORE = 'projects';
export const FILES_STORE = 'files';
export const BLOBS_STORE = 'blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

/** Open the database, making the stores on first use. */
export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available in this browser.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PROJECTS_STORE)) db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(FILES_STORE)) {
          const files = db.createObjectStore(FILES_STORE, { keyPath: ['projectId', 'path'] });
          files.createIndex('byProject', 'projectId');
        }
        if (!db.objectStoreNames.contains(BLOBS_STORE)) db.createObjectStore(BLOBS_STORE, { keyPath: 'hash' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Browser storage is busy in another tab. Close other tabs of this app and try again.'));
    }).catch((error) => {
      // Let the next call try again instead of caching the failure.
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/** Forget the open connection. Tests use this after deleting the database. */
export function resetDbForTests() {
  void dbPromise?.then((db) => db.close()).catch(() => undefined);
  dbPromise = null;
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Run work inside one transaction and resolve once it commits. */
export async function withTransaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(stores, mode);
  const committed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Browser storage write was aborted.'));
  });
  let result: T;
  try {
    result = await work(tx);
  } catch (error) {
    // Roll back anything the work already wrote, so a failed step never half-applies.
    committed.catch(() => undefined);
    try {
      tx.abort();
    } catch {
      // It already finished, so there's nothing to roll back.
    }
    throw error;
  }
  await committed;
  return result;
}
