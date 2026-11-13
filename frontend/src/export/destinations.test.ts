import { downloadChoice, driveChoice, type DriveChoiceDeps } from './destinations';
import type { Exporter } from './types';

const fileExporter = { id: 'html', label: 'HTML' } as Exporter;
const pdf = { id: 'pdf-preview', label: 'PDF', printsOnly: true } as Exporter;

function deps(overrides: Partial<DriveChoiceDeps> = {}) {
  const createDriveDestination = vi.fn((_api: unknown, target: unknown) => ({ id: 'drive', label: 'Google Drive', save: vi.fn(), target }));
  let key = 'drive:p1';
  const value: DriveChoiceDeps & { setKey(next: string): void } = {
    api: { driveFetch: vi.fn(), getAccessToken: () => 't' },
    isGuest: () => false,
    configured: () => true,
    signedIn: () => true,
    signIn: vi.fn(async () => true),
    projectFolderId: vi.fn(async () => 'p1'),
    inDriveProject: () => true,
    projectKey: () => key,
    exportsFolderName: () => 'exports',
    pickFolder: vi.fn(async () => ({ id: 'f1', name: 'Theses' })),
    load: async () => ({ createDriveDestination }) as never,
    setKey: (next) => (key = next),
    ...overrides,
  };
  return { value, createDriveDestination };
}

describe('export destinations', () => {
  it('Download is always there and saves through the browser', () => {
    const download = vi.fn();
    const choice = downloadChoice(download);
    expect(choice.status(pdf)).toEqual({ ok: true });
    const destination = choice.prepare() as { save: (file: unknown, run: unknown) => void };
    destination.save({ name: 'a.zip', data: new Blob([], { type: 'application/zip' }) }, {});
    expect(download).toHaveBeenCalledWith('a.zip', expect.any(Blob), 'application/zip');
  });

  it('says what Drive needs, in order: the host, setup, a file to upload, then sign-in', () => {
    expect(driveChoice(deps({ isGuest: () => true }).value).status(fileExporter)).toMatchObject({ ok: false, tag: 'host only' });
    expect(driveChoice(deps({ configured: () => false }).value).status(fileExporter)).toMatchObject({ ok: false, tag: 'not set up' });
    const forPdf = driveChoice(deps().value).status(pdf);
    expect(forPdf).toMatchObject({ ok: false, tag: 'not for PDF' });
    expect(!forPdf.ok && forPdf.reason).toContain('print dialog');
    expect(driveChoice(deps({ signedIn: () => false }).value).status(fileExporter)).toMatchObject({ ok: true, tag: 'sign-in needed' });
    expect(driveChoice(deps().value).status(fileExporter)).toEqual({ ok: true });
  });

  it("saves into the project's exports folder by default, after signing in", async () => {
    const { value, createDriveDestination } = deps();
    const choice = driveChoice(value);
    expect(choice.folder!.name()).toBe("exports (in the project's folder)");
    await choice.prepare();
    expect(value.signIn).toHaveBeenCalled();
    expect(createDriveDestination).toHaveBeenCalledWith(value.api, { exportsIn: 'p1', name: 'exports' });
  });

  it('saves to My Drive when the project is not in Drive', async () => {
    const { value, createDriveDestination } = deps({ inDriveProject: () => false, projectFolderId: async () => null });
    const choice = driveChoice(value);
    expect(choice.folder!.name()).toBe('My Drive');
    await choice.prepare();
    expect(createDriveDestination).toHaveBeenCalledWith(value.api, { exportsIn: null, name: 'exports' });
  });

  it('uses a folder picked with the Picker, until another project opens', async () => {
    const { value, createDriveDestination } = deps();
    const choice = driveChoice(value);
    await choice.folder!.choose();
    expect(value.pickFolder).toHaveBeenCalled();
    expect(choice.folder!.name()).toBe('Theses');
    await choice.prepare();
    expect(createDriveDestination).toHaveBeenLastCalledWith(value.api, { folderId: 'f1', folderName: 'Theses' });

    // Canceling the Picker keeps the folder.
    vi.mocked(value.pickFolder).mockResolvedValueOnce(null);
    await choice.folder!.choose();
    expect(choice.folder!.name()).toBe('Theses');

    value.setKey('drive:p2');
    expect(choice.folder!.name()).toBe("exports (in the project's folder)");
  });

  it('stops with a message when sign-in does not finish', async () => {
    const { value, createDriveDestination } = deps({ signIn: async () => false });
    const choice = driveChoice(value);
    await expect(choice.prepare()).rejects.toThrow(/sign-in didn't finish/);
    await expect(choice.folder!.choose()).rejects.toThrow(/sign-in didn't finish/);
    expect(value.pickFolder).not.toHaveBeenCalled();
    expect(createDriveDestination).not.toHaveBeenCalled();
  });

  it('loads the Drive upload code on its own when no loader is given', async () => {
    const { value } = deps({ load: undefined });
    const destination = await driveChoice(value).prepare();
    expect(destination.id).toBe('drive');
  });
});
