import { createDriveTemplates } from './driveTemplates';
import { parseProfileFile, serializeProfile, syncProfile } from './profileSync';
import { emptyProfile } from '../state/profile';
import { GoogleDriveProvider } from '../storage/providers/googleDrive';

type Call = { url: string; method: string; body?: unknown };

/** A fake driveFetch that answers files.list queries from a list of files, and records every call. */
function fakeDrive(files: { id: string; name: string; tags: string[]; folder: boolean; text?: string }[] = []) {
  const calls: Call[] = [];
  let next = 0;
  const driveFetch = vi.fn(async (url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    calls.push({ url, method, body: init.body });
    const parsed = new URL(url);
    if (method === 'GET' && parsed.searchParams.has('q')) {
      const q = parsed.searchParams.get('q')!;
      const tag = /key='([^']+)'/.exec(q)?.[1];
      const folders = q.includes("mimeType='application/vnd.google-apps.folder'");
      const found = files.filter((file) => file.tags.includes(tag!) && file.folder === folders);
      return new Response(JSON.stringify({ files: found.map(({ id, name }) => ({ id, name, modifiedTime: '2026-01-02T00:00:00Z' })) }));
    }
    if (method === 'GET' && parsed.searchParams.get('alt') === 'media') {
      const id = parsed.pathname.split('/').pop();
      return new Response(files.find((file) => file.id === id)?.text ?? '');
    }
    if (method === 'POST' && typeof init.body === 'string') {
      const meta = JSON.parse(init.body) as { name: string; appProperties: Record<string, string> };
      const id = `new${(next += 1)}`;
      files.push({ id, name: meta.name, tags: Object.keys(meta.appProperties), folder: true });
      return new Response(JSON.stringify({ id, name: meta.name }));
    }
    return new Response('{}');
  });
  return { api: { driveFetch }, calls, files };
}

describe('Drive templates', () => {
  it('lists template folders by their tag', async () => {
    const { api } = fakeDrive([
      { id: 't1', name: 'Report', tags: ['latexTemplate'], folder: true },
      { id: 'p1', name: 'Project', tags: ['latexProject'], folder: true },
    ]);
    expect(await createDriveTemplates(api).listTemplates()).toEqual([{ id: 't1', name: 'Report', updatedAt: Date.parse('2026-01-02T00:00:00Z') }]);
  });

  it('makes the Templates folder once, then puts each template in it', async () => {
    const { api, calls, files } = fakeDrive();
    const drive = createDriveTemplates(api);
    const first = await drive.createTemplate('A');
    await drive.createTemplate('B');
    const posts = calls.filter((call) => call.method === 'POST').map((call) => JSON.parse(call.body as string));
    expect(posts).toEqual([
      { name: 'Templates', mimeType: 'application/vnd.google-apps.folder', appProperties: { latexTemplates: '1' } },
      { name: 'A', mimeType: 'application/vnd.google-apps.folder', parents: ['new1'], appProperties: { latexTemplate: '1' } },
      { name: 'B', mimeType: 'application/vnd.google-apps.folder', parents: ['new1'], appProperties: { latexTemplate: '1' } },
    ]);
    expect(first).toEqual({ id: 'new2', name: 'A' });
    expect(files.filter((file) => file.tags.includes('latexTemplates'))).toHaveLength(1);
  });

  it('finds an existing Templates folder instead of making another', async () => {
    const { api, calls } = fakeDrive([{ id: 'tf', name: 'Templates', tags: ['latexTemplates'], folder: true }]);
    await createDriveTemplates(api).createTemplate('A');
    expect(JSON.parse(calls.find((call) => call.method === 'POST')!.body as string)).toMatchObject({ parents: ['tf'] });
  });

  it('moves a deleted template to the trash', async () => {
    const { api, calls } = fakeDrive();
    await createDriveTemplates(api).deleteTemplate('t1');
    expect(calls).toEqual([{ url: 'https://www.googleapis.com/drive/v3/files/t1', method: 'PATCH', body: JSON.stringify({ trashed: true }) }]);
  });

  it('reads, writes and permanently deletes the profile file', async () => {
    const saved = serializeProfile({ profile: { ...emptyProfile(), name: 'Ann' }, updatedAt: 5 });
    const { api, calls } = fakeDrive([{ id: 'pf', name: 'profile.json', tags: ['latexProfile'], folder: false, text: saved }]);
    const drive = createDriveTemplates(api);
    expect(await drive.readProfile()).toBe(saved);
    await drive.writeProfile('{}');
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', url: expect.stringContaining('/upload/drive/v3/files/pf?uploadType=media') });
    expect(await drive.deleteProfile()).toBe(1);
    expect(calls.at(-1)).toEqual({ url: 'https://www.googleapis.com/drive/v3/files/pf', method: 'DELETE', body: undefined });
  });

  it('makes a new tagged profile file in the Templates folder when there is none', async () => {
    const { api, calls } = fakeDrive([{ id: 'tf', name: 'Templates', tags: ['latexTemplates'], folder: true }]);
    const drive = createDriveTemplates(api);
    expect(await drive.readProfile()).toBeNull();
    expect(await drive.deleteProfile()).toBe(0);
    await drive.writeProfile('{"a":1}');
    const upload = calls.at(-1)!;
    expect(upload.url).toContain('uploadType=multipart');
    const metadata = JSON.parse(await ((upload.body as FormData).get('metadata') as Blob).text());
    expect(metadata).toEqual({ name: 'profile.json', mimeType: 'application/json', parents: ['tf'], appProperties: { latexProfile: '1' } });
  });

  it('refuses to open the Templates folder as a project', async () => {
    const provider = new GoogleDriveProvider();
    (provider as any).accessToken = 'token';
    (provider as any).tokenExpiresAt = Date.now() + 3_600_000;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'tf', name: 'Templates', mimeType: 'application/vnd.google-apps.folder', appProperties: { latexTemplates: '1' } })),
    );
    await expect(provider.openProject('tf')).rejects.toThrow('That is your Templates folder');
    vi.restoreAllMocks();
  });
});

