export interface StorageProvider {
  /** Short name shown in status messages, like "Google Drive". */
  readonly label?: string;
  connect(): Promise<boolean>;
  save(content: string, fileName: string): Promise<void>;
  saveAs?(content: string, oldFileName: string, newFileName: string): Promise<void>;
  listDocuments?(): string[];
  loadDocument?(fileName: string): string | null;
  clear?(): Promise<void>;
  status(): string;
}
