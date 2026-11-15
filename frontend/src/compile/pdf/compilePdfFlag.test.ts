import { isCompilePdfEnabled } from './compilePdfFlag';

describe('Compile PDF flag (#242)', () => {
  it('is on only with VITE_COMPILE_PDF=1', () => {
    expect(isCompilePdfEnabled({})).toBe(false);
    expect(isCompilePdfEnabled({ VITE_COMPILE_PDF: 'true' })).toBe(false);
    expect(isCompilePdfEnabled({ VITE_COMPILE_PDF: '1' })).toBe(true);
    // The test build doesn't set it.
    expect(isCompilePdfEnabled()).toBe(false);
  });
});
