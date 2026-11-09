import { crc32, createZip, readZip } from './zip';

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
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

  it('reads folder entries', async () => {
    // Build a zip by hand with a directory entry, since createZip only writes files.
    const withFolder = await createZip([{ path: 'empty/', data: new Uint8Array() }, { path: 'a.tex', data: enc('a') }]);
    const read = await readZip(withFolder);
    expect(read.folders).toEqual(['empty']);
    expect(read.files.map((file) => file.path)).toEqual(['a.tex']);
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
