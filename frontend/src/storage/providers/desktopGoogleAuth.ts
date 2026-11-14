// Google sign-in in the desktop app (issue #177, docs/desktop.md "Google sign-in"). Google blocks
// OAuth inside an app's webview, so the shell signs in through the system browser (a loopback
// redirect with PKCE, in desktop/src-tauri/src/google_auth.rs) and keeps the refresh token in the
// OS keychain. This page only ever gets short-lived access tokens from it, over Tauri IPC.
//
// A lazy chunk: googleDrive.ts imports it only in the desktop app.

/** An access token and when it runs out, in ms since the epoch. */
export type DesktopToken = { accessToken: string; expiresAt: number };

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type RustToken = { accessToken: string; expiresIn: number };

/** Thrown with wording a person can act on. `code` is the shell's short error code. */
export class DesktopAuthError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(describeDesktopAuthError(code));
    this.name = 'DesktopAuthError';
    this.code = code;
  }
  /** The refresh token is gone or dead: the person has to connect again. */
  get signedOut() {
    return this.code === 'signed_out' || this.code === 'expired';
  }
}

/** The shell's error codes (google_auth.rs AuthError), in words. */
export function describeDesktopAuthError(code: string): string {
  switch (code) {
    case 'not_configured':
      return 'Google sign-in is not set up in this build of the app.';
    case 'signed_out':
      return 'Not connected. Use File > Connect Google Drive.';
    case 'expired':
      return 'Sign-in expired. Connect Google Drive to sign in again.';
    case 'cancelled':
      return 'Sign-in was canceled.';
    case 'denied':
      return 'Access was denied. Grant Drive access to save files.';
    case 'timed_out':
      return 'Sign-in timed out. Connect Google Drive to try again.';
  }
  if (code.startsWith('keychain:')) return "Couldn't use this computer's keychain to keep the sign-in.";
  if (code.startsWith('network:')) return "Couldn't reach Google. Check your connection and try again.";
  if (code.startsWith('google:')) return `Authorization failed (${code.slice('google:'.length).trim()})`;
  return 'Authorization failed';
}

function shellInvoke(win: object | undefined = globalThis.window): Invoke {
  const internals = (win as { __TAURI_INTERNALS__?: { invoke?: Invoke } } | undefined)?.__TAURI_INTERNALS__;
  if (typeof internals?.invoke !== 'function') throw new DesktopAuthError('not_configured');
  return internals.invoke;
}

async function call(command: string, args?: Record<string, unknown>): Promise<unknown> {
  try {
    return await shellInvoke()(command, args);
  } catch (error) {
    if (error instanceof DesktopAuthError) throw error;
    throw new DesktopAuthError(typeof error === 'string' ? error : 'google: the app could not run the sign-in');
  }
}

function toToken(value: unknown, now: number): DesktopToken {
  const token = value as Partial<RustToken> | null;
  if (!token || typeof token.accessToken !== 'string' || !token.accessToken) throw new DesktopAuthError('google: no access token');
  const seconds = typeof token.expiresIn === 'number' && token.expiresIn > 0 ? token.expiresIn : 3600;
  return { accessToken: token.accessToken, expiresAt: now + seconds * 1000 };
}

/** Sign in in the system browser. Resolves when the person comes back from Google. */
export async function desktopSignIn(loginHint?: string | null, now = () => Date.now()): Promise<DesktopToken> {
  return toToken(await call('google_sign_in', loginHint ? { loginHint } : {}), now());
}

/** A new access token from the keychain's refresh token, with no browser. Throws when signed out. */
export async function desktopAccessToken(now = () => Date.now()): Promise<DesktopToken> {
  return toToken(await call('google_access_token'), now());
}

/** Forget the refresh token and revoke it with Google. */
export async function desktopSignOut(): Promise<void> {
  await call('google_sign_out');
}
