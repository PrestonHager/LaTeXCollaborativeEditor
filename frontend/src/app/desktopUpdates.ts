// App updates in the desktop app (issue #179, docs/desktop.md "Updates"). Part of the desktop
// chunk (desktopUi.ts), so the website never loads it.
//
// The website finds a new build by polling version.json; in the app that file is the bundled one,
// so the shell's updater checks the GitHub release's latest.json instead (desktop/src-tauri/src/
// updates.rs). When it finds a newer, correctly signed release, the usual update card shows with
// "Restart to update": the app saves first (flushBeforeReload, through updateFlow), then the shell
// downloads, installs and restarts.

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/** The bits of updateFlow.ts this needs. */
export type UpdateFlowLike = {
  offer(reason: 'deploy'): void;
  useAppUpdater(install: () => Promise<void>): void;
};

export type DesktopUpdateOptions = {
  /** The update flow, once main.ts has made it. */
  flow: () => UpdateFlowLike | null;
  invoke?: Invoke;
  /** The first check waits a little, so it doesn't slow the start. */
  firstCheckMs?: number;
  /** Then it checks again every few hours, for an app left open for days. */
  everyMs?: number;
  setTimer?: (run: () => void, ms: number) => unknown;
  setRepeat?: (run: () => void, ms: number) => unknown;
};

export const FIRST_CHECK_MS = 10_000;
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

type UpdateInfo = { version: string; notes?: string | null };

function shellInvoke(): Invoke | null {
  const internals = (globalThis.window as { __TAURI_INTERNALS__?: { invoke?: Invoke } } | undefined)?.__TAURI_INTERNALS__;
  return typeof internals?.invoke === 'function' ? internals.invoke : null;
}

/** The shell's install error codes, in words. */
export function describeInstallError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (text === 'no_update') return 'No update is ready yet';
  return text || 'unknown error';
}

/**
 * Start checking for app updates. Returns the check, for tests and for a check on demand.
 * A build without an updater (local or a pull request) answers "none" every time, so nothing shows.
 */
export function setUpDesktopUpdates(options: DesktopUpdateOptions) {
  const invoke = options.invoke ?? shellInvoke();
  let found: string | null = null;

  async function check(): Promise<string | null> {
    if (!invoke) return null;
    try {
      const update = (await invoke('update_check')) as UpdateInfo | null;
      if (!update?.version) return null;
      const flow = options.flow();
      if (!flow) return null;
      if (found !== update.version) {
        found = update.version;
        flow.useAppUpdater(async () => {
          try {
            await invoke('update_install');
          } catch (error) {
            throw new Error(describeInstallError(error));
          }
        });
      }
      flow.offer('deploy');
      return update.version;
    } catch (error) {
      // Offline, or GitHub is down: try again next time. Nothing to tell the person.
      console.warn('Update check failed', error);
      return null;
    }
  }

  if (invoke) {
    (options.setTimer ?? setTimeout)(() => void check(), options.firstCheckMs ?? FIRST_CHECK_MS);
    (options.setRepeat ?? setInterval)(() => void check(), options.everyMs ?? CHECK_EVERY_MS);
  }
  return { check };
}
