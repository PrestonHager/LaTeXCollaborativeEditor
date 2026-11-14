import {
  ACCOUNTS_STORAGE_KEY,
  forgetAccount,
  keepsSignedIn,
  rememberAccount,
  rememberedAccount,
  setKeepSignedInChoice,
  wasConnected,
} from './accountMemory';

describe('accountMemory', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('remembers nothing until a provider connects', () => {
    expect(rememberedAccount('googleDrive')).toBeNull();
    expect(wasConnected('googleDrive')).toBe(false);
    expect(keepsSignedIn('googleDrive')).toBe(false);
  });

  it('remembers that a provider connected and as whom, but never a token', () => {
    rememberAccount('googleDrive', null);
    expect(rememberedAccount('googleDrive')).toEqual({ connected: true, account: null, keepSignedIn: false });
    rememberAccount('googleDrive', 'ada@example.com');
    // A later call without the account keeps the one we know.
    rememberAccount('googleDrive', null);
    expect(rememberedAccount('googleDrive')?.account).toBe('ada@example.com');
    expect(wasConnected('googleDrive')).toBe(true);
    expect(JSON.parse(localStorage.getItem(ACCOUNTS_STORAGE_KEY)!)).toEqual({
      googleDrive: { connected: true, account: 'ada@example.com', keepSignedIn: false },
    });
  });

  it('keeps the "Keep me signed in" choice across sign-ins, even before connecting', () => {
    setKeepSignedInChoice('googleDrive', true);
    expect(keepsSignedIn('googleDrive')).toBe(true);
    // Choosing it isn't the same as being connected.
    expect(wasConnected('googleDrive')).toBe(false);
    rememberAccount('googleDrive', 'ada@example.com');
    expect(rememberedAccount('googleDrive')).toEqual({ connected: true, account: 'ada@example.com', keepSignedIn: true });
    setKeepSignedInChoice('googleDrive', false);
    expect(rememberedAccount('googleDrive')).toEqual({ connected: true, account: 'ada@example.com', keepSignedIn: false });
  });

  it('forgets everything about a provider on log out, and removes the key when nothing is left', () => {
    rememberAccount('googleDrive', 'ada@example.com');
    setKeepSignedInChoice('googleDrive', true);
    forgetAccount('googleDrive');
    expect(rememberedAccount('googleDrive')).toBeNull();
    expect(localStorage.getItem(ACCOUNTS_STORAGE_KEY)).toBeNull();
  });

  it('ignores junk in storage', () => {
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, 'not json');
    expect(rememberedAccount('googleDrive')).toBeNull();
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, '[1]');
    expect(rememberedAccount('googleDrive')).toBeNull();
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify({ googleDrive: 'yes' }));
    expect(rememberedAccount('googleDrive')).toBeNull();
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify({ googleDrive: { connected: 'yes', account: 'x'.repeat(400), keepSignedIn: 1 } }));
    expect(rememberedAccount('googleDrive')).toEqual({ connected: false, account: null, keepSignedIn: false });
  });

  it('carries on when storage is locked down', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => rememberAccount('googleDrive', 'ada@example.com')).not.toThrow();
    expect(rememberedAccount('googleDrive')).toBeNull();
  });
});
