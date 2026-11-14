import type { StorageProvider } from './types';
import type { CommandId } from '../../ui/menuBar';
import { rememberedAccount, wasConnected } from './accountMemory';

/**
 * The storage provider registry (#200). Every place a project can be saved is listed here once, with
 * what it can do and whether this deployment set it up. The Accounts panel, File > Open Project and
 * the status bar all read from it, so a new provider (#202, #203, #204) only needs an entry, plus
 * its words in providerLabels.ts. Those stay out of this file because it's in the initial load.
 *
 * NOTE: nothing here goes to peers. Guests only ever hear the host's storage name (see
 * ProjectState.currentStorageLabel), never an account or a token.
 */
// 'localFolder' is a folder on this computer, only in the desktop app (#178). Its entry comes from a
// lazy chunk (app/desktopFolders.ts), added with ProviderRegistry.add.
export type ProviderId = 'local' | 'googleDrive' | 'localFolder';

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
 * - expired: was signed in (in this tab, or on an earlier visit, see accountMemory.ts), but the token
 *   ran out and a silent sign-in hasn't brought it back yet.
 * - signedOut: set up on this site, but nobody signed in in this tab.
 * - notConfigured: this deployment has no app registration for it (see docs/deployment.md).
 */
export type AccountStatus = 'connected' | 'expired' | 'signedOut' | 'notConfigured';

export type ProviderEntry = {
  readonly id: ProviderId;
  /** The name people see, like "Google Drive". */
  readonly name: string;
  /** A Lucide icon name, drawn with storageIcons in ui/icons.ts. */
  readonly icon: 'hard-drive' | 'monitor' | 'folder';
  readonly capabilities: ProviderCapabilities;
  /** False for storage that needs no account, like this browser. */
  readonly needsSignIn: boolean;
  readonly provider: StorageProvider;
  /** The commands the Accounts panel's Connect and Log out run, for providers with an account. */
  readonly connectCommand?: CommandId;
  readonly logOutCommand?: CommandId;
  /** The Accounts panel's button for a provider without sign-in that still has an action, like "Save to a Folder". */
  readonly actionLabel?: string;
  /** Whether this deployment has the keys it needs. */
  configured(): boolean;
  status(): AccountStatus;
  /** The signed-in account (an email or name), when known. */
  account(): string | null;
  /** "Keep me signed in on this browser" (#201), for providers whose tokens can be kept. */
  readonly keepSignedIn?: KeepSignedIn;
};

export type KeepSignedIn = {
  get(): boolean;
  /** Turning it off deletes the kept token right away. */
  set(on: boolean): Promise<void>;
};

export type ProviderRegistry = {
  list(): readonly ProviderEntry[];
  get(id: ProviderId): ProviderEntry;
  /** The entry for a provider instance, like the one the open project saves to. */
  forProvider(provider: StorageProvider): ProviderEntry | undefined;
  /** Add a provider that loads later, like the desktop app's folders. */
  add(entry: ProviderEntry): void;
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
    add(entry) {
      if (byId.has(entry.id)) throw new Error('Two storage providers share an id');
      byId.set(entry.id, entry);
      entries.push(entry);
    },
  };
}

/** Browser storage (IndexedDB). It needs no account and is always there. */
export function localStorageEntry(provider: StorageProvider): ProviderEntry {
  return {
    id: 'local',
    name: 'This browser',
    icon: 'monitor',
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
  keepSignedIn?(): boolean;
  setKeepSignedIn?(on: boolean): Promise<void>;
};

/** Google Drive. `clientId` is VITE_GOOGLE_CLIENT_ID; without it the deployment can't sign in. */
export function googleDriveEntry(provider: DriveAccountSource, clientId: string | undefined): ProviderEntry {
  return {
    id: 'googleDrive',
    name: 'Google Drive',
    icon: 'hard-drive',
    // Drive keeps a file's earlier versions (Manage versions in Drive). 5 TB is Drive's own file limit.
    capabilities: { binaryFiles: true, folders: true, history: true, maxFileBytes: 5 * 1024 ** 4 },
    needsSignIn: true,
    provider,
    // The File menu's own Drive commands, so the panel moves saving exactly as they do.
    connectCommand: 'file.connectDrive',
    logOutCommand: 'file.disconnectDrive',
    configured: () => Boolean(clientId),
    status() {
      if (!clientId) return 'notConfigured';
      if (provider.hasUsableToken()) return 'connected';
      // An expired token is kept until a refresh fails, so it still counts as signed in. So does an
      // account from an earlier visit that wasn't logged out: it shows "Expired" until a sign-in.
      return provider.isSignedIn() || wasConnected('googleDrive') ? 'expired' : 'signedOut';
    },
    account() {
      const remembered = rememberedAccount('googleDrive');
      return provider.accountLabel() ?? (remembered?.connected ? remembered.account : null);
    },
    keepSignedIn:
      provider.keepSignedIn && provider.setKeepSignedIn
        ? { get: () => provider.keepSignedIn!(), set: (on) => provider.setKeepSignedIn!(on) }
        : undefined,
  };
}
