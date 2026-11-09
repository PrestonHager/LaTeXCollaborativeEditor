import { GoogleDriveProvider, LEGACY_PREFIX } from './googleDrive';
import { StorageError } from '../errors';
import * as Y from 'yjs';
import { saveProject, type SavedManifest } from '../projectSaver';
import { ProjectDoc } from '../../project/projectDoc';
import type { BlobStore } from '../../project/blobStore';

const loadScript = vi.fn(async () => undefined);
vi.mock('./scriptLoader', () => ({ loadScript: (...args: unknown[]) => loadScript(...(args as [])) }));

type TokenClientConfig = {
  callback: (resp: { access_token?: string; error?: string; expires_in?: number }) => void;
  error_callback: (err: { type?: string; message?: string }) => void;
};

/** Fake GIS so requestAccessToken calls back with whatever the test wants. */
function stubGis(respond: (config: TokenClientConfig) => void) {
  const requestAccessToken = vi.fn();
  const initTokenClient = vi.fn((config: TokenClientConfig) => {
    requestAccessToken.mockImplementation(() => respond(config));
    return { requestAccessToken };
  });
  window.google = { accounts: { oauth2: { initTokenClient } } };
  return { initTokenClient, requestAccessToken };
}

/** A files.list answer with nothing in it. */
const okList = (files: unknown[] = []) => ({ ok: true, json: async () => ({ files }) });

/** Make a provider that already has a live token. */
function connectedProvider() {
  const provider = new GoogleDriveProvider();
  (provider as any).accessToken = 'token';
  (provider as any).tokenExpiresAt = Date.now() + 60 * 60 * 1000;
  return provider;
}

