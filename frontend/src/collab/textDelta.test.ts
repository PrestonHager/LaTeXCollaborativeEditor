import { applyDelta, computeSingleDelta } from './textDelta';

describe('textDelta', () => {
  it('computes insert delta', () => {
    const delta = computeSingleDelta('abc', 'abXc');
    expect(delta).toEqual({ index: 2, deleteCount: 0, insert: 'X' });
    expect(applyDelta('abc', delta!)).toBe('abXc');
  });

  it('computes delete delta', () => {
    const delta = computeSingleDelta('abc', 'ac');
    expect(delta).toEqual({ index: 1, deleteCount: 1, insert: '' });
    expect(applyDelta('abc', delta!)).toBe('ac');
  });

  it('returns null for unchanged text', () => {
    expect(computeSingleDelta('same', 'same')).toBeNull();
  });
});
