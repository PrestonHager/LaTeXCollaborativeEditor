import { joinRoom } from '@trystero-p2p/torrent';
import { P2pTransport, prepareRtc } from './p2pTransport';
import type { BootstrapConfig } from './bootstrapConfig';

// The desktop app's WebRTC stand-in (#176): only where the window has no RTCPeerConnection and the
// shell offers its own, and then Trystero gets it as rtcPolyfill.

const room = { makeAction: vi.fn(() => ({ send: vi.fn(async () => {}), onMessage: undefined })), getPeers: () => ({}), leave: vi.fn(async () => {}) };
vi.mock('@trystero-p2p/torrent', () => ({ joinRoom: vi.fn(() => room), selfId: 'self' }));

class FakePolyfill {}
const nativeRtcPeerConnection = vi.fn(async () => FakePolyfill);
vi.mock('./nativeRtc', () => ({ nativeRtcPeerConnection: () => nativeRtcPeerConnection() }));

const bootstrap: BootstrapConfig = { appId: 'a', environment: 'localhost', rendezvous: ['wss://t'], iceServers: [] };
const config = () => (joinRoom as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];

describe('prepareRtc', () => {
  it('leaves browsers and the desktop app with real WebRTC alone', async () => {
    await prepareRtc({ RTCPeerConnection: class {}, __LCE_DESKTOP__: { nativeRtc: true } });
    await prepareRtc({});
    await prepareRtc({ __LCE_DESKTOP__: { nativeRtc: false } });
    expect(nativeRtcPeerConnection).not.toHaveBeenCalled();
    new P2pTransport(bootstrap, { onMessage: vi.fn(), onState: vi.fn(), onPeerCount: vi.fn(), onPeerJoin: vi.fn() }).join('room');
    expect(config()).not.toHaveProperty('rtcPolyfill');
  });

  it('gives Trystero the shell stand-in where the webview has no WebRTC, loaded once', async () => {
    const linuxApp = { __LCE_DESKTOP__: { nativeRtc: true } };
    await prepareRtc(linuxApp);
    await prepareRtc(linuxApp);
    expect(nativeRtcPeerConnection).toHaveBeenCalledTimes(1);
    new P2pTransport(bootstrap, { onMessage: vi.fn(), onState: vi.fn(), onPeerCount: vi.fn(), onPeerJoin: vi.fn() }).join('room');
    expect(config().rtcPolyfill).toBe(FakePolyfill);
  });
});
