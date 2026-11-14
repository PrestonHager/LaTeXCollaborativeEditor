// What this browser remembers about storage sign-ins between visits (#201). It's in the initial load,
// so it stays tiny: the token code lives in the lazy provider chunks (tokenVault.ts).
//
// NOTE: only *that* a service was connected, as which account, and whether "Keep me signed in on this
// browser" is on. Never a token: tokens stay in this tab's sessionStorage, or in IndexedDB when the
// person opts in (tokenVault.ts). Nothing here goes to peers.
import type { ProviderId } from './registry';

export const ACCOUNTS_STORAGE_KEY = 'storage_accounts';
// The IndexedDB database tokenVault.ts keeps "Keep me signed in" tokens in. It's here so a log out can
// still delete it when the provider chunk couldn't load.
export const TOKEN_DB_NAME = 'latex-editor-sign-ins';
// An email address can't be longer than this, so anything longer is junk.
const MAX_ACCOUNT_LENGTH = 320;

export type RememberedAccount = {
  /** Connected on an earlier visit and not logged out since. */
  connected: boolean;
  /** The account's email or name, when we looked it up. */
  account: string | null;
  /** "Keep me signed in on this browser": tokens go to IndexedDB too. */
  keepSignedIn: boolean;
};

type Stored = Partial<Record<ProviderId, RememberedAccount>>;

function read(): Stored {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACCOUNTS_STORAGE_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Stored) : {};
  } catch {
    return {};
  }
}

function write(stored: Stored) {
  try {
    if (Object.keys(stored).length) localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(stored));
    else localStorage.removeItem(ACCOUNTS_STORAGE_KEY);
  } catch {
    // Storage is locked down, so the sign-in just isn't remembered.
  }
}

/** What's remembered about a provider, or null when nothing is (never connected, or logged out). */
export function rememberedAccount(id: ProviderId): RememberedAccount | null {
  const entry = read()[id];
  if (!entry || typeof entry !== 'object') return null;
  const account = typeof entry.account === 'string' && entry.account.length <= MAX_ACCOUNT_LENGTH ? entry.account : null;
  return { connected: entry.connected === true, account, keepSignedIn: entry.keepSignedIn === true };
}

/** Whether a provider was connected and not logged out since, so a silent sign-in is worth a try. */
export const wasConnected = (id: ProviderId) => rememberedAccount(id)?.connected === true;

/** Note that a provider is connected, and as whom once known. Keeps the "Keep me signed in" choice. */
export function rememberAccount(id: ProviderId, account: string | null) {
  const stored = read();
  const previous = rememberedAccount(id);
  stored[id] = { connected: true, account: account ?? previous?.account ?? null, keepSignedIn: previous?.keepSignedIn ?? false };
  write(stored);
}

/** Turn "Keep me signed in on this browser" on or off. It's kept even while signed out. */
export function setKeepSignedInChoice(id: ProviderId, keepSignedIn: boolean) {
  const stored = read();
  const previous = rememberedAccount(id);
  stored[id] = { connected: previous?.connected ?? false, account: previous?.account ?? null, keepSignedIn };
  write(stored);
}

/** Whether "Keep me signed in on this browser" is on for a provider. */
export const keepsSignedIn = (id: ProviderId) => rememberedAccount(id)?.keepSignedIn === true;

/** Forget everything about a provider, the "Keep me signed in" choice included. Log out does this. */
export function forgetAccount(id: ProviderId) {
  const stored = read();
  delete stored[id];
  write(stored);
}
