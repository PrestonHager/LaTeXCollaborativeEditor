import { applyDelta, computeSingleDelta } from './textDelta';

describe('textDelta', () => {
  it('computes and applies insert patch', () => {
    const delta = computeSingleDelta('abc', 'abXc');
    expect(typeof delta).toBe('string');
    expect(delta).toContain('ab');
    expect(applyDelta('abc', delta!)).toBe('abXc');
  });

  it('computes and applies delete patch', () => {
    const delta = computeSingleDelta('abc', 'ac');
    expect(typeof delta).toBe('string');
    expect(delta).toContain('-b');
    expect(applyDelta('abc', delta!)).toBe('ac');
  });

  it('returns null for unchanged text', () => {
    expect(computeSingleDelta('same', 'same')).toBeNull();
  });
});
