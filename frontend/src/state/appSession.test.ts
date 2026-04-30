import { readAppSessionState, writeAppSessionState } from './appSession';

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
      editorTheme: 'system',
      previewTheme: 'system',
    });

    const loaded = readAppSessionState();
    expect(loaded).not.toBeNull();
    expect(loaded?.documentName).toBe('Draft');
    expect(loaded?.content).toBe('hello');
    expect(loaded?.providerMode).toBe('drive');
    expect(loaded?.saveNowEnabled).toBe(false);
  });

  it('returns null for malformed payload', () => {
    localStorage.setItem('latex_editor_app_session_v1', JSON.stringify({ nope: true }));
    expect(readAppSessionState()).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    localStorage.setItem('latex_editor_app_session_v1', '{');
    expect(readAppSessionState()).toBeNull();
  });

  it('falls back to system themes when stored theme values are invalid', () => {
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
    expect(loaded?.editorTheme).toBe('system');
    expect(loaded?.previewTheme).toBe('system');
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

  it('writeAppSessionState fills default themes when omitted', () => {
    writeAppSessionState({
      documentName: 'n',
      content: 'c',
      providerMode: 'local',
      saveNowEnabled: false,
    });
    const raw = JSON.parse(localStorage.getItem('latex_editor_app_session_v1')!);
    expect(raw.editorTheme).toBe('system');
    expect(raw.previewTheme).toBe('system');
  });
});
