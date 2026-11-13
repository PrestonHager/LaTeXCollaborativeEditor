// Checks for messages that come in from peers. Anyone with the room link can send anything,
// so nothing from the network gets used until it passes one of these.
import { MAX_FILE_BYTES } from '../project/paths';
import { MAX_PROJECT_NAME_LENGTH } from '../project/projectDoc';
import type { ChunkMeta } from './fileTransfer';

/** Largest Yjs update a peer can send, in bytes. Same as the per-file limit. */
export const MAX_UPDATE_BYTES = MAX_FILE_BYTES;
/** Largest snapshot of the whole project, in bytes. */
export const MAX_SNAPSHOT_BYTES = 2 * MAX_FILE_BYTES;
/** Largest single file chunk we take, in bytes. Senders use 64 KB. */
export const MAX_CHUNK_BYTES = 256 * 1024;
export const MAX_TITLE_LENGTH = MAX_PROJECT_NAME_LENGTH;
export const MAX_STORAGE_LABEL_LENGTH = 200;
export const MAX_DOC_ID_LENGTH = 128;
export const MAX_APP_VERSION_LENGTH = 64;

/**
 * Version of the messages on this page. Bump it only for a change an older peer can't handle
 * (see docs/versioning.md). Adding an optional field or a new message kind doesn't need a bump,
 * since peers drop kinds they don't know and strip fields they don't know.
 */
export const PROTOCOL_VERSION = 1;

export type Metadata = { title: string; storage: string };

/** Sent once to each peer that joins, so both sides know which build the other runs. */
export type HelloMessage = { kind: 'hello'; protocol: number; appVersion: string; commit?: string };

export type SyncMessage =
  | { kind: 'snapshot'; state: number[]; docId?: string; metadata?: Metadata }
  | { kind: 'y-update'; update: number[] }
  | { kind: 'metadata'; metadata: Metadata }
  | { kind: 'sync-request' }
  | { kind: 'file-request'; hash: string }
  | HelloMessage;

// Hex SHA-256 hashes and the "fnv-…" fallback ones only use these characters.
const HASH_PATTERN = /^[A-Za-z0-9-]{1,128}$/;
// SemVer characters only, so a version string can't carry markup or anything long into logs or the UI.
const APP_VERSION_PATTERN = /^[0-9A-Za-z.+-]+$/;
const COMMIT_PATTERN = /^(?:[0-9a-f]{7,40}|dev)$/;

/** Say why a peer message got dropped, only in dev so the console stays quiet for everyone else. */
export function dropMessage(reason: string, payload?: unknown) {
  if (import.meta.env.DEV) console.warn(`Dropped peer message: ${reason}`, payload);
}

export function isValidHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

/** Check for a plain array of bytes no longer than max. */
export function isByteArray(value: unknown, max: number): value is number[] {
  if (!Array.isArray(value) || value.length > max) return false;
  for (const byte of value) {
    if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isMetadata(value: unknown): value is Metadata {
  return (
    isRecord(value) &&
    typeof value.title === 'string' &&
    value.title.length <= MAX_TITLE_LENGTH &&
    typeof value.storage === 'string' &&
    value.storage.length <= MAX_STORAGE_LABEL_LENGTH
  );
}

/**
 * Check a JSON message from a peer and return it typed, or null if it's malformed or too big.
 * The returned message only has the fields we know about, so extra junk doesn't get passed along.
 */
export function parseSyncMessage(payload: unknown): SyncMessage | null {
  if (!isRecord(payload)) return null;
  switch (payload.kind) {
    case 'snapshot': {
      if (!isByteArray(payload.state, MAX_SNAPSHOT_BYTES)) return null;
      const { docId, metadata } = payload;
      if (docId !== undefined && (typeof docId !== 'string' || docId.length > MAX_DOC_ID_LENGTH)) return null;
      if (metadata !== undefined && !isMetadata(metadata)) return null;
      return {
        kind: 'snapshot',
        state: payload.state,
        docId,
        metadata: metadata ? { title: metadata.title, storage: metadata.storage } : undefined,
      };
    }
    case 'y-update':
      return isByteArray(payload.update, MAX_UPDATE_BYTES) ? { kind: 'y-update', update: payload.update } : null;
    case 'metadata':
      return isMetadata(payload.metadata)
        ? { kind: 'metadata', metadata: { title: payload.metadata.title, storage: payload.metadata.storage } }
        : null;
    case 'sync-request':
      return { kind: 'sync-request' };
    case 'file-request':
      return isValidHash(payload.hash) ? { kind: 'file-request', hash: payload.hash } : null;
    case 'hello': {
      const { protocol, appVersion, commit } = payload;
      if (typeof protocol !== 'number' || !Number.isInteger(protocol) || protocol < 1 || protocol > 1_000_000) return null;
      if (typeof appVersion !== 'string' || appVersion.length > MAX_APP_VERSION_LENGTH || !APP_VERSION_PATTERN.test(appVersion)) {
        return null;
      }
      if (commit !== undefined && (typeof commit !== 'string' || !COMMIT_PATTERN.test(commit))) return null;
      return { kind: 'hello', protocol, appVersion, commit };
    }
    default:
      return null;
  }
}

/** Check the metadata on a binary file chunk, and that the chunk itself isn't too big. */
export function parseChunk(data: unknown, metadata: unknown): { data: ArrayBuffer | Uint8Array; meta: ChunkMeta } | null {
  if (!(data instanceof ArrayBuffer) && !(data instanceof Uint8Array)) return null;
  if (data.byteLength > MAX_CHUNK_BYTES || !isRecord(metadata)) return null;
  const { hash, index, total, size } = metadata;
  if (!isValidHash(hash)) return null;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0 || size > MAX_FILE_BYTES) return null;
  // Every chunk but an empty file's has at least one byte, so there can't be more chunks than bytes.
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 1 || total > Math.max(1, size)) return null;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= total) return null;
  return { data, meta: { hash, index, total, size } };
}