describe('GoogleDriveProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    loadScript.mockReset();
    loadScript.mockResolvedValue(undefined);
    window.google = undefined;
  });

  it('connects and exposes access token', async () => {
    const gis = stubGis((config) => config.callback({ access_token: 'token-123', expires_in: 3600 }));
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id');

    const provider = new GoogleDriveProvider();
    const ok = await provider.connect();

    expect(ok).toBe(true);
    expect(provider.getAccessToken()).toBe('token-123');
    expect(provider.hasUsableToken()).toBe(true);
    expect(provider.status()).toBe('Drive: Connected');
    expect(localStorage.getItem('drive_access_token')).toContain('token-123');
    // Only one popup, a second one would be blocked by the browser.
    expect(gis.requestAccessToken).toHaveBeenCalledTimes(1);
  });

  it('reports a blocked popup instead of hanging', async () => {
    stubGis((config) => config.error_callback({ type: 'popup_failed_to_open' }));
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id');

    const provider = new GoogleDriveProvider();
    const ok = await provider.connect();

    expect(ok).toBe(false);
    expect(provider.status()).toContain('popup was blocked');
  });

  it('reports a closed popup as canceled', async () => {
    stubGis((config) => config.error_callback({ type: 'popup_closed' }));
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id');
    const provider = new GoogleDriveProvider();
    expect(await provider.connect()).toBe(false);
    expect(provider.status()).toBe('Drive: Sign-in was canceled.');
  });

  it('reports a denied token response', async () => {
    stubGis((config) => config.callback({ error: 'access_denied' }));
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id');
    const provider = new GoogleDriveProvider();
    expect(await provider.connect()).toBe(false);
    expect(provider.status()).toContain('Access was denied');
  });

  it('reuses cached access token without prompting oauth again', async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    localStorage.setItem('drive_access_token', JSON.stringify({ accessToken: 'cached-token', expiresAt }));
    const gis = stubGis(() => undefined);

    const provider = new GoogleDriveProvider();
    const ok = await provider.connect();

    expect(ok).toBe(true);
    expect(provider.getAccessToken()).toBe('cached-token');
    expect(gis.initTokenClient).not.toHaveBeenCalled();
  });

  it('treats a token that expired mid-session as unusable', () => {
    const provider = connectedProvider();
    expect(provider.hasUsableToken()).toBe(true);
    (provider as any).tokenExpiresAt = Date.now() + 30_000;
    expect(provider.hasUsableToken()).toBe(false);
  });

  describe('when the token expires mid-session', () => {
    /** Make a provider whose token just expired, with a file already linked. */
    function expiredProvider() {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id');
      const provider = connectedProvider();
      (provider as any).tokenExpiresAt = Date.now() - 1000;
      return provider;
    }

    const authHeader = (call: unknown[]) => (call[1] as RequestInit & { headers: Record<string, string> }).headers.Authorization;

    it('silently gets a new token and keeps saving to Drive', async () => {
      const provider = expiredProvider();
      const gis = stubGis((config) => config.callback({ access_token: 'fresh-token', expires_in: 3600 }));
      const fetchMock = vi.fn().mockResolvedValue(okList());
      vi.stubGlobal('fetch', fetchMock);
      const lost = vi.fn();
      provider.onSessionLost(lost);

      await provider.listProjects();

      expect(gis.requestAccessToken).toHaveBeenCalledWith({ prompt: '' });
      expect(authHeader(fetchMock.mock.calls[0])).toBe('Bearer fresh-token');
      expect(provider.hasUsableToken()).toBe(true);
      expect(lost).not.toHaveBeenCalled();
    });

    it('shares one refresh between saves that run at the same time', async () => {
      const provider = expiredProvider();
      const gis = stubGis((config) => config.callback({ access_token: 'fresh-token', expires_in: 3600 }));
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okList()));

      await Promise.all([provider.listProjects(), provider.listProjects()]);

      expect(gis.requestAccessToken).toHaveBeenCalledTimes(1);
    });

    it('retries once with a new token when Drive returns 401', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id');
      const provider = connectedProvider();
      stubGis((config) => config.callback({ access_token: 'fresh-token', expires_in: 3600 }));
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
        .mockResolvedValueOnce(okList());
      vi.stubGlobal('fetch', fetchMock);

      await provider.listProjects();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(authHeader(fetchMock.mock.calls[1])).toBe('Bearer fresh-token');
    });

    it('gives up after a second 401 and ends the session', async () => {
      vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id');
      const provider = connectedProvider();
      stubGis((config) => config.callback({ access_token: 'fresh-token', expires_in: 3600 }));
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
      const lost = vi.fn();
      provider.onSessionLost(lost);

      await expect(provider.listProjects()).rejects.toMatchObject({ retryable: false, status: 401 });
      expect(lost).toHaveBeenCalledTimes(1);
      expect(provider.isSignedIn()).toBe(false);
    });

    it('ends the session and reports it when the silent refresh fails', async () => {
      const provider = expiredProvider();
      stubGis((config) => config.error_callback({ type: 'popup_failed_to_open' }));
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const lost = vi.fn();
      provider.onSessionLost(lost);

      await expect(provider.listProjects()).rejects.toMatchObject({
        message: expect.stringMatching(/Session expired/),
        retryable: false,
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(lost).toHaveBeenCalledTimes(1);
      expect(provider.isSignedIn()).toBe(false);
      expect(provider.status()).toBe('Drive: Session expired');
      expect(localStorage.getItem('drive_access_token')).toBeNull();
      // After that we're signed out, so later saves fail fast without asking GIS again.
      await expect(provider.listProjects()).rejects.toThrow(/Not connected/);
      expect(lost).toHaveBeenCalledTimes(1);
    });

    it('gives up on a refresh that never answers', async () => {
      vi.useFakeTimers();
      try {
        const provider = expiredProvider();
        stubGis(() => undefined);
        vi.stubGlobal('fetch', vi.fn());
        const lost = vi.fn();
        provider.onSessionLost(lost);

        const failure = expect(provider.listProjects()).rejects.toThrow(/Session expired/);
        await vi.advanceTimersByTimeAsync(20_000);
        await failure;
        expect(lost).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('ends the session when the sign-in script fails to load', async () => {
      const provider = expiredProvider();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      loadScript.mockRejectedValueOnce(new Error('blocked'));
      vi.stubGlobal('fetch', vi.fn());
      await expect(provider.listProjects()).rejects.toThrow(/Session expired/);
      expect(provider.isSignedIn()).toBe(false);
    });
  });

  it('clears the token and asks to reconnect on 401', async () => {
    const provider = connectedProvider();
    localStorage.setItem('drive_access_token', JSON.stringify({ accessToken: 'token', expiresAt: Date.now() + 3600_000 }));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid Credentials' } }) }),
    );

    const failure = provider.listProjects();
    await expect(failure).rejects.toBeInstanceOf(StorageError);
    await expect(failure).rejects.toMatchObject({ retryable: false, status: 401 });
    expect(provider.hasUsableToken()).toBe(false);
    expect(localStorage.getItem('drive_access_token')).toBeNull();
  });

  it('includes the Google error message for server errors', async () => {
    const provider = connectedProvider();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: { message: 'Backend Error' } }) }),
    );
    await expect(provider.listProjects()).rejects.toMatchObject({
      message: 'Drive: Could not list projects (HTTP 500: Backend Error).',
      retryable: true,
    });
  });

  describe('sorts errors by Google\'s reason', () => {
    const failWith = (status: number, error: Record<string, unknown>) =>
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status, json: async () => ({ error }) }));

    it('does not retry a full Drive and says so plainly', async () => {
      // The message mentions "quota", which the old check took for a rate limit.
      failWith(403, { message: 'The user\'s Drive storage quota has been exceeded.', errors: [{ reason: 'storageQuotaExceeded' }] });
      const failure = connectedProvider().listProjects();
      await expect(failure).rejects.toMatchObject({ retryable: false, status: 403 });
      await expect(failure).rejects.toThrow(/Google Drive is full/);
    });

    it.each(['rateLimitExceeded', 'userRateLimitExceeded'])('retries %s', async (reason) => {
      failWith(403, { message: 'Slow down', errors: [{ reason }] });
      const failure = connectedProvider().listProjects();
      await expect(failure).rejects.toMatchObject({ retryable: true, status: 403 });
      await expect(failure).rejects.toThrow(/limiting requests/);
    });

    it('reads the reason from error.details too', async () => {
      failWith(403, { message: 'Too many', details: [{ reason: 'userRateLimitExceeded' }] });
      await expect(connectedProvider().listProjects()).rejects.toMatchObject({ retryable: true, status: 403 });
    });

    it('retries a backend error', async () => {
      failWith(503, { message: 'Backend Error', errors: [{ reason: 'backendError' }] });
      await expect(connectedProvider().listProjects()).rejects.toMatchObject({
        message: 'Drive: Could not list projects (HTTP 503: Backend Error).',
        retryable: true,
      });
    });

    it('does not retry other 403s, even when the message mentions rate or quota', async () => {
      failWith(403, { message: 'Daily quota and rate exceeded', errors: [{ reason: 'dailyLimitExceeded' }] });
      await expect(connectedProvider().listProjects()).rejects.toMatchObject({ retryable: false, status: 403 });
      failWith(403, { message: 'Insufficient permissions', errors: [{ reason: 'insufficientFilePermissions' }] });
      await expect(connectedProvider().listProjects()).rejects.toThrow(/Permission denied.*Insufficient permissions/);
    });

    it('does not retry a 400', async () => {
      failWith(400, { message: 'Bad Request', errors: [{ reason: 'badRequest' }] });
      await expect(connectedProvider().listProjects()).rejects.toMatchObject({ retryable: false, status: 400 });
    });

    it('copes with an error body that is not JSON', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new SyntaxError('bad'); } }));
      await expect(connectedProvider().listProjects()).rejects.toMatchObject({ message: 'Drive: Could not list projects (HTTP 502).', retryable: true });
    });
  });

  it('turns network failures into a readable error', async () => {
    const provider = connectedProvider();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')));
    await expect(provider.listProjects()).rejects.toThrow(/Check your connection/);
  });

  it('refuses to save without a token', async () => {
    const provider = new GoogleDriveProvider();
    await expect(provider.listProjects()).rejects.toThrow(/Not connected/);
  });

  describe('projects as Drive folders', () => {
    type FakeFile = { id: string; name: string; mimeType: string; parents: string[]; appProperties?: Record<string, string | null>; content?: Uint8Array; trashed?: boolean };
    const FOLDER = 'application/vnd.google-apps.folder';

    const readBlob = async (blob: Blob): Promise<Uint8Array> => {
      if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
      return new Uint8Array(await new Response(blob as BodyInit).arrayBuffer());
    };

    /** A tiny in-memory Drive that answers the calls the provider makes. */
    function fakeDrive(seed: FakeFile[] = []) {
      const files = new Map(seed.map((file) => [file.id, file]));
      let nextId = 0;
      const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => body });
      const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
        const url = new URL(input);
        const method = init.method ?? 'GET';
        const idMatch = /\/files\/([^/?]+)/.exec(url.pathname);
        const id = idMatch?.[1];
        if (method === 'GET' && !id) {
          const q = url.searchParams.get('q') ?? '';
          const parent = /'([^']+)' in parents/.exec(q)?.[1];
          const list = [...files.values()].filter((file) => {
            if (file.trashed) return false;
            if (parent) return file.parents.includes(parent);
            return file.mimeType === FOLDER && file.appProperties?.latexProject === '1';
          });
          return reply({ files: list.map(({ id: fid, name, mimeType }) => ({ id: fid, name, mimeType, modifiedTime: '2026-01-01T00:00:00Z' })) });
        }
        if (method === 'GET' && id) {
          const file = files.get(id);
          if (!file) return { ok: false, status: 404, json: async () => ({}) };
          if (url.searchParams.get('alt') === 'media') return { ok: true, status: 200, arrayBuffer: async () => file.content!.buffer };
          return reply(file);
        }
        if (method === 'POST' && url.pathname.includes('/upload/')) {
          const form = init.body as FormData;
          const metadata = JSON.parse(new TextDecoder().decode(await readBlob(form.get('metadata') as Blob)));
          const created: FakeFile = { id: `f${(nextId += 1)}`, name: metadata.name, mimeType: 'text/plain', parents: metadata.parents ?? ['root'], content: await readBlob(form.get('file') as Blob) };
          files.set(created.id, created);
          return reply({ id: created.id });
        }
        if (method === 'POST') {
          const body = JSON.parse(init.body as string);
          const created: FakeFile = { id: `d${(nextId += 1)}`, name: body.name, mimeType: body.mimeType, parents: body.parents ?? ['root'], appProperties: body.appProperties };
          files.set(created.id, created);
          return reply({ id: created.id, name: created.name });
        }
        if (method === 'PATCH' && id) {
          const file = files.get(id)!;
          if (url.pathname.includes('/upload/')) {
            file.content = await readBlob(init.body as Blob);
            return reply({ id });
          }
          const add = url.searchParams.get('addParents');
          const remove = url.searchParams.get('removeParents');
          if (remove) file.parents = file.parents.filter((parent) => !remove.split(',').includes(parent));
          if (add) file.parents.push(add);
          if (init.body) {
            const body = JSON.parse(init.body as string);
            if (body.name) file.name = body.name;
            if (body.trashed) file.trashed = true;
            if (body.appProperties) file.appProperties = { ...file.appProperties, ...body.appProperties };
          }
          return reply({ id });
        }
        throw new Error(`Unexpected Drive call ${method} ${input}`);
      });
      vi.stubGlobal('fetch', fetchMock);
      return { files, fetchMock, find: (name: string) => [...files.values()].find((file) => file.name === name && !file.trashed) };
    }

    const bytes = (text: string) => new TextEncoder().encode(text);
    const text = (data: Uint8Array) => new TextDecoder().decode(data);

    it('makes a tagged folder per project and real files and subfolders inside it', async () => {
      const drive = fakeDrive();
      const provider = connectedProvider();
      const { id } = await provider.createProject('Thesis');
      await provider.writeFile(id, 'main.tex', '\\documentclass{article}');
      await provider.writeFile(id, 'figures/plot.png', new Uint8Array([1, 2]));
      await provider.setMainFile(id, 'main.tex');

      const folder = drive.files.get(id)!;
      expect(folder.mimeType).toBe(FOLDER);
      expect(folder.appProperties).toMatchObject({ latexProject: '1', mainFile: 'main.tex' });
      const figures = drive.find('figures')!;
      expect(figures.parents).toEqual([id]);
      expect(drive.find('plot.png')!.parents).toEqual([figures.id]);

      // Writing again updates the same file instead of making a duplicate.
      await provider.writeFile(id, 'main.tex', 'changed');
      expect([...drive.files.values()].filter((file) => file.name === 'main.tex')).toHaveLength(1);
      expect(text(drive.find('main.tex')!.content!)).toBe('changed');

      expect((await provider.listProjects()).map((project) => project.name)).toEqual(['Thesis']);
    });

    it('opens a folder project, walking subfolders and skipping Google Docs', async () => {
      fakeDrive([
        { id: 'root1', name: 'Paper', mimeType: FOLDER, parents: ['root'], appProperties: { latexProject: '1', mainFile: 'paper.tex' } },
        { id: 'a', name: 'paper.tex', mimeType: 'text/x-tex', parents: ['root1'], content: bytes('hi') },
        { id: 'b', name: 'img', mimeType: FOLDER, parents: ['root1'] },
        { id: 'c', name: 'x.png', mimeType: 'image/png', parents: ['b'], content: new Uint8Array([9]) },
        { id: 'd', name: 'Notes', mimeType: 'application/vnd.google-apps.document', parents: ['root1'] },
      ]);
      const provider = connectedProvider();
      const listing = await provider.openProject('root1');
      expect(listing).toEqual({
        id: 'root1',
        name: 'Paper',
        mainPath: 'paper.tex',
        entries: [
          { path: 'img', kind: 'folder' },
          { path: 'img/x.png', kind: 'file' },
          { path: 'paper.tex', kind: 'file' },
        ],
      });
      expect(Array.from(await provider.readFile('root1', 'img/x.png'))).toEqual([9]);
      await expect(provider.readFile('root1', 'missing.tex')).rejects.toThrow(/was not found/);
    });

    it('moves, renames and trashes files and folders', async () => {
      const drive = fakeDrive();
      const provider = connectedProvider();
      const { id } = await provider.createProject('P');
      await provider.writeFile(id, 'ch/intro.tex', 'a');
      await provider.move(id, 'ch', 'chapters');
      expect(drive.find('chapters')).toBeTruthy();
      // The file moved along with its folder, so it can still be written by its new path.
      await provider.writeFile(id, 'chapters/intro.tex', 'b');
      expect(text(drive.find('intro.tex')!.content!)).toBe('b');

      await provider.move(id, 'chapters/intro.tex', 'intro.tex');
      expect(drive.find('intro.tex')!.parents).toEqual([id]);
      await provider.createFolder(id, 'empty');
      await provider.remove(id, 'chapters');
      expect(drive.find('chapters')).toBeUndefined();
      await provider.renameProject(id, 'Renamed');
      expect(drive.files.get(id)!.name).toBe('Renamed');
      await expect(provider.move(id, 'nope.tex', 'x.tex')).rejects.toThrow(/was not found/);
    });

    it('loads the project index on demand after a reload', async () => {
      const drive = fakeDrive([
        { id: 'p', name: 'P', mimeType: FOLDER, parents: ['root'], appProperties: { latexProject: '1' } },
        { id: 'm', name: 'main.tex', mimeType: 'text/plain', parents: ['p'], content: bytes('old') },
      ]);
      const provider = connectedProvider();
      await provider.writeFile('p', 'main.tex', 'new');
      expect(text(drive.files.get('m')!.content!)).toBe('new');
      await expect(provider.openProject('m')).rejects.toThrow(/not a folder/);
    });

    it('opens an old single file as a one-file project, then gives it a folder when it grows', async () => {
      const drive = fakeDrive([{ id: 'old', name: 'essay.tex', mimeType: 'text/plain', parents: ['mine'], content: bytes('text') }]);
      localStorage.setItem('drive_active_file_ref', JSON.stringify({ id: 'old', name: 'essay.tex' }));
      const provider = connectedProvider();
      const legacyId = provider.legacyProjectId(undefined, 'essay.tex')!;
      expect(legacyId).toBe(`${LEGACY_PREFIX}old`);
      expect(provider.legacyProjectId(undefined, 'other.tex')).toBeNull();

      const listing = await provider.openProject(legacyId);
      expect(listing).toMatchObject({ name: 'essay', mainPath: 'essay.tex', entries: [{ path: 'essay.tex', kind: 'file' }] });
      // Saving the main file keeps writing to the same Drive file, like before projects.
      await provider.writeFile(legacyId, 'essay.tex', 'edited');
      await provider.renameProject(legacyId, 'ignored');
      await provider.setMainFile(legacyId, 'essay.tex');
      expect(text(drive.files.get('old')!.content!)).toBe('edited');
      expect(provider.currentProjectId(legacyId)).toBe(legacyId);

      // A second file needs a real project folder, made next to the old file.
      await provider.writeFile(legacyId, 'refs.bib', '@book{a, title={A}}');
      const folderId = provider.currentProjectId(legacyId);
      expect(folderId).not.toBe(legacyId);
      const folder = drive.files.get(folderId)!;
      expect(folder).toMatchObject({ name: 'essay', parents: ['mine'], appProperties: { latexProject: '1', mainFile: 'essay.tex' } });
      expect(drive.files.get('old')!.parents).toEqual([folderId]);
      expect(drive.find('refs.bib')!.parents).toEqual([folderId]);
      expect(localStorage.getItem('drive_active_file_ref')).toBeNull();
    });

    it('matches an old link by document id when it has one', () => {
      localStorage.setItem('drive_active_file_ref', JSON.stringify({ id: 'f', name: 'a.tex', documentId: 'doc-1' }));
      const provider = connectedProvider();
      expect(provider.legacyProjectId('doc-1', 'renamed.tex')).toBe(`${LEGACY_PREFIX}f`);
      expect(provider.legacyProjectId('doc-2', 'a.tex')).toBeNull();
      localStorage.setItem('drive_active_file_ref', '{bad');
      expect(provider.legacyProjectId('doc-1', 'a.tex')).toBeNull();
    });

    it('moves the project folder into another Drive folder', async () => {
      const drive = fakeDrive([{ id: 'p', name: 'P', mimeType: FOLDER, parents: ['root'], appProperties: { latexProject: '1' } }]);
      const provider = connectedProvider();
      await provider.openProject('p');
      await provider.moveProject('p', 'elsewhere');
      expect(drive.files.get('p')!.parents).toEqual(['elsewhere']);
    });

    describe('when a save with a rename fails partway', () => {
      const quotaError = { ok: false, status: 403, json: async () => ({ error: { message: 'Storage quota exceeded', errors: [{ reason: 'storageQuotaExceeded' }] } }) };
      const rateError = { ok: false, status: 403, json: async () => ({ error: { message: 'Rate limit', errors: [{ reason: 'rateLimitExceeded' }] } }) };
      const isUpload = (input: string) => input.includes('/upload/');
      const isRename = (input: string, init: RequestInit = {}) =>
        init.method === 'PATCH' && !isUpload(input) && typeof init.body === 'string' && 'name' in JSON.parse(init.body);

      /** Make a saved project in the fake Drive, then return a save that keeps its manifest between runs. */
      async function savedProject() {
        const drive = fakeDrive();
        const provider = connectedProvider();
        const project = new ProjectDoc(new Y.Doc());
        project.setName('Thesis');
        const main = project.createTextFile('main.tex', 'v1');
        project.createTextFile('ch/a.tex', 'a');
        const blobs = { get: async () => undefined } as unknown as BlobStore;
        let manifest: SavedManifest | null = null;
        const save = async () => {
          const result = await saveProject({
            provider, project, blobs, manifest, projectId: manifest?.projectId ?? null,
            onStep: (step) => { manifest = step; },
          });
          manifest = result.manifest;
        };
        await save();
        const real = drive.fetchMock.getMockImplementation()!;
        return { drive, project, main, save, real, folder: () => drive.files.get(manifest!.projectId)!, manifest: () => manifest! };
      }

      it('uploads before renaming, so a failed upload leaves the old name and a clear error', async () => {
        const t = await savedProject();
        t.project.setName('Renamed');
        t.project.getText(t.main).insert(2, ' edited');
        t.drive.fetchMock.mockImplementation(async (input, init) => (isUpload(input) ? quotaError : t.real(input, init)) as any);

        await expect(t.save()).rejects.toMatchObject({ retryable: false, message: expect.stringMatching(/Google Drive is full/) });
        // Nothing was renamed, so "the save failed" is the whole story.
        expect(t.folder().name).toBe('Thesis');
        expect(t.drive.fetchMock.mock.calls.some(([input, init]) => isRename(input, init))).toBe(false);
        expect(t.manifest().name).toBe('Thesis');

        // Once Drive has room, the next save writes the file and then renames.
        t.drive.fetchMock.mockImplementation(t.real);
        await t.save();
        expect(t.folder().name).toBe('Renamed');
        expect(text(t.drive.find('main.tex')!.content!)).toBe('v1 edited');
      });

      it('keeps the uploaded file when only the rename fails, and retries just the rename', async () => {
        const t = await savedProject();
        t.project.setName('Renamed');
        t.project.getText(t.main).insert(2, ' edited');
        t.drive.fetchMock.mockImplementation(async (input, init) => (isRename(input, init) ? rateError : t.real(input, init)) as any);

        await expect(t.save()).rejects.toMatchObject({ retryable: true, message: expect.stringMatching(/rename the project folder/) });
        expect(text(t.drive.find('main.tex')!.content!)).toBe('v1 edited');
        expect(t.folder().name).toBe('Thesis');
        expect(t.manifest().name).toBe('Thesis');

        t.drive.fetchMock.mockImplementation(t.real);
        t.drive.fetchMock.mockClear();
        await t.save();
        expect(t.folder().name).toBe('Renamed');
        // Only the rename went out, the file was already saved.
        expect(t.drive.fetchMock.mock.calls.some(([input]) => isUpload(input))).toBe(false);
      });

      it('remembers a file move when the upload after it fails', async () => {
        const t = await savedProject();
        t.project.movePath('ch/a.tex', 'a.tex');
        t.project.getText(t.main).insert(2, ' edited');
        t.drive.fetchMock.mockImplementation(async (input, init) => (isUpload(input) ? quotaError : t.real(input, init)) as any);

        await expect(t.save()).rejects.toThrow(/Google Drive is full/);
        // The move made it to Drive and the manifest knows, so the next save doesn't move it twice.
        expect(t.drive.find('a.tex')!.parents).toEqual([t.folder().id]);
        expect(Object.values(t.manifest().files).map((file) => file.path)).toContain('a.tex');

        t.drive.fetchMock.mockImplementation(t.real);
        t.drive.fetchMock.mockClear();
        await t.save();
        expect(t.drive.fetchMock.mock.calls.filter(([input, init]) => isRename(input, init))).toHaveLength(0);
        expect(text(t.drive.find('main.tex')!.content!)).toBe('v1 edited');
      });
    });

    it('explains a 404 as a missing or inaccessible file', async () => {
      fakeDrive();
      const provider = connectedProvider();
      await expect(provider.openProject('gone')).rejects.toThrow(/not found or this app does not have access/);
    });
  });

  it('connect returns false when client id is missing', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    const provider = new GoogleDriveProvider();
    const ok = await provider.connect();
    expect(ok).toBe(false);
    expect(provider.status()).toBe('Drive config missing');
  });

  it('connect catches script/bootstrap failures', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'id');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    loadScript.mockRejectedValueOnce(new Error('blocked'));
    const provider = new GoogleDriveProvider();
    const ok = await provider.connect();
    expect(ok).toBe(false);
    expect(provider.status()).toBe('Drive: Connection failed');
  });

  it('ignores corrupt stored token JSON', () => {
    localStorage.setItem('drive_access_token', '{bad');
    const provider = new GoogleDriveProvider();
    expect((provider as any).accessToken).toBe('');
  });

  it('drops expired cached token on construction', () => {
    localStorage.setItem(
      'drive_access_token',
      JSON.stringify({ accessToken: 'expired', expiresAt: Date.now() - 120_000 }),
    );
    const provider = new GoogleDriveProvider();
    expect((provider as any).accessToken).toBe('');
    expect(localStorage.getItem('drive_access_token')).toBeNull();
  });
});
