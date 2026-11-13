import { createDriveDestination, driveFileUrl, driveMimeType, findOrCreateExportsFolder, uploadError, uploadWithProgress, type DriveApi } from './driveUpload';
import { isAbortError } from './types';
import { StorageError } from '../storage/errors';

/** An XMLHttpRequest stand-in: the test decides how each upload ends. */
class FakeXhr {
  static last: FakeXhr | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: FormData | null = null;
  status = 0;
  responseText = '';
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: FormData) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    this.onload?.();
  }
}

const makeXhr = () => new FakeXhr() as unknown as XMLHttpRequest;
const run = (signal = new AbortController().signal) => ({ signal, onProgress: vi.fn() });
const html = { name: 'Paper.html', data: new Blob(['<p>hi</p>'], { type: 'text/html;charset=utf-8' }) };
const json = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

async function metadataOf(xhr: FakeXhr) {
  return JSON.parse(await (xhr.body!.get('metadata') as Blob).text());
}

describe('Drive export upload', () => {
  it('stores each format as the right kind of file', () => {
    expect(driveMimeType(html)).toBe('text/html');
    expect(driveMimeType({ name: 'Paper.tex', data: new Blob([], { type: 'text/plain;charset=utf-8' }) })).toBe('text/x-tex');
    expect(driveMimeType({ name: 'Paper.zip', data: new Blob() })).toBe('application/zip');
    expect(driveMimeType({ name: 'fig.png', data: new Blob([], { type: 'image/png' }) })).toBe('image/png');
    expect(driveMimeType({ name: 'notes.bib', data: new Blob() })).toBe('text/plain');
  });

  it('uploads with progress into the folder, with the token, and gives back the file', async () => {
    const progress = run();
    const done = uploadWithProgress(html, 'folder1', 'tok', progress, makeXhr);
    const xhr = FakeXhr.last!;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink');
    expect(xhr.headers.Authorization).toBe('Bearer tok');
    expect(await metadataOf(xhr)).toEqual({ name: 'Paper.html', mimeType: 'text/html', parents: ['folder1'] });
    expect((xhr.body!.get('file') as Blob).type).toBe('text/html');
    xhr.upload.onprogress!({ lengthComputable: true, loaded: 1, total: 4 });
    xhr.upload.onprogress!({ lengthComputable: false, loaded: 0, total: 0 });
    expect(progress.onProgress).toHaveBeenCalledWith(0.25, 'Uploading to Google Drive... 25%');
    expect(progress.onProgress).toHaveBeenCalledTimes(2);
    xhr.respond(200, { id: 'x1', name: 'Paper.html', webViewLink: 'https://drive.google.com/file/d/x1/view' });
    await expect(done).resolves.toEqual({ id: 'x1', name: 'Paper.html', webViewLink: 'https://drive.google.com/file/d/x1/view' });
  });

  it('uploads to the top of My Drive with no folder', async () => {
    const done = uploadWithProgress(html, null, 'tok', run(), makeXhr);
    expect(await metadataOf(FakeXhr.last!)).toEqual({ name: 'Paper.html', mimeType: 'text/html' });
    FakeXhr.last!.respond(200, { id: 'x2' });
    await expect(done).resolves.toEqual({ id: 'x2', name: 'Paper.html', webViewLink: undefined });
  });

  it('turns failures into readable errors', async () => {
    const failed = uploadWithProgress(html, null, 'tok', run(), makeXhr);
    FakeXhr.last!.respond(403, { error: { message: 'The user has exceeded their Drive storage quota', errors: [{ reason: 'storageQuotaExceeded' }] } });
    await expect(failed).rejects.toThrow(/Drive is full/);

    const garbled = uploadWithProgress(html, null, 'tok', run(), makeXhr);
    FakeXhr.last!.respond(200, 'not json');
    await expect(garbled).rejects.toThrow(/could not read/);

    const offline = uploadWithProgress(html, null, 'tok', run(), makeXhr);
    FakeXhr.last!.onerror!();
    await expect(offline).rejects.toThrow(/Check your connection/);

    expect(uploadError(401, '').message).toMatch(/sign-in expired/);
    expect(uploadError(404, '').message).toMatch(/Choose another folder/);
    expect(uploadError(429, '').retryable).toBe(true);
    expect(uploadError(403, JSON.stringify({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } })).message).toMatch(/limiting/);
    expect(uploadError(403, JSON.stringify({ error: { message: 'No' } })).message).toBe('Drive: Permission denied while uploading (No).');
    expect(uploadError(500, '<html>').message).toBe('Drive: The upload failed (HTTP 500).');
    expect(uploadError(500, '').retryable).toBe(true);
    expect(uploadError(400, '')).toBeInstanceOf(StorageError);
  });

  it('aborts the request on Cancel', async () => {
    const controller = new AbortController();
    const done = uploadWithProgress(html, null, 'tok', run(controller.signal), makeXhr);
    controller.abort();
    await expect(done).rejects.toSatisfy(isAbortError);
    expect(FakeXhr.last!.aborted).toBe(true);
    // Already canceled: nothing is sent.
    FakeXhr.last = null;
    await expect(uploadWithProgress(html, null, 'tok', run(controller.signal), makeXhr)).rejects.toSatisfy(isAbortError);
    expect(FakeXhr.last).toBeNull();
  });

  it('finds the tagged exports folder, or makes it', async () => {
    const api: DriveApi = { getAccessToken: () => 'tok', driveFetch: vi.fn(async () => json({ files: [{ id: 'ex1' }] })) };
    expect(await findOrCreateExportsFolder(api, 'p1', 'exports')).toBe('ex1');
    const query = new URL(vi.mocked(api.driveFetch).mock.calls[0][0]).searchParams.get('q');
    expect(query).toBe("'p1' in parents and mimeType='application/vnd.google-apps.folder' and appProperties has { key='latexExports' and value='1' } and trashed=false");

    const make = vi.fn().mockResolvedValueOnce(json({ files: [] })).mockResolvedValueOnce(json({ id: 'ex2' }));
    expect(await findOrCreateExportsFolder({ getAccessToken: () => 'tok', driveFetch: make }, 'p1', 'exports')).toBe('ex2');
    const [, init] = make.mock.calls[1];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      name: 'exports',
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['p1'],
      appProperties: { latexExports: '1' },
    });

    const noId = vi.fn().mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({}));
    await expect(findOrCreateExportsFolder({ getAccessToken: () => 'tok', driveFetch: noId }, 'p1', 'exports')).rejects.toThrow(/did not return its id/);
  });

  it('saves into the exports folder once, and links each file', async () => {
    const api: DriveApi = { getAccessToken: () => 'fresh', driveFetch: vi.fn(async () => json({ files: [{ id: 'ex1' }] })) };
    const destination = createDriveDestination(api, { exportsIn: 'p1', name: 'exports' }, makeXhr);
    const first = destination.save(html, run()) as Promise<{ name: string; url?: string }>;
    await vi.waitFor(() => expect(FakeXhr.last?.body).toBeTruthy());
    expect(FakeXhr.last!.headers.Authorization).toBe('Bearer fresh');
    expect((await metadataOf(FakeXhr.last!)).parents).toEqual(['ex1']);
    FakeXhr.last!.respond(200, { id: 'x1', name: 'Paper.html' });
    expect(await first).toEqual({ name: 'Paper.html', url: driveFileUrl('x1') });
    FakeXhr.last = null;
    const second = destination.save(html, run()) as Promise<unknown>;
    await vi.waitFor(() => expect(FakeXhr.last?.body).toBeTruthy());
    FakeXhr.last!.respond(200, { id: 'x2', webViewLink: 'https://drive.google.com/x2' });
    expect(await second).toEqual({ name: 'Paper.html', url: 'https://drive.google.com/x2' });
    expect(api.driveFetch).toHaveBeenCalledTimes(1);
    expect(destination.doneMessage!([{ name: 'Paper.html' }])).toBe('Saved Paper.html to Google Drive (exports)');
  });

  it('checks a picked folder first, and looks again after a failure', async () => {
    const driveFetch = vi.fn().mockRejectedValueOnce(new StorageError('Drive: gone')).mockResolvedValue(json({ id: 'f1' }));
    const destination = createDriveDestination({ getAccessToken: () => 'tok', driveFetch }, { folderId: 'f1', folderName: 'Theses' }, makeXhr);
    await expect(destination.save(html, run())).rejects.toThrow('Drive: gone');
    const again = destination.save(html, run()) as Promise<unknown>;
    await vi.waitFor(() => expect(driveFetch).toHaveBeenCalledTimes(2));
    expect(driveFetch.mock.calls[1][0]).toBe('https://www.googleapis.com/drive/v3/files/f1?fields=id');
    await vi.waitFor(() => expect(FakeXhr.last?.body).toBeTruthy());
    FakeXhr.last!.respond(200, { id: 'x3' });
    await again;
    expect(destination.doneMessage!([{ name: 'a' }, { name: 'b' }])).toBe('Saved a, b to Google Drive (Theses)');
    expect(createDriveDestination({ getAccessToken: () => '', driveFetch }, { exportsIn: null, name: 'exports' }).doneMessage!([{ name: 'a' }])).toBe(
      'Saved a to Google Drive (My Drive)',
    );
  });

  it('uploads to My Drive without looking up a folder', async () => {
    const driveFetch = vi.fn();
    const destination = createDriveDestination({ getAccessToken: () => 'tok', driveFetch }, { exportsIn: null, name: 'exports' }, makeXhr);
    FakeXhr.last = null;
    const saving = destination.save(html, run()) as Promise<unknown>;
    await vi.waitFor(() => expect(FakeXhr.last?.body).toBeTruthy());
    FakeXhr.last!.respond(200, { id: 'x4' });
    await saving;
    expect(driveFetch).not.toHaveBeenCalled();
  });
});
