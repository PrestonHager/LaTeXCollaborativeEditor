import {
  MAX_CHUNK_BYTES,
  MAX_DOC_ID_LENGTH,
  MAX_SNAPSHOT_BYTES,
  MAX_STORAGE_LABEL_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_UPDATE_BYTES,
  dropMessage,
  isByteArray,
  isValidHash,
  parseChunk,
  parseSyncMessage,
} from './messages';
import { MAX_FILE_BYTES } from '../project/paths';

const metadata = { title: 'Paper', storage: 'Saved on host local storage' };

describe('parseSyncMessage', () => {
  it('accepts each well formed message and drops extra fields', () => {
    expect(parseSyncMessage({ kind: 'y-update', update: [1, 2], extra: 'x' })).toEqual({ kind: 'y-update', update: [1, 2] });
    expect(parseSyncMessage({ kind: 'snapshot', state: [0, 0], docId: 'd', metadata })).toEqual({
      kind: 'snapshot',
      state: [0, 0],
      docId: 'd',
      metadata,
    });
    expect(parseSyncMessage({ kind: 'snapshot', state: [] })).toEqual({ kind: 'snapshot', state: [], docId: undefined, metadata: undefined });
    expect(parseSyncMessage({ kind: 'metadata', metadata: { ...metadata, junk: 1 } })).toEqual({ kind: 'metadata', metadata });
    expect(parseSyncMessage({ kind: 'sync-request', junk: 1 })).toEqual({ kind: 'sync-request' });
    expect(parseSyncMessage({ kind: 'file-request', hash: 'fnv-abc123-3' })).toEqual({ kind: 'file-request', hash: 'fnv-abc123-3' });
  });

  it('rejects things that are not message objects', () => {
    for (const payload of [null, undefined, 'snapshot', 42, [], [{ kind: 'sync-request' }], {}, { kind: 'unknown' }, { kind: 7 }]) {
      expect(parseSyncMessage(payload)).toBeNull();
    }
  });

  it('rejects updates and snapshots that are not byte arrays', () => {
    expect(parseSyncMessage({ kind: 'y-update' })).toBeNull();
    expect(parseSyncMessage({ kind: 'y-update', update: 'abc' })).toBeNull();
    expect(parseSyncMessage({ kind: 'y-update', update: { 0: 1, length: 1 } })).toBeNull();
    expect(parseSyncMessage({ kind: 'y-update', update: [1, 256] })).toBeNull();
    expect(parseSyncMessage({ kind: 'y-update', update: [1, -1] })).toBeNull();
    expect(parseSyncMessage({ kind: 'y-update', update: [1.5] })).toBeNull();
    expect(parseSyncMessage({ kind: 'y-update', update: ['1'] })).toBeNull();
    expect(parseSyncMessage({ kind: 'snapshot', state: null })).toBeNull();
  });

  it('rejects updates and snapshots over the size limits', () => {
    // A sparse array has the length without having to fill millions of entries.
    const tooBigUpdate = new Array(MAX_UPDATE_BYTES + 1);
    const tooBigSnapshot = new Array(MAX_SNAPSHOT_BYTES + 1);
    expect(parseSyncMessage({ kind: 'y-update', update: tooBigUpdate })).toBeNull();
    expect(parseSyncMessage({ kind: 'snapshot', state: tooBigSnapshot })).toBeNull();
  });

  it('rejects snapshots with a bad doc id or metadata', () => {
    expect(parseSyncMessage({ kind: 'snapshot', state: [], docId: 5 })).toBeNull();
    expect(parseSyncMessage({ kind: 'snapshot', state: [], docId: 'x'.repeat(MAX_DOC_ID_LENGTH + 1) })).toBeNull();
    expect(parseSyncMessage({ kind: 'snapshot', state: [], metadata: 'Paper' })).toBeNull();
    expect(parseSyncMessage({ kind: 'snapshot', state: [], metadata: { title: 'Paper' } })).toBeNull();
  });

  it('rejects metadata with the wrong types or overly long text', () => {
    expect(parseSyncMessage({ kind: 'metadata' })).toBeNull();
    expect(parseSyncMessage({ kind: 'metadata', metadata: { title: 1, storage: 'x' } })).toBeNull();
    expect(parseSyncMessage({ kind: 'metadata', metadata: { title: 'x', storage: null } })).toBeNull();
    expect(parseSyncMessage({ kind: 'metadata', metadata: { ...metadata, title: 'x'.repeat(MAX_TITLE_LENGTH + 1) } })).toBeNull();
    expect(
      parseSyncMessage({ kind: 'metadata', metadata: { ...metadata, storage: 'x'.repeat(MAX_STORAGE_LABEL_LENGTH + 1) } }),
    ).toBeNull();
    expect(parseSyncMessage({ kind: 'metadata', metadata: { ...metadata, title: 'x'.repeat(MAX_TITLE_LENGTH) } })).not.toBeNull();
  });

  it('rejects file requests with a missing or odd hash', () => {
    expect(parseSyncMessage({ kind: 'file-request' })).toBeNull();
    expect(parseSyncMessage({ kind: 'file-request', hash: 12 })).toBeNull();
    expect(parseSyncMessage({ kind: 'file-request', hash: '' })).toBeNull();
    expect(parseSyncMessage({ kind: 'file-request', hash: '../../etc' })).toBeNull();
    expect(parseSyncMessage({ kind: 'file-request', hash: 'a'.repeat(129) })).toBeNull();
  });
});

