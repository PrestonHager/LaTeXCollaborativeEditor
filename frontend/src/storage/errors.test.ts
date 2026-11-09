import { StorageError, describeError, isQuotaError, isRetryable } from './errors';

describe('storage errors', () => {
  it('uses the StorageError message as is', () => {
    expect(describeError(new StorageError('Drive: Session expired.'))).toBe('Drive: Session expired.');
  });

  it('explains quota errors', () => {
    const quota = new DOMException('full', 'QuotaExceededError');
    expect(isQuotaError(quota)).toBe(true);
    expect(describeError(quota)).toMatch(/storage is full/);
    expect(isRetryable(quota)).toBe(false);
  });

  it('explains network errors from fetch', () => {
    expect(describeError(new TypeError('Failed to fetch'))).toMatch(/Network request failed/);
  });

  it('falls back for strings and unknown values', () => {
    expect(describeError('plain')).toBe('plain');
    expect(describeError(undefined)).toMatch(/Something went wrong/);
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(isQuotaError('nope')).toBe(false);
  });

  it('respects the retryable flag', () => {
    expect(isRetryable(new StorageError('x', { retryable: false }))).toBe(false);
    expect(isRetryable(new StorageError('x'))).toBe(true);
    expect(isRetryable(new Error('x'))).toBe(true);
  });
});
