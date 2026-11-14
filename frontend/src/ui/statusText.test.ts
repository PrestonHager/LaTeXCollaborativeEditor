import { connectionFailed, connectionText, isSavedStatus, saveStatusText } from './statusText';

describe('connectionText', () => {
  it('says who is connected', () => {
    expect(connectionText({ isHost: true, inRoom: false, state: 'Not sharing', peers: 0 })).toBe('Not shared');
    expect(connectionText({ isHost: true, inRoom: true, state: 'Connected', peers: 1 })).toBe('Connected with 1 other person');
    expect(connectionText({ isHost: false, inRoom: true, state: 'Connected', peers: 3 })).toBe('Connected with 3 other people');
    expect(connectionText({ isHost: false, inRoom: true, state: 'Relayed', peers: 2 })).toBe('Connected with 2 other people (relayed)');
  });

  it("doesn't call it a failure when nobody has joined the host yet", () => {
    for (const state of ['Waiting for peers', 'Reconnecting'] as const) {
      const info = { isHost: true, inRoom: true, state, peers: 0 };
      expect(connectionText(info)).toBe('Shared, waiting for others');
      expect(connectionFailed(info)).toBe(false);
    }
  });

  it('tells guests when the host is out of reach', () => {
    const info = { isHost: false, inRoom: true, state: 'Reconnecting' as const, peers: 0 };
    expect(connectionText(info)).toBe("Can't reach the host");
    expect(connectionFailed(info)).toBe(true);
    expect(connectionText({ ...info, state: 'Waiting for peers' })).toBe('Looking for the host');
    expect(connectionFailed({ ...info, state: 'Waiting for peers' })).toBe(false);
    expect(connectionFailed({ ...info, peers: 1 })).toBe(false);
  });
});

describe('connectionText without WebRTC', () => {
  it("says this window can't connect, for hosts and guests (issue #205)", () => {
    expect(connectionText({ isHost: true, inRoom: false, state: 'Not sharing', peers: 0, noWebRtc: true })).toBe("Can't connect in this window");
    expect(connectionText({ isHost: false, inRoom: false, state: 'Not sharing', peers: 0, noWebRtc: true })).toBe("Can't connect in this window");
    expect(connectionFailed({ isHost: false, inRoom: false, state: 'Not sharing', peers: 0, noWebRtc: true })).toBe(false);
  });
});

describe('saveStatusText', () => {
  it('adds the time to saved statuses only', () => {
    const at = new Date(2026, 0, 5, 15, 41);
    expect(saveStatusText('Saved to Browser storage', at, 'en-US')).toBe('Saved to Browser storage at 3:41 PM');
    expect(saveStatusText('Saved', at, 'en-US')).toBe('Saved at 3:41 PM');
    expect(saveStatusText('Saving pending', at, 'en-US')).toBe('Saving pending');
    expect(saveStatusText('Saved on host local storage', at, 'en-US')).toBe('Saved on host local storage');
    expect(saveStatusText('Saved to Drive', null)).toBe('Saved to Drive');
  });

  it('spots saved statuses', () => {
    expect(isSavedStatus('Saved to Google Drive')).toBe(true);
    expect(isSavedStatus('Saved on host Google Drive')).toBe(false);
    expect(isSavedStatus('Save Error: nope')).toBe(false);
  });
});
