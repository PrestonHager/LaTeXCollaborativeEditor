import type { StorageProvider } from './providers/googleDrive';

type AutosaveConfig = {
  provider: StorageProvider;
  getContent: () => string;
  getFileName: () => string;
  onStatus: (status: string) => void;
};

export class AutosaveController {
  private enabled = false;
  private dirty = false;
  private debounceTimer: number | undefined;
  private intervalTimer: number | undefined;
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
    this.intervalTimer = window.setInterval(() => void this.trySave(), 60000);
  }

  markDirty() {
    if (!this.enabled) return;
    this.dirty = true;
    this.config.onStatus('Saving pending');
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => void this.trySave(), 4000);
  }

  async saveNow() {
    if (!this.enabled) {
      this.config.onStatus('Autosave Off');
      return;
    }
    await this.trySave(true);
  }

  private async trySave(force = false) {
    if (!this.enabled || (!this.dirty && !force)) return;
    this.config.onStatus('Saving');
    try {
      await this.withBackoff(() => this.config.provider.save(this.config.getContent(), this.config.getFileName()));
      this.dirty = false;
      this.config.onStatus('Saved');
    } catch {
      this.config.onStatus('Save Error');
    }
  }

  private async withBackoff(action: () => Promise<void>) {
    const waits = [0, 500, 1000, 2000];
    let lastError: unknown;
    for (const wait of waits) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try {
        await action();
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}
