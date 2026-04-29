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
});
