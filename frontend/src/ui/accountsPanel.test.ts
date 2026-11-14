import { mountAppShell } from '../test/appShell';
import { MemoryProvider } from '../test/memoryProvider';
import { createProviderRegistry, googleDriveEntry, localStorageEntry, type DriveAccountSource } from '../storage/providers/registry';
import { accountLine, createAccountsPanel } from './accountsPanel';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

class FakeDrive extends MemoryProvider implements DriveAccountSource {
  token: 'live' | 'expired' | 'none' = 'live';
  account: string | null = 'ada@example.com';
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

function setup(clientId: string | undefined = 'client') {
  mountAppShell();
  const drive = new FakeDrive();
  const registry = createProviderRegistry([localStorageEntry(new MemoryProvider()), googleDriveEntry(drive, clientId)]);
  const dialog = document.getElementById('accounts-dialog') as HTMLDialogElement;
  const runCommand = vi.fn(async (commandId: string) => {
    if (commandId === 'file.connectDrive') drive.token = 'live';
    if (commandId === 'file.disconnectDrive') drive.token = 'none';
  });
  const options = { registry, runCommand };
  const panel = createAccountsPanel(dialog, options);
  const rowFor = (id: string) => dialog.querySelector<HTMLElement>(`[data-provider="${id}"]`)!;
  const buttons = (id: string) => Array.from(rowFor(id).querySelectorAll('button')).map((button) => button.textContent);
  const press = (id: string, label: string) => Array.from(rowFor(id).querySelectorAll('button')).find((button) => button.textContent === label)!.click();
  const logOutAll = document.getElementById('accounts-logout-all') as HTMLButtonElement;
  return { panel, dialog, drive, options, rowFor, buttons, press, logOutAll };
}

describe('accounts panel', () => {
  it('lists every provider with its status, account and capabilities', () => {
    const { panel, dialog, rowFor, buttons } = setup();
    panel.open();
    expect(dialog.open).toBe(true);
    expect(panel.isOpen()).toBe(true);
    expect(dialog.querySelectorAll('.accounts-row')).toHaveLength(2);
    expect(rowFor('local').textContent).toContain('This browser');
    expect(rowFor('local').textContent).toContain('Connected');
    expect(rowFor('local').textContent).toContain('Nothing is uploaded');
    // Browser storage has no account to connect or log out of.
    expect(buttons('local')).toEqual([]);
    expect(rowFor('googleDrive').dataset.status).toBe('connected');
    expect(rowFor('googleDrive').textContent).toContain('Signed in as ada@example.com');
    expect(rowFor('googleDrive').textContent).toContain('version history');
    expect(buttons('googleDrive')).toEqual(['Log out']);
    expect(rowFor('googleDrive').querySelector('svg')).not.toBeNull();
  });

  it('logs out, then offers Connect, and redraws after each', async () => {
    const { panel, options, rowFor, buttons, press, logOutAll } = setup();
    panel.open();
    expect(logOutAll.disabled).toBe(false);
    press('googleDrive', 'Log out');
    // Everything waits while the action runs.
    expect(Array.from(rowFor('googleDrive').querySelectorAll('button')).every((button) => button.disabled)).toBe(true);
    expect(logOutAll.disabled).toBe(true);
    await vi.waitFor(() => expect(buttons('googleDrive')).toEqual(['Connect']));
    expect(options.runCommand).toHaveBeenCalledWith('file.disconnectDrive');
    expect(rowFor('googleDrive').textContent).toContain('Not connected');
    expect(logOutAll.disabled).toBe(true);
    press('googleDrive', 'Connect');
    await vi.waitFor(() => expect(buttons('googleDrive')).toEqual(['Log out']));
    expect(options.runCommand).toHaveBeenCalledWith('file.connectDrive');
  });

  it('shows an expired sign-in with both Connect and Log out', () => {
    const { panel, drive, rowFor, buttons } = setup();
    drive.token = 'expired';
    panel.open();
    expect(rowFor('googleDrive').textContent).toContain('Expired');
    expect(rowFor('googleDrive').textContent).toContain('sign-in ran out');
    expect(buttons('googleDrive')).toEqual(['Connect', 'Log out']);
  });

  it("can't connect a provider this site hasn't set up", () => {
    const { panel, drive, rowFor, logOutAll } = setup('');
    drive.token = 'none';
    panel.open();
    expect(rowFor('googleDrive').textContent).toContain('Not configured');
    const connect = rowFor('googleDrive').querySelector('button')!;
    expect(connect.textContent).toBe('Connect');
    expect(connect.disabled).toBe(true);
    expect(logOutAll.disabled).toBe(true);
  });

  it('logs out of everything, refreshes only while open, and closes', async () => {
    const { panel, dialog, drive, options, buttons, logOutAll } = setup();
    panel.refresh();
    expect(dialog.querySelectorAll('.accounts-row')).toHaveLength(0);
    panel.open();
    logOutAll.click();
    // A second click while the first runs is ignored.
    logOutAll.click();
    await vi.waitFor(() => expect(buttons('googleDrive')).toEqual(['Connect']));
    expect(options.runCommand).toHaveBeenCalledTimes(1);
    expect(options.runCommand).toHaveBeenCalledWith('file.disconnectDrive');
    drive.token = 'live';
    panel.refresh();
    expect(buttons('googleDrive')).toEqual(['Log out']);
    (document.getElementById('accounts-done') as HTMLButtonElement).click();
    expect(dialog.open).toBe(false);
    panel.open();
    (document.getElementById('accounts-close') as HTMLButtonElement).click();
    expect(dialog.open).toBe(false);
    panel.open();
    dialog.dispatchEvent(new Event('click'));
    expect(dialog.open).toBe(false);
  });

  it('fills the empty dialog from index.html and points About saving at the docs', () => {
    mountAppShell();
    const dialog = document.getElementById('accounts-dialog') as HTMLDialogElement;
    expect(dialog.childElementCount).toBe(0);
    createAccountsPanel(dialog, {
      registry: createProviderRegistry([localStorageEntry(new MemoryProvider())]),
      docsBase: 'https://docs.example/',
      runCommand: vi.fn(),
    });
    expect(dialog.querySelector('#accounts-dialog-title')?.textContent).toBe('Accounts');
    expect(dialog.querySelector<HTMLAnchorElement>('a[data-help="saving"]')!.href).toBe('https://docs.example/saving-and-storage/');
    expect(dialog.querySelector('#accounts-close svg')).not.toBeNull();
  });

  it("turns off a button whose provider names no command", () => {
    mountAppShell();
    const dialog = document.getElementById('accounts-dialog') as HTMLDialogElement;
    const drive = new FakeDrive();
    drive.token = 'none';
    const entry = { ...googleDriveEntry(drive, 'client'), connectCommand: undefined };
    const runCommand = vi.fn();
    createAccountsPanel(dialog, { registry: createProviderRegistry([entry]), runCommand }).open();
    const connect = dialog.querySelector<HTMLButtonElement>('[data-provider="googleDrive"] button')!;
    expect(connect.disabled).toBe(true);
    connect.click();
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('says what an account line means for each status', () => {
    const drive = new FakeDrive();
    const entry = googleDriveEntry(drive, 'client');
    drive.account = null;
    expect(accountLine(entry)).toBe('Signed in');
    drive.token = 'expired';
    expect(accountLine(entry)).toMatch(/^The sign-in ran out/);
    drive.token = 'none';
    expect(accountLine(entry)).toMatch(/^A folder in your Google Drive/);
  });
});
