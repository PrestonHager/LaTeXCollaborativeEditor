// A small .zip reader and writer. The browser's own CompressionStream does the deflate work,
// so this adds no library to the bundle. Zip64 (archives over 4 GB) isn't supported.

export type ZipEntry = { path: string; data: Uint8Array };
export type ZipContents = { files: ZipEntry[]; folders: string[] };

let crcTable: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Response(bytes as BodyInit).body!.pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

const canDeflate = () => typeof CompressionStream !== 'undefined';

/** Build a .zip. Each file is deflated when that makes it smaller, and stored as-is otherwise. */
export async function createZip(files: ZipEntry[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.path);
    const crc = crc32(file.data);
    let method = 0;
    let body = file.data;
    if (canDeflate() && file.data.length > 64) {
      const deflated = await pipe(file.data, new CompressionStream('deflate-raw'));
      if (deflated.length < file.data.length) {
        method = 8;
        body = deflated;
      }
    }

    // First, the local header then the data.
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // Names are UTF-8.
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    locals.push(local, body);

    // Then the matching central directory record, which points back at it.
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length + body.length;
  }

  // Finally, the end record says where the central directory is.
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Skip junk that zip tools on macOS and Windows add. */
function isJunk(path: string) {
  return path.startsWith('__MACOSX/') || /(^|\/)(\.DS_Store|Thumbs\.db)$/.test(path);
}

/**
 * Read a .zip into files and folders.
 * When everything sits in one top folder (like GitHub downloads), that folder is dropped.
 */
export async function readZip(bytes: Uint8Array): Promise<ZipContents> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endAt = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      endAt = i;
      break;
    }
  }
  if (endAt < 0) throw new Error('That file is not a .zip archive.');
  const count = view.getUint16(endAt + 10, true);
  let at = view.getUint32(endAt + 16, true);
  if (at === 0xffffffff) throw new Error('Zip64 archives are not supported.');

  const decoder = new TextDecoder();
  const files: ZipEntry[] = [];
  const folders: string[] = [];
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('The .zip archive is damaged.');
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)).replace(/\\/g, '/');
    at += 46 + nameLength + extraLength + commentLength;
    if (isJunk(path)) continue;
    if (path.endsWith('/')) {
      folders.push(path.slice(0, -1));
      continue;
    }

    // The local header can have its own extra field, so read its lengths to find the data.
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    const raw = bytes.subarray(dataAt, dataAt + compressedSize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await pipe(raw, new DecompressionStream('deflate-raw'));
    else throw new Error(`${path} uses a compression method this app can't read.`);
    files.push({ path, data });
  }

  // Drop a single shared top folder, so the main file ends up at the project root.
  const tops = new Set([...files.map((file) => file.path), ...folders].map((path) => path.split('/')[0]));
  if (tops.size === 1 && files.every((file) => file.path.includes('/'))) {
    const top = [...tops][0];
    const strip = (path: string) => path.slice(top.length + 1);
    return {
      files: files.map((file) => ({ ...file, path: strip(file.path) })),
      folders: folders.filter((folder) => folder !== top).map(strip),
    };
  }
  return { files, folders };
}
