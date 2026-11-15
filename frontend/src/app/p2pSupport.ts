/**
 * Sharing and joining need WebRTC (RTCPeerConnection). Some windows don't have it: the Linux
 * desktop app on a WebKitGTK built without it (issue #176, docs/desktop.md), or a browser with
 * WebRTC turned off by a setting or an extension. This checks for it before any room starts, so
 * the P2P code never loads there, and explains what to do instead (issue #205).
 */

export const NO_WEBRTC_MESSAGE = "This window can't make peer-to-peer connections, so it can't share or join a room.";

export const SUPPORTED_BROWSERS = 'a recent version of Chrome, Edge, Firefox or Safari';

/** True when the page can make a WebRTC peer connection. It never throws. */
export function hasWebRtc(win: object | undefined = globalThis.window): boolean {
  try {
    return Boolean(win) && typeof (win as { RTCPeerConnection?: unknown }).RTCPeerConnection === 'function';
  } catch {
    return false;
  }
}

/**
 * The public web app's address, for the desktop app to open in the browser. The desktop page's
 * own origin (tauri://localhost) means nothing to a browser, so it comes from the docs base the
 * build points at, which the site serves under /docs/ (docs/deployment.md). Null when that isn't
 * a public https address.
 */
export function webAppUrl(docsBase: string): string | null {
  try {
    const docs = new URL(docsBase);
    if (docs.protocol !== 'https:' || !docs.pathname.endsWith('/docs/')) return null;
    return new URL('../', docs).href;
  } catch {
    return null;
  }
}

/** The web app's link for a room, like the one Share copies. */
export function webRoomLink(appUrl: string, roomId: string): string {
  const url = new URL(appUrl);
  url.searchParams.set('room', roomId);
  return url.href;
}

export type P2pAction = 'share' | 'join';

type ExplainOptions = {
  action: P2pAction;
  /** In the desktop app, which can hand a link to the system browser. */
  desktop: boolean;
  /** What to open in the browser: the room for a join, the web app for a share. Null when unknown. */
  link: string | null;
  confirm: (options: { title: string; message: string; confirmLabel: string; cancelLabel: string }) => Promise<boolean>;
  notice: (options: { title: string; message: string; closeLabel?: string }) => Promise<void>;
  /** Open a link in the system browser. Resolves false when it couldn't. */
  openExternal: (url: string) => Promise<boolean>;
  copyText: (value: string) => Promise<void>;
  notify: (message: string) => void;
};

export function noWebRtcTitle(action: P2pAction): string {
  return action === 'share' ? "Can't share from this window" : "Can't join from this window";
}

/** What to do instead, for the dialog and the Files panel. */
export function noWebRtcAdvice(action: P2pAction, desktop: boolean, hasLink = true): string {
  if (desktop) {
    if (!hasLink) return `Open the web app in ${SUPPORTED_BROWSERS} to ${action === 'share' ? 'share' : 'join the room'}.`;
    if (action === 'join') return 'Open the room in your web browser instead.';
    return "Share from the web app in your browser instead. Projects in this app don't carry over, so export this one first.";
  }
  return action === 'join' ? `Open the link in ${SUPPORTED_BROWSERS}.` : `Share from ${SUPPORTED_BROWSERS}.`;
}

/**
 * Tell the person why Share or the room link can't work here. In the desktop app, offer to open
 * the room (or the web app) in the system browser; if that fails, copy the link instead.
 */
export async function explainNoWebRtc(options: ExplainOptions): Promise<void> {
  const { action, desktop, link } = options;
  const title = noWebRtcTitle(action);
  const message = `${NO_WEBRTC_MESSAGE} ${noWebRtcAdvice(action, desktop, Boolean(link))}`;
  if (!desktop || !link) {
    await options.notice({ title, message, closeLabel: 'Close' });
    return;
  }
  const open = await options.confirm({ title, message, confirmLabel: 'Open in browser', cancelLabel: 'Not now' });
  if (!open) return;
  if (await options.openExternal(link)) return;
  try {
    await options.copyText(link);
    options.notify("Couldn't open your browser. The link is copied: paste it into your browser.");
  } catch {
    options.notify(`Couldn't open your browser. Open this link in it: ${link}`);
  }
}
