import { getBootstrapConfig, isLocalhostOrigin } from './bootstrapConfig';

describe('getBootstrapConfig', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns localhost defaults for localhost origin', () => {
    const config = getBootstrapConfig('http://localhost:5173');
    expect(config.environment).toBe('localhost');
    expect(config.rendezvous.length).toBeGreaterThan(0);
  });

  it('defaults to WebTorrent trackers for the torrent strategy', () => {
    vi.stubEnv('VITE_P2P_RENDEZVOUS', '');
    const config = getBootstrapConfig('https://latex.prestonhager.com');
    expect(config.rendezvous).toContain('wss://tracker.webtorrent.dev');
    expect(config.rendezvous.every((url) => url.startsWith('wss://'))).toBe(true);
  });

  it('returns production defaults for deployed origin', () => {
    const config = getBootstrapConfig('https://latex.prestonhager.com');
    expect(config.environment).toBe('production');
    expect(config.iceServers[0].urls).toContain('stun:');
  });

  it('uses custom rendezvous CSV when VITE_P2P_RENDEZVOUS is set', () => {
    vi.stubEnv('VITE_P2P_RENDEZVOUS', 'wss://a.example, wss://b.example');
    const config = getBootstrapConfig('http://localhost:5173');
    expect(config.rendezvous).toEqual(['wss://a.example', 'wss://b.example']);
  });

  it('adds TURN server when all TURN env vars are set', () => {
    vi.stubEnv('VITE_TURN_URL', 'turns:turn.example:5349');
    vi.stubEnv('VITE_TURN_USERNAME', 'u');
    vi.stubEnv('VITE_TURN_CREDENTIAL', 'p');
    const config = getBootstrapConfig('https://example.com');
    expect(config.iceServers).toHaveLength(2);
    expect(config.iceServers[1]).toMatchObject({
      urls: 'turns:turn.example:5349',
      username: 'u',
      credential: 'p',
    });
  });

  it('omits TURN when any TURN credential piece is missing', () => {
    vi.stubEnv('VITE_TURN_URL', 'turn:only-url');
    vi.stubEnv('VITE_TURN_USERNAME', '');
    vi.stubEnv('VITE_TURN_CREDENTIAL', 'secret');
    const config = getBootstrapConfig('https://example.com');
    expect(config.iceServers).toHaveLength(1);
  });

  it('uses custom STUN and app id from env', () => {
    vi.stubEnv('VITE_STUN_URL', 'stun:custom:3478');
    vi.stubEnv('VITE_P2P_APP_ID', 'my-app');
    const config = getBootstrapConfig('http://localhost:5173');
    expect(config.iceServers[0].urls).toBe('stun:custom:3478');
    expect(config.appId).toBe('my-app');
  });
});

describe('isLocalhostOrigin', () => {
  it.each(['http://localhost:5173', 'http://127.0.0.1:4173', 'http://127.1.2.3', 'http://[::1]:5173', 'http://app.localhost:5173'])(
    'treats %s as localhost',
    (origin) => {
      expect(isLocalhostOrigin(origin)).toBe(true);
      expect(getBootstrapConfig(origin).environment).toBe('localhost');
    },
  );

  it.each([
    'https://latex.prestonhager.com',
    'https://localhost.evil.example',
    'https://evil.example/?localhost',
    'http://127.0.0.1.evil.example',
    'not a url',
  ])('treats %s as production', (origin) => {
    expect(isLocalhostOrigin(origin)).toBe(false);
    expect(getBootstrapConfig(origin).environment).toBe('production');
  });
});
