import { MemoryProvider } from '../../test/memoryProvider';
import { createProviderRegistry, describeCapabilities, googleDriveEntry, localStorageEntry, statusLabels, type DriveAccountSource } from './registry';

class FakeDrive extends MemoryProvider implements DriveAccountSource {
  token: 'live' | 'expired' | 'none' = 'none';
  account: string | null = null;
  hasUsableToken() {
    return this.token === 'live';
  }
  isSignedIn() {
    return this.token !== 'none';
  }
  accountLabel() {
    return this.isSignedIn() ? this.account : null;
  }
}

describe('provider registry', () => {
  it('lists every provider in order and finds them by id or instance', () => {
    const local = new MemoryProvider();
    const drive = new FakeDrive();
    const registry = createProviderRegistry([localStorageEntry(local), googleDriveEntry(drive, 'client')]);
    expect(registry.list().map((entry) => entry.id)).toEqual(['local', 'googleDrive']);
    expect(registry.get('googleDrive').provider).toBe(drive);
    expect(registry.forProvider(local)?.id).toBe('local');
    expect(registry.forProvider(new MemoryProvider())).toBeUndefined();
  });

  it('refuses unknown ids and duplicates', () => {
    const local = localStorageEntry(new MemoryProvider());
    expect(() => createProviderRegistry([local, local])).toThrow(/share an id/);
    expect(() => createProviderRegistry([local]).get('googleDrive')).toThrow(/Unknown/);
  });

  it('declares what browser storage can do, and that it needs no account', () => {
    const entry = localStorageEntry(new MemoryProvider());
    expect(entry).toMatchObject({ name: 'This browser', icon: 'monitor', needsSignIn: false });
    expect(entry.capabilities).toEqual({ binaryFiles: true, folders: true, history: false, maxFileBytes: null });
    expect(entry.configured()).toBe(true);
    expect(entry.status()).toBe('connected');
    expect(entry.account()).toBeNull();
  });

  it('reads Drive status from the token: not configured, signed out, connected, expired', () => {
    const drive = new FakeDrive();
    expect(googleDriveEntry(drive, undefined).configured()).toBe(false);
    expect(googleDriveEntry(drive, '').status()).toBe('notConfigured');
    const entry = googleDriveEntry(drive, 'client');
    expect(entry).toMatchObject({ name: 'Google Drive', icon: 'hard-drive', needsSignIn: true });
    expect(entry.capabilities.history).toBe(true);
    expect(entry.status()).toBe('signedOut');
    drive.token = 'live';
    drive.account = 'ada@example.com';
    expect(entry.status()).toBe('connected');
    expect(entry.account()).toBe('ada@example.com');
    drive.token = 'expired';
    expect(entry.status()).toBe('expired');
    expect(entry.account()).toBe('ada@example.com');
    drive.token = 'none';
    expect(entry.account()).toBeNull();
  });

  it('labels statuses and capabilities for people', () => {
    expect(statusLabels).toEqual({ connected: 'Connected', expired: 'Expired', signedOut: 'Not connected', notConfigured: 'Not configured' });
    expect(describeCapabilities({ binaryFiles: true, folders: true, history: true, maxFileBytes: null })).toBe('Folders, images and other files, version history');
    expect(describeCapabilities({ binaryFiles: false, folders: false, history: true, maxFileBytes: 1 })).toBe('Version history');
    expect(describeCapabilities({ binaryFiles: false, folders: false, history: false, maxFileBytes: null })).toBe('Text files only');
  });
});
