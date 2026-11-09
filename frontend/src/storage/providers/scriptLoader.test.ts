import { loadScript, resetScriptLoader } from './scriptLoader';

describe('loadScript', () => {
  beforeEach(() => {
    resetScriptLoader();
    document.head.innerHTML = '';
  });

  it('adds the tag once and shares the pending load', async () => {
    const first = loadScript('https://example.test/a.js');
    const second = loadScript('https://example.test/a.js');
    expect(first).toBe(second);
    const tags = document.head.querySelectorAll('script[src="https://example.test/a.js"]');
    expect(tags).toHaveLength(1);
    (tags[0] as HTMLScriptElement).onload?.(new Event('load'));
    await expect(first).resolves.toBeUndefined();
  });

  it('rejects with a readable message and allows a retry', async () => {
    const attempt = loadScript('https://example.test/b.js', 'thing B');
    const tag = document.head.querySelector('script') as HTMLScriptElement;
    tag.onerror?.(new Event('error'));
    await expect(attempt).rejects.toThrow('Could not load thing B');
    expect(document.head.querySelector('script')).toBeNull();
    const retry = loadScript('https://example.test/b.js');
    expect(retry).not.toBe(attempt);
    (document.head.querySelector('script') as HTMLScriptElement).onload?.(new Event('load'));
    await retry;
  });
});