describe('isByteArray and isValidHash', () => {
  it('checks bytes against a max length', () => {
    expect(isByteArray([0, 255], 2)).toBe(true);
    expect(isByteArray([0, 255, 1], 2)).toBe(false);
  });

  it('only takes hash-like strings', () => {
    expect(isValidHash('a'.repeat(64))).toBe(true);
    expect(isValidHash('has space')).toBe(false);
    expect(isValidHash(undefined)).toBe(false);
  });
});

describe('parseChunk', () => {
  const data = new Uint8Array([1, 2, 3]).buffer;
  const meta = { hash: 'abc', index: 0, total: 1, size: 3 };

  it('accepts a good chunk and keeps only the known fields', () => {
    expect(parseChunk(data, { ...meta, extra: true })).toEqual({ data, meta });
    expect(parseChunk(new Uint8Array(0), { hash: 'abc', index: 0, total: 1, size: 0 })).not.toBeNull();
  });

  it('rejects data that is not binary or is too big', () => {
    expect(parseChunk('abc', meta)).toBeNull();
    expect(parseChunk([1, 2, 3], meta)).toBeNull();
    expect(parseChunk(new ArrayBuffer(MAX_CHUNK_BYTES + 1), { ...meta, size: MAX_CHUNK_BYTES + 1 })).toBeNull();
  });

  it('rejects bad chunk metadata', () => {
    expect(parseChunk(data, null)).toBeNull();
    expect(parseChunk(data, { ...meta, hash: 'bad hash' })).toBeNull();
    expect(parseChunk(data, { ...meta, size: -1 })).toBeNull();
    expect(parseChunk(data, { ...meta, size: MAX_FILE_BYTES + 1 })).toBeNull();
    expect(parseChunk(data, { ...meta, size: '3' })).toBeNull();
    expect(parseChunk(data, { ...meta, total: 0 })).toBeNull();
    expect(parseChunk(data, { ...meta, total: 1.5 })).toBeNull();
    // More chunks than bytes can't be right, and would make us allocate a huge array.
    expect(parseChunk(data, { ...meta, total: 1_000_000 })).toBeNull();
    expect(parseChunk(data, { ...meta, index: 1 })).toBeNull();
    expect(parseChunk(data, { ...meta, index: -1 })).toBeNull();
    expect(parseChunk(data, { ...meta, index: '0' })).toBeNull();
  });
});

describe('dropMessage', () => {
  it('warns in dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    dropMessage('test reason', { kind: 'x' });
    expect(warn).toHaveBeenCalledWith('Dropped peer message: test reason', { kind: 'x' });
    warn.mockRestore();
  });
});
