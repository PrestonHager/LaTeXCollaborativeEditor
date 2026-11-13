import { crc32, createZip, dosDateTime, emptyFolders, readZip } from './zip';

/** Read the MS-DOS date and time fields of every local and central header back into dates. */
function headerDates(zip: Uint8Array): Date[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decode = (time: number, date: number) =>
    new Date((date >> 9) + 1980, ((date >> 5) & 0xf) - 1, date & 0x1f, time >> 11, (time >> 5) & 0x3f, (time & 0x1f) * 2);
  const dates: Date[] = [];
  for (let at = 0; at + 4 <= zip.length; at += 1) {
    const sig = view.getUint32(at, true);
    if (sig === 0x04034b50) dates.push(decode(view.getUint16(at + 10, true), view.getUint16(at + 12, true)));
    if (sig === 0x02014b50) dates.push(decode(view.getUint16(at + 12, true), view.getUint16(at + 14, true)));
  }
  return dates;
}

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
  });

  it('dates each entry with its modified time, or the export time, in both headers', async () => {
    const now = new Date(2026, 10, 13, 14, 37, 21);
    const edited = new Date(2024, 1, 29, 9, 5, 0);
    const zip = await createZip(
      [
        { path: 'main.tex', data: enc('a') },
        { path: 'old.tex', data: enc('b'), modified: edited },
      ],
      ['empty'],
      now,
    );
    // DOS time keeps seconds in twos, so 21 s is stored as 20 s.
    const stored = new Date(2026, 10, 13, 14, 37, 20).getTime();
    // Locals come first: empty/, main.tex, old.tex; then the central records in the same order.
    expect(headerDates(zip).map((date) => date.getTime())).toEqual([
      stored,
      stored,
      edited.getTime(),
      stored,
      stored,
      edited.getTime(),
    ]);
  });

  it('defaults to the current time and never writes month 0', async () => {
    const before = Date.now();
    const [date] = headerDates(await createZip([{ path: 'a.tex', data: enc('a') }]));
    expect(date.getTime()).toBeGreaterThanOrEqual(before - 2000);
    expect(date.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('packs DOS dates with months 1-12 and clamps to the range the format holds', () => {
    expect(dosDateTime(new Date(1980, 0, 1))).toEqual({ time: 0, date: (1 << 5) | 1 });
    expect(dosDateTime(new Date(2026, 11, 31, 23, 59, 59))).toEqual({
      time: (23 << 11) | (59 << 5) | 29,
      date: (46 << 9) | (12 << 5) | 31,
    });
    const earliest = dosDateTime(new Date(1980, 0, 1));
    expect(dosDateTime(new Date(1970, 0, 1))).toEqual(earliest);
    expect(dosDateTime(new Date(Number.NaN))).toEqual(earliest);
    expect(dosDateTime(new Date(2200, 0, 1))).toEqual(dosDateTime(new Date(2107, 11, 31, 23, 59, 58)));
  });

  it('round trips files, deflating the ones that shrink', async () => {
    const long = 'Hello LaTeX! '.repeat(50);
    const zip = await createZip([
      { path: 'main.tex', data: enc(long) },
      { path: 'figures/dot.png', data: new Uint8Array([137, 80, 78, 71]) },
      { path: 'ünïcode.tex', data: enc('x') },
    ]);
    // The repeated text compresses, so the archive is smaller than the raw text.
    expect(zip.length).toBeLessThan(long.length);
    const read = await readZip(zip);
    expect(read.files.map((file) => file.path)).toEqual(['main.tex', 'figures/dot.png', 'ünïcode.tex']);
    expect(dec(read.files[0].data)).toBe(long);
    expect(Array.from(read.files[1].data)).toEqual([137, 80, 78, 71]);
  });

  it('drops one shared top folder and junk files, and keeps empty folders', async () => {
    const zip = await createZip([
      { path: 'project/main.tex', data: enc('a') },
      { path: 'project/ch/one.tex', data: enc('b') },
      { path: '__MACOSX/project/._main.tex', data: enc('junk') },
      { path: 'project/.DS_Store', data: enc('junk') },
    ]);
    const read = await readZip(zip);
    expect(read.files.map((file) => file.path)).toEqual(['main.tex', 'ch/one.tex']);
  });

  it('writes and reads folder entries, only for folders nothing else implies', async () => {
    const zip = await createZip([{ path: 'a.tex', data: enc('a') }, { path: 'ch/one.tex', data: enc('b') }], [
      'empty',
      'ch',
      'deep/er/',
      'deep',
      '/empty/',
      '',
    ]);
    const read = await readZip(zip);
    expect(read.folders).toEqual(['deep/er', 'empty']);
    expect(read.files.map((file) => file.path)).toEqual(['a.tex', 'ch/one.tex']);
    // Directory entries have no data and carry the directory attribute.
    const view = new DataView(zip.buffer);
    const centralAt = view.getUint32(zip.length - 22 + 16, true);
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(4);
    expect(view.getUint32(centralAt + 24, true)).toBe(0);
    expect(view.getUint32(centralAt + 38, true)).toBe(0x10);
  });

  it('keeps an empty folder next to a shared top folder', async () => {
    const read = await readZip(await createZip([{ path: 'project/main.tex', data: enc('a') }], ['project/figures']));
    expect(read.files.map((file) => file.path)).toEqual(['main.tex']);
    expect(read.folders).toEqual(['figures']);
  });

  it('lists the folders that need their own entry', () => {
    expect(emptyFolders([{ path: 'a/b/c.tex', data: enc('') }], ['a', 'a/b', 'x', 'x/y', 'z'])).toEqual(['x/y', 'z']);
  });

  it('refuses things that are not zips, and methods it cannot read', async () => {
    await expect(readZip(enc('not a zip at all, just some text here'))).rejects.toThrow(/not a .zip/);
    const zip = await createZip([{ path: 'a.txt', data: enc('a') }]);
    // Change the method in the central directory to something unknown.
    const view = new DataView(zip.buffer);
    const centralAt = view.getUint32(zip.length - 22 + 16, true);
    view.setUint16(centralAt + 10, 99, true);
    await expect(readZip(zip)).rejects.toThrow(/compression method/);
    view.setUint32(centralAt, 0, true);
    await expect(readZip(zip)).rejects.toThrow(/damaged/);
  });
});
