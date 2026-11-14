import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readStoredToken, removeOldToken, TOKEN_EXPIRY_SLACK_MS, TOKEN_STORAGE_KEY } from './driveShared';

describe('driveShared', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('reads a live token and drops one about to expire', () => {
    const now = 1_000_000;
    sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ accessToken: 't', expiresAt: now + TOKEN_EXPIRY_SLACK_MS + 1 }));
    expect(readStoredToken(now)).toEqual({ accessToken: 't', expiresAt: now + TOKEN_EXPIRY_SLACK_MS + 1 });
    sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ accessToken: 't', expiresAt: now + TOKEN_EXPIRY_SLACK_MS }));
    expect(readStoredToken(now)).toBeNull();
    expect(sessionStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('ignores a missing, partial or corrupt token', () => {
    expect(readStoredToken()).toBeNull();
    sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ accessToken: 't' }));
    expect(readStoredToken()).toBeNull();
    sessionStorage.setItem(TOKEN_STORAGE_KEY, '{bad');
    expect(readStoredToken()).toBeNull();
  });

  it('keeps going when storage is locked down', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => removeOldToken()).not.toThrow();
    spy.mockRestore();
  });
});