describe('profile sync', () => {
  const ann = { ...emptyProfile(), name: 'Ann' };
  const bob = { ...emptyProfile(), name: 'Bob' };
  const drive = (remote: string | null) => ({ readProfile: vi.fn(async () => remote), writeProfile: vi.fn(async (_text: string) => {}), deleteProfile: vi.fn(async () => (remote ? 1 : 0)) });

  it('takes the newer copy from Drive', async () => {
    const remote = drive(serializeProfile({ profile: bob, updatedAt: 10 }));
    expect(await syncProfile({ profile: ann, updatedAt: 5 }, remote)).toEqual({ action: 'pulled', profile: bob });
    expect(remote.writeProfile).not.toHaveBeenCalled();
  });

  it('sends a newer local copy to Drive', async () => {
    const remote = drive(serializeProfile({ profile: bob, updatedAt: 1 }));
    expect(await syncProfile({ profile: ann, updatedAt: 5 }, remote)).toEqual({ action: 'pushed' });
    expect(parseProfileFile(remote.writeProfile.mock.calls[0][0])).toEqual({ profile: ann, updatedAt: 5 });
  });

  it('does nothing when both match', async () => {
    const remote = drive(serializeProfile({ profile: ann, updatedAt: 1 }));
    expect(await syncProfile({ profile: ann, updatedAt: 5 }, remote)).toEqual({ action: 'none' });
  });

  it('deletes the Drive copy when the profile was cleared here after it was saved', async () => {
    const remote = drive(serializeProfile({ profile: bob, updatedAt: 1 }));
    expect(await syncProfile({ profile: emptyProfile(), updatedAt: 5 }, remote)).toEqual({ action: 'deleted' });
    expect(remote.writeProfile).not.toHaveBeenCalled();
    expect(await syncProfile({ profile: emptyProfile(), updatedAt: 5 }, drive(null))).toEqual({ action: 'none' });
  });

  it('ignores a file that is not a profile', async () => {
    expect(parseProfileFile('{"format":"other"}')).toBeNull();
    expect(parseProfileFile('nope')).toBeNull();
    expect(parseProfileFile(null)).toBeNull();
    expect(parseProfileFile('{"format":"latex-editor-profile","profile":{"name":"A"}}')).toEqual({ profile: { ...emptyProfile(), name: 'A' }, updatedAt: 0 });
    const remote = drive('garbage');
    expect(await syncProfile({ profile: ann, updatedAt: 0 }, remote)).toEqual({ action: 'pushed' });
  });
});
