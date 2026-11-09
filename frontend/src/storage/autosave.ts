import type { StorageProvider } from './providers/types';
import { describeError, isRetryable } from './errors';

type AutosaveConfig = {
  provider: () => StorageProvider;
  getContent: () => string;
  getFileName: () => string;
  onStatus: (status: string) => void;
};

const DEBOUNCE_MS = 4000;
const INTERVAL_MS = 60000;
const RETRY_WAITS_MS = [0, 500, 1000, 2000];

export class AutosaveController {
  private enabled = false;
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
    this.config.onStatus('Autosave Enabled');
    this.intervalTimer = window.setInterval(() => void this.trySave(), INTERVAL_MS);
  }

  markDirty() {
    if (!this.enabled) return;
    this.revision += 1;
    this.config.onStatus('Saving pending');
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => void this.trySave(), DEBOUNCE_MS);
  }

  hasUnsavedChanges() {
    return this.enabled && this.revision !== this.savedRevision;
  }

  /** Save right away. Resolves to false if the save failed (the status line has the reason). */
  saveNow(): Promise<boolean> {
    return this.trySave(true);
  }

  /**
   * Move the document to a new name in the active provider. Resolves to false on failure.
   * onRenamed runs inside the save queue, so any save queued after the rename sees the new name.
   */
  renameDocument(oldFileName: string, newFileName: string, onRenamed?: () => void): Promise<boolean> {
    return this.enqueue(async () => {
      const provider = this.config.provider();
      const revisionAtStart = this.revision;
      this.config.onStatus('Renaming...');
      try {
        if (provider.saveAs) {
          await provider.saveAs(this.config.getContent(), oldFileName, newFileName);
        } else {
          await provider.save(this.config.getContent(), newFileName);
        }
        onRenamed?.();
        this.savedRevision = revisionAtStart;
        this.config.onStatus(this.savedMessage(provider));
        return true;
      } catch (error) {
        console.error('Rename failed', error);
        this.config.onStatus(`Rename failed: ${describeError(error)}`);
        return false;
      }
    });
  }

  private trySave(force = false): Promise<boolean> {
    return this.enqueue(() => this.saveIfNeeded(force));
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async saveIfNeeded(force: boolean): Promise<boolean> {
    if (!this.enabled && !force) return true;
    // Check again here since a queued save may already have written these edits.
    if (!force && this.revision === this.savedRevision) return true;

    const provider = this.config.provider();
    const revisionAtStart = this.revision;
    this.config.onStatus('Saving');
    try {
      await this.withBackoff(() => provider.save(this.config.getContent(), this.config.getFileName()));
      this.savedRevision = Math.max(this.savedRevision, revisionAtStart);
      this.config.onStatus(this.revision === revisionAtStart ? this.savedMessage(provider) : 'Saving pending');
      return true;
    } catch (error) {
      console.error('Save failed', error);
      this.config.onStatus(`Save Error: ${describeError(error)}`);
      return false;
    }
  }

  private savedMessage(provider: StorageProvider) {
    return provider.label ? `Saved to ${provider.label}` : 'Saved';
  }

  private async withBackoff(action: () => Promise<void>) {
    let lastError: unknown;
    for (const wait of RETRY_WAITS_MS) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try {
        await action();
        return;
      } catch (error) {
        lastError = error;
        // No point retrying an expired login or a full disk.
        if (!isRetryable(error)) break;
      }
    }
    throw lastError;
  }
}
