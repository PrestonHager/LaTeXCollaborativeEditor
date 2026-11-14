import type { StorageProvider } from './types';

/**
 * The storage provider registry (#200). Every place a project can be saved is listed here once, with
 * what it can do and whether this deployment set it up. The Accounts panel, File > Open Project and
 * the status bar all read from it, so a new provider (#202, #203, #204) only needs an entry.
 *
 * NOTE: nothing here goes to peers. Guests only ever hear the host's storage name (see
 * ProjectState.currentStorageLabel), never an account or a token.
 */
export type ProviderId = 'local' | 'googleDrive';

export type ProviderCapabilities = {
  /** Images, PDFs and other non-text files are stored as they are. */
  binaryFiles: boolean;
  /** Subfolders are kept as real folders. */
  folders: boolean;
  /** The provider keeps earlier versions of a file that people can go back to. */
  history: boolean;
  /** The largest single file it takes, in bytes. null when only the browser or account quota limits it. */
  maxFileBytes: number | null;
};

/**
 * - connected: ready to save. Browser storage is always connected.
 * - expired: was signed in, but the token ran out and a silent refresh hasn't brought it back yet.
 * - signedOut: set up on this site, but nobody signed in in this tab.
 * - notConfigured: this deployment has no app registration for it (see docs/deployment.md).
 */
export type AccountStatus = 'connected' | 'expired' | 'signedOut' | 'notConfigured';

export type ProviderEntry = {
  readonly id: ProviderId;
  /** The name people see, like "Google Drive". */
  readonly name: string;
  /** A Lucide icon name, drawn with storageIcons in ui/icons.ts. */
  readonly icon: 'hard-drive' | 'monitor';
  /** One line on where the files go. */
  readonly description: string;
  readonly capabilities: ProviderCapabilities;
  /** False for storage that needs no account, like this browser. */
  readonly needsSignIn: boolean;
  readonly provider: StorageProvider;
  /** Whether this deployment has the keys it needs. */
  configured(): boolean;
  status(): AccountStatus;
  /** The signed-in account (an email or name), when known. */
  account(): string | null;
};

export type ProviderRegistry = {
  list(): readonly ProviderEntry[];
  get(id: ProviderId): ProviderEntry;
  /** The entry for a provider instance, like the one the open project saves to. */
  forProvider(provider: StorageProvider): ProviderEntry | undefined;
};

export function createProviderRegistry(entries: ProviderEntry[]): ProviderRegistry {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  if (byId.size !== entries.length) throw new Error('Two storage providers share an id');
  return {
    list: () => entries,
    get(id) {
      const entry = byId.get(id);
      if (!entry) throw new Error(`Unknown storage provider: ${id}`);
      return entry;
    },
    forProvider: (provider) => entries.find((entry) => entry.provider === provider),
  };
}

/** Browser storage (IndexedDB). It needs no account and is always there. */
export function localStorageEntry(provider: StorageProvider): ProviderEntry {
  return {
    id: 'local',
    name: 'This browser',
    icon: 'monitor',
    description: 'Saved in this browser on this device. Nothing is uploaded.',
    capabilities: { binaryFiles: true, folders: true, history: false, maxFileBytes: null },
    needsSignIn: false,
    provider,
    configured: () => true,
    status: () => 'connected',
    account: () => null,
  };
}

/** The bits of GoogleDriveProvider the entry reads, so tests can pass a fake. */
export type DriveAccountSource = StorageProvider & {
  hasUsableToken(): boolean;
  isSignedIn(): boolean;
  accountLabel(): string | null;
};

/** Google Drive. `clientId` is VITE_GOOGLE_CLIENT_ID; without it the deployment can't sign in. */
export function googleDriveEntry(provider: DriveAccountSource, clientId: string | undefined): ProviderEntry {
  return {
    id: 'googleDrive',
    name: 'Google Drive',
    icon: 'hard-drive',
    description: 'A folder in your Google Drive. The app only sees files it made or you picked.',
    // Drive keeps a file's earlier versions (Manage versions in Drive). 5 TB is Drive's own file limit.
    capabilities: { binaryFiles: true, folders: true, history: true, maxFileBytes: 5 * 1024 ** 4 },
    needsSignIn: true,
    provider,
    configured: () => Boolean(clientId),
    status() {
      if (!clientId) return 'notConfigured';
      if (provider.hasUsableToken()) return 'connected';
      // An expired token is kept until a refresh fails, so it still counts as signed in.
      return provider.isSignedIn() ? 'expired' : 'signedOut';
    },
    account: () => provider.accountLabel(),
  };
}

export const statusLabels: Record<AccountStatus, string> = {
  connected: 'Connected',
  expired: 'Expired',
  signedOut: 'Not connected',
  notConfigured: 'Not configured',
};

/** "Folders, binary files, version history" for the Accounts panel. */
export function describeCapabilities(capabilities: ProviderCapabilities): string {
  const parts: string[] = [];
  if (capabilities.folders) parts.push('folders');
  if (capabilities.binaryFiles) parts.push('images and other files');
  if (capabilities.history) parts.push('version history');
  const text = parts.join(', ');
  return text ? text[0].toUpperCase() + text.slice(1) : 'Text files only';
}
