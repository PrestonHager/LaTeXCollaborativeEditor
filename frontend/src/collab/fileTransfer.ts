import { matchesHash, type BlobStore } from '../project/blobStore';
import { MAX_FILE_BYTES } from '../project/paths';

/** Sent with every binary chunk so the receiver knows where it goes. */
export type ChunkMeta = { hash: string; index: number; total: number; size: number };

export type FileRequestMessage = { kind: 'file-request'; hash: string };

type TransferConfig = {
  blobs: BlobStore;
  /** Send a JSON message to one peer, or everyone when peerId is missing. */
  sendMessage: (message: FileRequestMessage, peerId?: string) => void;
  sendChunk: (data: Uint8Array, meta: ChunkMeta, peerId: string) => void;
  /** Progress from 0 to 1 while a file comes in, then null once it's done or gave up. */
  onProgress?: (hash: string, fraction: number | null) => void;
  maxBytes?: number;
  chunkBytes?: number;
  retryMs?: number;
  maxAttempts?: number;
};

type Incoming = {
  chunks: (Uint8Array | undefined)[];
  received: number;
  peerId: string | null;
  attempts: number;
  timer: ReturnType<typeof setTimeout> | undefined;
};

const DEFAULT_CHUNK_BYTES = 64 * 1024;
const DEFAULT_RETRY_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 4;

/**
 * Sends binary project files between peers over WebRTC, on request.
 * Files go in chunks from whichever peer answers first. If that peer stops sending,
 * we ask again after a while, up to a few times.
 */
export class FileTransfer {
  private readonly config: TransferConfig;
  private readonly incoming = new Map<string, Incoming>();
  private readonly maxBytes: number;
  private readonly chunkBytes: number;

  constructor(config: TransferConfig) {
    this.config = config;
    this.maxBytes = config.maxBytes ?? MAX_FILE_BYTES;
    this.chunkBytes = config.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  }

  /** Ask peers for a file we don't have. Does nothing if we have it or already asked. */
  request(hash: string) {
    if (this.config.blobs.has(hash) || this.incoming.has(hash)) return;
    this.incoming.set(hash, { chunks: [], received: 0, peerId: null, attempts: 0, timer: undefined });
    this.config.onProgress?.(hash, 0);
    this.ask(hash);
  }

  isTransferring(hash: string) {
    return this.incoming.has(hash);
  }

  /** A peer came in, so ask it for anything still missing. */
  peerJoined(peerId: string) {
    for (const hash of this.incoming.keys()) this.config.sendMessage({ kind: 'file-request', hash }, peerId);
  }

  /** The peer sending us a file left, so start that file over from someone else. */
  peerLeft(peerId: string) {
    for (const [hash, transfer] of this.incoming) {
      if (transfer.peerId !== peerId) continue;
      transfer.chunks = [];
      transfer.received = 0;
      transfer.peerId = null;
      this.ask(hash);
    }
  }

  /** A peer asked for a file. Send it if we have it and it's not too big. */
  async handleRequest(hash: string, peerId: string) {
    const bytes = this.config.blobs.peek(hash) ?? (await this.config.blobs.get(hash));
    if (!bytes || bytes.length > this.maxBytes) return;
    const total = Math.max(1, Math.ceil(bytes.length / this.chunkBytes));
    for (let index = 0; index < total; index += 1) {
      const chunk = bytes.subarray(index * this.chunkBytes, (index + 1) * this.chunkBytes);
      this.config.sendChunk(chunk, { hash, index, total, size: bytes.length }, peerId);
    }
  }

  /** A chunk came in. Once we have them all, check the hash and keep the file. */
  async handleChunk(data: ArrayBuffer | Uint8Array, meta: ChunkMeta, peerId: string) {
    const transfer = this.incoming.get(meta.hash);
    if (!transfer) return;
    if (meta.size > this.maxBytes || meta.total < 1 || meta.index < 0 || meta.index >= meta.total) {
      this.finish(meta.hash);
      return;
    }
    // Stick with the first peer that answered, so two senders don't mix their chunks.
    if (transfer.peerId && transfer.peerId !== peerId) return;
    transfer.peerId = peerId;
    if (transfer.chunks.length !== meta.total) transfer.chunks = new Array(meta.total);
    if (!transfer.chunks[meta.index]) {
      transfer.chunks[meta.index] = data instanceof Uint8Array ? data : new Uint8Array(data);
      transfer.received += 1;
    }
    this.restartTimer(meta.hash, transfer);
    this.config.onProgress?.(meta.hash, transfer.received / meta.total);
    if (transfer.received < meta.total) return;

    // Now put the chunks together and make sure it's the file we asked for.
    const bytes = new Uint8Array(meta.size);
    let offset = 0;
    for (const chunk of transfer.chunks) {
      if (!chunk || offset + chunk.length > meta.size) {
        this.retry(meta.hash, transfer);
        return;
      }
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (offset !== meta.size || !(await matchesHash(bytes, meta.hash))) {
      this.retry(meta.hash, transfer);
      return;
    }
    this.finish(meta.hash);
    await this.config.blobs.put(bytes, meta.hash);
  }

  /** Stop every transfer, like when leaving the room. */
  cancelAll() {
    for (const hash of [...this.incoming.keys()]) this.finish(hash);
  }

  private ask(hash: string) {
    const transfer = this.incoming.get(hash);
    if (!transfer) return;
    transfer.attempts += 1;
    this.config.sendMessage({ kind: 'file-request', hash });
    this.restartTimer(hash, transfer);
  }

  private retry(hash: string, transfer: Incoming) {
    transfer.chunks = [];
    transfer.received = 0;
    transfer.peerId = null;
    if (transfer.attempts >= (this.config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)) {
      this.finish(hash);
      return;
    }
    this.ask(hash);
  }

  private restartTimer(hash: string, transfer: Incoming) {
    if (transfer.timer) clearTimeout(transfer.timer);
    transfer.timer = setTimeout(() => this.retry(hash, transfer), this.config.retryMs ?? DEFAULT_RETRY_MS);
  }

  private finish(hash: string) {
    const transfer = this.incoming.get(hash);
    if (transfer?.timer) clearTimeout(transfer.timer);
    this.incoming.delete(hash);
    this.config.onProgress?.(hash, null);
  }
}
