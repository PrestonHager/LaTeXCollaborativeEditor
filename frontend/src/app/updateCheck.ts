// Notice when a newer build of the app is deployed (issue #121), and reload to it without losing work.
// The checker polls version.json (written by the build, see docs/versioning.md) and compares it with
// the build this tab runs. main.ts shows the prompt (ui/updatePrompt.ts) and does the reload.
import { VERSION_JSON_PATH, formatVersion, isDifferentBuild, parseVersionInfo, type BuildInfo } from './buildInfo';

/** How often to look for a new build while the tab is open. */
export const UPDATE_CHECK_INTERVAL_MS = 15 * 60_000;
/** Focus and visibility changes check too, but no more often than this. */
export const UPDATE_CHECK_MIN_GAP_MS = 60_000;
/** After failed checks the interval doubles, up to this. */
export const UPDATE_CHECK_MAX_BACKOFF_MS = 60 * 60_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export type UpdateCheckerOptions = {
  /** The build this tab runs. */
  current: BuildInfo;
  /** The page URL version.json sits next to, usually document.baseURI. */
  baseUrl: string;
  /** Called once per new build found. */
  onUpdate: (next: BuildInfo) => void;
  fetch?: FetchLike;
  now?: () => number;
  /** Where focus and visibilitychange come from. Defaults to window and document. */
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  isOnline?: () => boolean;
  intervalMs?: number;
  minGapMs?: number;
};

/** The URL to fetch version.json from. The query string gets past GitHub Pages' 10 minute cache. */
export function versionJsonUrl(baseUrl: string, now: number): string {
  const url = new URL(VERSION_JSON_PATH, baseUrl);
  url.searchParams.set('t', String(now));
  return url.toString();
}

/**
 * Poll version.json and call onUpdate when it names a different build than this one.
 * Every failure is silent: offline, a 404, bad JSON. Failed checks back off, and a 404 stops
 * polling, since that host doesn't serve version.json at all.
 */
export function createUpdateChecker(options: UpdateCheckerOptions) {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const win = options.win ?? window;
  const doc = options.doc ?? document;
  const isOnline = options.isOnline ?? (() => navigator.onLine !== false);
  const intervalMs = options.intervalMs ?? UPDATE_CHECK_INTERVAL_MS;
  const minGapMs = options.minGapMs ?? UPDATE_CHECK_MIN_GAP_MS;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let inFlight: Promise<BuildInfo | null> | null = null;
  let lastCheck = -Infinity;
  let failures = 0;
  // Builds we've already told the page about, so "Later" holds until the next one.
  const announced = new Set<string>();

  const schedule = () => {
    if (!running) return;
    if (timer) clearTimeout(timer);
    const wait = Math.min(intervalMs * 2 ** failures, Math.max(intervalMs, UPDATE_CHECK_MAX_BACKOFF_MS));
    timer = setTimeout(() => void check(), wait);
  };

  const fetchLatest = async (): Promise<BuildInfo | null> => {
    lastCheck = now();
    if (!isOnline()) {
      failures += 1;
      return null;
    }
    try {
      const response = await fetchImpl(versionJsonUrl(options.baseUrl, now()), { cache: 'no-store' });
      if (response.status === 404) {
        stop();
        return null;
      }
      const info = response.ok ? parseVersionInfo(await response.json()) : null;
      failures = info ? 0 : failures + 1;
      return info;
    } catch {
      failures += 1;
      return null;
    }
  };

  /** Check now. Resolves to the new build when there is one, else null. */
  async function check(): Promise<BuildInfo | null> {
    if (!inFlight) {
      inFlight = fetchLatest().finally(() => {
        inFlight = null;
        schedule();
      });
    }
    const latest = await inFlight;
    if (!latest || !isDifferentBuild(options.current, latest)) return null;
    const key = formatVersion(latest);
    if (announced.has(key)) return latest;
    announced.add(key);
    options.onUpdate(latest);
    return latest;
  }

  /** Check on focus or when the tab shows again, unless we just did. */
  const checkSoon = () => {
    if (doc.visibilityState === 'hidden' || now() - lastCheck < minGapMs) return;
    void check();
  };

  function start() {
    if (running) return;
    running = true;
    win.addEventListener('focus', checkSoon);
    doc.addEventListener('visibilitychange', checkSoon);
    void check();
  }

  function stop() {
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
    win.removeEventListener('focus', checkSoon);
    doc.removeEventListener('visibilitychange', checkSoon);
  }

  return { start, stop, check, isRunning: () => running };
}

export type UpdateReason = 'deploy' | 'peer' | 'stale-chunk';

/** What the prompt says, depending on why it's up and whether we're in a room. */
export function updatePromptText(reason: UpdateReason, room: { isHost: boolean; inRoom: boolean }): { message: string; detail: string } {
  const message =
    reason === 'peer'
      ? 'A collaborator is on a newer version of the app. Reload to update so you can keep editing together.'
      : reason === 'stale-chunk'
        ? "Part of the app couldn't load because a new version is live. Reload to update."
        : 'A new version of the app is available.';
  let detail = 'Your changes are saved first.';
  if (room.inRoom) detail += room.isHost ? " Sharing pauses until you pick Resume sharing (same link) under Share, then guests reconnect on their own." : " You'll rejoin the room after the reload.";
  return { message, detail };
}

type FlushDeps = {
  isClient: boolean;
  /** Write the session to this browser right away. */
  persist: () => void;
  autosave: {
    hasUnsavedChanges(): boolean;
    isPaused(): boolean;
    lastSaveError(): string | null;
    saveNow(): Promise<boolean>;
  };
  /** Work a save can't finish, like a file held by a conflict. Null when there's none. */
  blocker?: () => string | null;
};

/**
 * Save everything before reloading for an update: the local session right away, then the
 * storage provider (skipping the debounce) unless saving is paused. Guests save through the host,
 * whose doc already has their edits, so only the local session is written.
 * Resolves to null when it's safe to reload, or the reason it isn't.
 */
export async function flushBeforeReload(deps: FlushDeps): Promise<string | null> {
  deps.persist();
  if (deps.isClient) return null;
  const blocked = deps.blocker?.();
  if (blocked) return blocked;
  const { autosave } = deps;
  if (autosave.isPaused()) return null;
  if (!autosave.hasUnsavedChanges() && !autosave.lastSaveError()) return null;
  if (await autosave.saveNow()) return null;
  return `Couldn't save: ${autosave.lastSaveError() ?? 'the save failed'}.`;
}

/**
 * True when an error looks like an old tab trying to load a script chunk the new deploy removed.
 * Vite reports these as vite:preloadError; a raw dynamic import fails with one of these messages.
 */
export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
    message,
  );
}
