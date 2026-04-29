import type { StorageProvider } from './types';

const STORAGE_KEY = 'latex_editor_docs';

type StoredDocs = Record<string, string>;

function readDocs(): StoredDocs {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as StoredDocs;
  } catch {
    return {};
  }
}

function writeDocs(docs: StoredDocs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
}

export class LocalAppStorageProvider implements StorageProvider {
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
