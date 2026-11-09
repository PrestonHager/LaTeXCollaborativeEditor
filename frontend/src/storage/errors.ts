/**
 * Error raised by storage code with a message that is safe to show in the UI.
 * Set `retryable` to false when trying again won't help (bad auth, full storage).
 */
export class StorageError extends Error {
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, options: { retryable?: boolean; status?: number; cause?: unknown } = {}) {
    super(message);
    this.name = 'StorageError';
    this.retryable = options.retryable ?? true;
    this.status = options.status;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** Check if an error came from the browser running out of localStorage space. */
export function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error) && !(typeof DOMException !== 'undefined' && error instanceof DOMException)) {
    return false;
  }
  const name = (error as { name?: string }).name ?? '';
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

/** Turn any thrown value into a short, readable sentence for the status bar. */
export function describeError(error: unknown): string {
  if (error instanceof StorageError) return error.message;
  if (isQuotaError(error)) {
    return 'Browser storage is full. Download a copy, then clear old local docs.';
  }
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return 'Network request failed. Check your connection and try again.';
  }
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Something went wrong. Check the browser console for details.';
}

/** Check if an error is worth retrying. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof StorageError) return error.retryable;
  return !isQuotaError(error);
}
