import { GoogleDriveProvider } from './googleDrive';

describe('GoogleDriveProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('connects and exposes access token', async () => {
    const callbackRef: { cb?: (resp: { access_token: string }) => void } = {};
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('window', window);
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: vi.fn(({ callback }) => {
            callbackRef.cb = callback;
            return {
              requestAccessToken: vi.fn(() => callbackRef.cb?.({ access_token: 'token-123' })),
            };
          }),
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
