import { getBootstrapConfig } from './bootstrapConfig';

describe('getBootstrapConfig', () => {
  it('returns localhost defaults for localhost origin', () => {
    const config = getBootstrapConfig('http://localhost:5173');
    expect(config.environment).toBe('localhost');
    expect(config.rendezvous.length).toBeGreaterThan(0);
  });

  it('returns production defaults for deployed origin', () => {
    const config = getBootstrapConfig('https://latex.prestonhager.com');
    expect(config.environment).toBe('production');
    expect(config.iceServers[0].urls).toContain('stun:');
  });
});
