import type { StorageProvider } from './providers/types';

type AutosaveConfig = {
  provider: () => StorageProvider;
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
    await this.trySave(true);
  }

  async renameDocument(oldFileName: string, newFileName: string) {
    const provider = this.config.provider();
    if (provider.saveAs) {
      await provider.saveAs(this.config.getContent(), oldFileName, newFileName);
    } else {
      await provider.save(this.config.getContent(), newFileName);
    }
    this.config.onStatus('Saved');
  }

  private async trySave(force = false) {
    if ((!this.enabled && !force) || (!this.dirty && !force)) return;
    this.config.onStatus('Saving');
    try {
      await this.withBackoff(() => this.config.provider().save(this.config.getContent(), this.config.getFileName()));
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
