import { GoogleDriveProvider } from './googleDrive';

describe('GoogleDriveProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('connects and exposes access token', async () => {
    const callbackRef: { cb?: (resp: { access_token?: string; error?: string; expires_in?: number }) => void } = {};
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('window', window);
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: vi.fn(() => ({
            set callback(fn: typeof callbackRef.cb) {
              callbackRef.cb = fn;
            },
            requestAccessToken: vi.fn(() => callbackRef.cb?.({ access_token: 'token-123', expires_in: 3600 })),
          })),
        },
      },
    };
    vi.spyOn(document, 'querySelector').mockReturnValue({} as Element);
    (import.meta as any).env = { ...(import.meta as any).env, VITE_GOOGLE_CLIENT_ID: 'client-id' };

    const provider = new GoogleDriveProvider();
    const ok = await provider.connect();

    expect(ok).toBe(true);
    expect(provider.getAccessToken()).toBe('token-123');
    expect(provider.status()).toBe('Drive: Connected');
    expect(localStorage.getItem('drive_access_token')).toContain('token-123');
  });

  it('reuses cached access token without prompting oauth again', async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    localStorage.setItem('drive_access_token', JSON.stringify({ accessToken: 'cached-token', expiresAt }));

    vi.stubGlobal('window', window);
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: vi.fn(),
        },
      },
    };

    const provider = new GoogleDriveProvider();
    const ok = await provider.connect();

    expect(ok).toBe(true);
    expect(provider.getAccessToken()).toBe('cached-token');
    expect(window.google.accounts.oauth2.initTokenClient).not.toHaveBeenCalled();
  });

  it('opens document and persists selected file', async () => {
    const provider = new GoogleDriveProvider();
    (provider as any).accessToken = 'token';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'f1', name: 'doc.tex' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => 'content',
        }),
    );

    const opened = await provider.openDocument('f1');

    expect(opened).toEqual({ name: 'doc.tex', content: 'content' });
    expect(provider.getCurrentFileRef()).toEqual({ id: 'f1', name: 'doc.tex' });
    expect(localStorage.getItem('drive_active_file_ref')).toContain('doc.tex');
  });

  it('renames and moves current file', async () => {
    const provider = new GoogleDriveProvider();
    (provider as any).accessToken = 'token';
    (provider as any).fileRef = { id: 'f1', name: 'old.tex' };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ parents: ['p1'] }) })
        .mockResolvedValueOnce({ ok: true }),
    );

    await provider.renameFile('f1', 'new.tex');
    await provider.moveFile('f1', 'folder2');

    expect(provider.getCurrentFileRef()).toEqual({ id: 'f1', name: 'new.tex' });
  });
});
