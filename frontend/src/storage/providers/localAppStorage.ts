import type { StorageProvider } from './types';
import { StorageError, isQuotaError } from '../errors';

const STORAGE_KEY = 'latex_editor_docs';

type StoredDocs = Record<string, string>;

function readDocs(): StoredDocs {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    throw new StorageError('Browser storage is unavailable. Private browsing or site settings may be blocking it.', {
      retryable: false,
      cause: error,
    });
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    // Only keep string entries, in case something else wrote junk under our key.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

function writeDocs(docs: StoredDocs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
  } catch (error) {
    if (isQuotaError(error)) {
      throw new StorageError('Browser storage is full. Download a copy, then clear old local docs.', {
        retryable: false,
        cause: error,
      });
    }
    throw new StorageError('Could not write to browser storage.', { retryable: false, cause: error });
  }
}

export class LocalAppStorageProvider implements StorageProvider {
  readonly label = 'this browser';
  private currentStatus = 'Local storage ready';

  async connect(): Promise<boolean> {
    this.currentStatus = 'Local storage connected';
    return true;
  }

  async save(content: string, fileName: string): Promise<void> {
    const docs = readDocs();
    docs[fileName] = content;
    writeDocs(docs);
    this.currentStatus = `Saved locally: ${fileName}`;
  }

  async saveAs(content: string, oldFileName: string, newFileName: string): Promise<void> {
    const docs = readDocs();
    if (oldFileName in docs) {
      delete docs[oldFileName];
    }
    docs[newFileName] = content;
    writeDocs(docs);
    this.currentStatus = `Renamed locally: ${newFileName}`;
  }

  listDocuments(): string[] {
    return Object.keys(readDocs()).sort((a, b) => a.localeCompare(b));
  }

  loadDocument(fileName: string): string | null {
    const docs = readDocs();
    if (!(fileName in docs)) return null;
    this.currentStatus = `Loaded locally: ${fileName}`;
    return docs[fileName];
  }

  async clear(): Promise<void> {
    writeDocs({});
    this.currentStatus = 'Local docs cleared';
  }

  status(): string {
    return this.currentStatus;
  }
}
