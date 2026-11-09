import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { FileTransfer, type ChunkMeta } from './fileTransfer';
import { BlobStore, hashBytes } from '../project/blobStore';
import { resetDbForTests } from '../storage/idb';

/** Two peers, wired so the receiver's requests reach the sender and chunks come back. */
async function setup(options: { chunkBytes?: number; maxBytes?: number; retryMs?: number; maxAttempts?: number } = {}) {
  const senderBlobs = new BlobStore();
  const receiverBlobs = new BlobStore();
  const chunks: { data: Uint8Array; meta: ChunkMeta; peerId: string }[] = [];
  const requests: { hash: string; peerId?: string }[] = [];
  const progress: [string, number | null][] = [];
  const sender = new FileTransfer({
    blobs: senderBlobs,
    sendMessage: vi.fn(),
    sendChunk: (data, meta, peerId) => chunks.push({ data: data.slice(), meta, peerId }),
    chunkBytes: options.chunkBytes ?? 4,
    maxBytes: options.maxBytes,
  });
  const receiver = new FileTransfer({
    blobs: receiverBlobs,
    sendMessage: (message, peerId) => requests.push({ hash: message.hash, peerId }),
    sendChunk: vi.fn(),
    onProgress: (hash, fraction) => progress.push([hash, fraction]),
    chunkBytes: options.chunkBytes ?? 4,
    maxBytes: options.maxBytes,
    retryMs: options.retryMs,
    maxAttempts: options.maxAttempts,
  });
  return { sender, receiver, senderBlobs, receiverBlobs, chunks, requests, progress };
}

describe('FileTransfer', () => {
  beforeEach(() => {
    resetDbForTests();
    globalThis.indexedDB = new IDBFactory();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks for a missing file, gets it in chunks, and keeps it once the hash matches', async () => {
    const t = await setup();
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const hash = await t.senderBlobs.put(bytes);

    t.receiver.request(hash);
    t.receiver.request(hash);
    expect(t.requests).toEqual([{ hash, peerId: undefined }]);
    expect(t.receiver.isTransferring(hash)).toBe(true);

    await t.sender.handleRequest(hash, 'receiver');
    expect(t.chunks.map((chunk) => chunk.meta.index)).toEqual([0, 1, 2]);
    // Deliver them out of order, with one twice.
    for (const chunk of [t.chunks[2], t.chunks[0], t.chunks[0], t.chunks[1]]) {
      await t.receiver.handleChunk(chunk.data.buffer as ArrayBuffer, chunk.meta, 'sender');
    }
    expect(Array.from(t.receiverBlobs.peek(hash)!)).toEqual(Array.from(bytes));
    expect(t.receiver.isTransferring(hash)).toBe(false);
    expect(t.progress.at(-1)).toEqual([hash, null]);
    expect(t.progress.some(([, fraction]) => fraction !== null && fraction > 0 && fraction < 1)).toBe(true);
    // Once we have it, asking again does nothing.
    t.receiver.request(hash);
    expect(t.requests).toHaveLength(1);
  });

  it('sticks with the first peer that answers', async () => {
    const t = await setup();
    const hash = await t.senderBlobs.put(new Uint8Array([1, 2, 3, 4, 5]));
    t.receiver.request(hash);
    await t.sender.handleRequest(hash, 'receiver');
    await t.receiver.handleChunk(t.chunks[0].data, t.chunks[0].meta, 'a');
    // A second sender's chunk is ignored, even if it's the missing one.
    await t.receiver.handleChunk(t.chunks[1].data, t.chunks[1].meta, 'b');
    expect(t.receiverBlobs.has(hash)).toBe(false);
    await t.receiver.handleChunk(t.chunks[1].data, t.chunks[1].meta, 'a');
    expect(t.receiverBlobs.has(hash)).toBe(true);
  });

  it('throws away a file whose bytes do not match, and asks again', async () => {
    const t = await setup();
    const hash = await hashBytes(new Uint8Array([1, 2, 3]));
    t.receiver.request(hash);
    await t.receiver.handleChunk(new Uint8Array([9, 9, 9]), { hash, index: 0, total: 1, size: 3 }, 'liar');
    expect(t.receiverBlobs.has(hash)).toBe(false);
    expect(t.requests).toHaveLength(2);
    // Chunks that add up to the wrong size get thrown away too.
    await t.receiver.handleChunk(new Uint8Array([1, 2]), { hash, index: 0, total: 1, size: 3 }, 'short');
    expect(t.requests).toHaveLength(3);
  });

  it('gives up on files over the size limit or with broken chunk info', async () => {
    const t = await setup({ maxBytes: 4 });
    const big = await t.senderBlobs.put(new Uint8Array([1, 2, 3, 4, 5]));
    await t.sender.handleRequest(big, 'receiver');
    expect(t.chunks).toHaveLength(0);
    await t.sender.handleRequest('unknown', 'receiver');
    expect(t.chunks).toHaveLength(0);

    t.receiver.request('h');
    await t.receiver.handleChunk(new Uint8Array(5), { hash: 'h', index: 0, total: 1, size: 5 }, 'p');
    expect(t.receiver.isTransferring('h')).toBe(false);
    t.receiver.request('h2');
    await t.receiver.handleChunk(new Uint8Array(1), { hash: 'h2', index: 3, total: 1, size: 1 }, 'p');
    expect(t.receiver.isTransferring('h2')).toBe(false);
    // Chunks for files we never asked for are ignored.
    await t.receiver.handleChunk(new Uint8Array(1), { hash: 'other', index: 0, total: 1, size: 1 }, 'p');
  });

  it('asks again after a stall, then gives up after a few tries', async () => {
    vi.useFakeTimers();
    const t = await setup({ retryMs: 1000, maxAttempts: 2 });
    t.receiver.request('h');
    vi.advanceTimersByTime(1000);
    expect(t.requests).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(t.receiver.isTransferring('h')).toBe(false);
  });

  it('asks new peers for missing files and restarts when the sender leaves', async () => {
    const t = await setup();
    const hash = await t.senderBlobs.put(new Uint8Array([1, 2, 3, 4, 5]));
    t.receiver.request(hash);
    t.receiver.peerJoined('late');
    expect(t.requests.at(-1)).toEqual({ hash, peerId: 'late' });
    await t.sender.handleRequest(hash, 'receiver');
    await t.receiver.handleChunk(t.chunks[0].data, t.chunks[0].meta, 'a');
    t.receiver.peerLeft('someone-else');
    expect(t.requests).toHaveLength(2);
    t.receiver.peerLeft('a');
    expect(t.requests).toHaveLength(3);
    // Now another peer can send the whole thing.
    await t.receiver.handleChunk(t.chunks[0].data, t.chunks[0].meta, 'b');
    await t.receiver.handleChunk(t.chunks[1].data, t.chunks[1].meta, 'b');
    expect(t.receiverBlobs.has(hash)).toBe(true);
    t.receiver.request('x');
    t.receiver.cancelAll();
    expect(t.receiver.isTransferring('x')).toBe(false);
  });
});
