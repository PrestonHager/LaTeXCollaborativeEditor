import { createDocumentId, decodeYjsState, encodeYjsState, readAppSessionState, writeAppSessionState } from './appSession';

describe('appSession state', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writes and reads session state', () => {
    writeAppSessionState({
      documentName: 'Draft',
      content: 'hello',
      providerMode: 'drive',
      saveNowEnabled: false,
    });

    const loaded = readAppSessionState();
    expect(loaded).not.toBeNull();
    expect(loaded?.documentName).toBe('Draft');
    expect(loaded?.content).toBe('hello');
    expect(loaded?.providerMode).toBe('drive');
    expect(loaded?.saveNowEnabled).toBe(false);
  });

  it('keeps the document id, and leaves it out for older sessions', () => {
    writeAppSessionState({
      documentName: 'Draft',
      documentId: 'doc-1',
      content: '',
      providerMode: 'local',
      saveNowEnabled: true,
    });
    expect(readAppSessionState()?.documentId).toBe('doc-1');

    localStorage.setItem(
      'latex_editor_app_session_v1',
      JSON.stringify({ documentName: 'x', content: '', providerMode: 'local', saveNowEnabled: true }),
    );
    expect(readAppSessionState()?.documentId).toBeUndefined();
  });

  it('makes a different document id each time, even without crypto.randomUUID', () => {
    expect(createDocumentId()).not.toBe(createDocumentId());
    vi.stubGlobal('crypto', {});
    try {
      expect(createDocumentId()).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns null for malformed payload', () => {
    localStorage.setItem('latex_editor_app_session_v1', JSON.stringify({ nope: true }));
    expect(readAppSessionState()).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    localStorage.setItem('latex_editor_app_session_v1', '{');
    expect(readAppSessionState()).toBeNull();
  });

  it('ignores the theme fields older builds stored here, since themes are settings now', () => {
    localStorage.setItem(
      'latex_editor_app_session_v1',
      JSON.stringify({
        documentName: 'x',
        content: 'y',
        providerMode: 'local',
        saveNowEnabled: true,
        editorTheme: 'not-a-theme',
        previewTheme: 'also-invalid',
        updatedAt: 42,
      }),
    );
    const loaded = readAppSessionState();
    expect(loaded).not.toHaveProperty('editorTheme');
    expect(loaded).not.toHaveProperty('previewTheme');
    expect(loaded?.updatedAt).toBe(42);
  });

  it('defaults updatedAt when missing from stored payload', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(9001);
    localStorage.setItem(
      'latex_editor_app_session_v1',
      JSON.stringify({
        documentName: 'x',
        content: 'y',
        providerMode: 'local',
        saveNowEnabled: true,
        editorTheme: 'dark',
        previewTheme: 'light',
      }),
    );
    expect(readAppSessionState()?.updatedAt).toBe(9001);
    nowSpy.mockRestore();
  });

  it('writeAppSessionState leaves themes out of the session', () => {
    writeAppSessionState({
      documentName: 'n',
      content: 'c',
      providerMode: 'local',
      saveNowEnabled: false,
    });
    const raw = JSON.parse(localStorage.getItem('latex_editor_app_session_v1')!);
    expect(raw).not.toHaveProperty('editorTheme');
    expect(raw).not.toHaveProperty('previewTheme');
  });

  it('writeAppSessionState returns false instead of throwing when storage is full', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const ok = writeAppSessionState({ documentName: 'n', content: 'c', providerMode: 'local', saveNowEnabled: true });
    expect(ok).toBe('failed');
    spy.mockRestore();
  });

  it('keeps the pending-save flag only when it is set', () => {
    writeAppSessionState({ documentName: 'n', content: 'c', providerMode: 'local', saveNowEnabled: true, pendingSave: true });
    expect(readAppSessionState()?.pendingSave).toBe(true);
    writeAppSessionState({ documentName: 'n', content: 'c', providerMode: 'local', saveNowEnabled: true });
    expect(readAppSessionState()?.pendingSave).toBeUndefined();
  });

  it('round trips the host Yjs state', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const result = writeAppSessionState({
      documentName: 'n',
      content: 'c',
      providerMode: 'local',
      saveNowEnabled: true,
      yjs: { docId: 'doc-1', state: encodeYjsState(bytes) },
    });
    expect(result).toBe('full');
    const loaded = readAppSessionState();
    expect(loaded?.yjs?.docId).toBe('doc-1');
    expect(decodeYjsState(loaded!.yjs!.state)).toEqual(bytes);
  });

  it('drops a malformed Yjs state and bad base64', () => {
    localStorage.setItem(
      'latex_editor_app_session_v1',
      JSON.stringify({ documentName: 'x', content: 'y', providerMode: 'local', saveNowEnabled: true, yjs: { docId: 1 } }),
    );
    expect(readAppSessionState()?.yjs).toBeUndefined();
    expect(decodeYjsState('not base64!')).toBeNull();
  });

  it('saves the text without the Yjs state when storage is too full for both', () => {
    const realSetItem = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (value.includes('"yjs"')) throw new DOMException('full', 'QuotaExceededError');
      realSetItem.call(this, key, value);
    });
    const ok = writeAppSessionState({
      documentName: 'n',
      content: 'kept',
      providerMode: 'local',
      saveNowEnabled: true,
      yjs: { docId: 'doc-1', state: 'AAAA' },
    });
    spy.mockRestore();
    expect(ok).toBe('text-only');
    expect(readAppSessionState()?.content).toBe('kept');
    expect(readAppSessionState()?.yjs).toBeUndefined();
  });
});
