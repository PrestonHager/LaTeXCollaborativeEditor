import { describeError, isRetryable } from './errors';

type AutosaveConfig = {
  /** Write the project to storage. Resolves to the provider label for the status line. */
  save: () => Promise<string | undefined>;
  onStatus: (status: string) => void;
};

const DEBOUNCE_MS = 4000;
const INTERVAL_MS = 60000;
const RETRY_WAITS_MS = [0, 500, 1000, 2000];
const PAUSED_STATUS = 'Saving paused';

export class AutosaveController {
  private enabled = false;
  // While paused we still count edits, but nothing saves them until we resume.
  private paused = false;
  // We count edits instead of using a dirty flag, so typing during a save isn't marked as saved.
  private revision = 0;
  private savedRevision = 0;
  private debounceTimer: number | undefined;
  private intervalTimer: number | undefined;
  // Saves run one at a time. Without this the debounce and interval timers could both
  // create a new Drive file at once and leave a duplicate behind.
  private queue: Promise<unknown> = Promise.resolve();
  private config: AutosaveConfig;

  constructor(config: AutosaveConfig) {
    this.config = config;
  }

  enable() {
    this.enabled = true;
    if (this.intervalTimer) {
      window.clearInterval(this.intervalTimer);
    }
    this.config.onStatus(this.paused ? PAUSED_STATUS : 'Autosave Enabled');
    this.intervalTimer = window.setInterval(() => void this.trySave(), INTERVAL_MS);
  }

  markDirty() {
    if (!this.enabled) return;
    this.revision += 1;
    if (this.paused) {
      this.config.onStatus(PAUSED_STATUS);
      return;
    }
    this.config.onStatus('Saving pending');
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => void this.trySave(), DEBOUNCE_MS);
  }

  /** Pause or resume automatic saves. Resuming saves anything edited while paused. */
  setPaused(paused: boolean) {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      // Drop the pending debounced save, the interval checks the flag on its own.
      if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
      this.config.onStatus(PAUSED_STATUS);
      return;
    }
    if (this.hasUnsavedChanges()) void this.trySave();
    else this.config.onStatus('Autosave On');
  }

  isPaused() {
    return this.paused;
  }

  hasUnsavedChanges() {
    return this.enabled && this.revision !== this.savedRevision;
  }

  /** Save right away, even while paused. Resolves to false if the save failed (the status line has the reason). */
  saveNow(): Promise<boolean> {
    return this.trySave(true);
  }

  private trySave(force = false): Promise<boolean> {
    return this.enqueue(() => this.saveIfNeeded(force));
  }

  /** Run a task in the save queue, so it never overlaps a save. Used for switching projects. */
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async saveIfNeeded(force: boolean): Promise<boolean> {
    if ((!this.enabled || this.paused) && !force) return true;
    // Check again here since a queued save may already have written these edits.
    if (!force && this.revision === this.savedRevision) return true;

    const revisionAtStart = this.revision;
    this.config.onStatus('Saving');
    try {
      const label = await this.withBackoff(() => this.config.save());
      this.savedRevision = Math.max(this.savedRevision, revisionAtStart);
      this.config.onStatus(this.revision === revisionAtStart ? (label ? `Saved to ${label}` : 'Saved') : this.paused ? PAUSED_STATUS : 'Saving pending');
      return true;
    } catch (error) {
      console.error('Save failed', error);
      this.config.onStatus(`Save Error: ${describeError(error)}`);
      return false;
    }
  }

  private async withBackoff<T>(action: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (const wait of RETRY_WAITS_MS) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try {
        return await action();
      } catch (error) {
        lastError = error;
        // No point retrying an expired login or a full disk.
        if (!isRetryable(error)) break;
      }
    }
    throw lastError;
  }
}
