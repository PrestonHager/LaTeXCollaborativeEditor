import { createPreviewPane, PREVIEW_SANDBOX } from './preview';

describe('createPreviewPane', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('sandboxes the iframe without allow-same-origin', () => {
    createPreviewPane(document.body);
    const frame = document.querySelector('iframe')!;
    const flags = (frame.getAttribute('sandbox') ?? '').split(/\s+/);
    expect(frame.hasAttribute('sandbox')).toBe(true);
    expect(flags).not.toContain('allow-same-origin');
    expect(flags).toContain('allow-scripts');
    expect(frame.getAttribute('sandbox')).toBe(PREVIEW_SANDBOX);
  });

  it('renders html through srcdoc and toggles loading', async () => {
    const pane = createPreviewPane(document.body);
    const frame = document.querySelector('iframe')!;
    await pane.renderHtml('<p>hi</p>');
    expect(frame.srcdoc).toBe('<p>hi</p>');

    const root = document.querySelector('.preview')!;
    pane.setLoading(true);
    expect(root.classList.contains('is-loading')).toBe(true);
    pane.setLoading(false);
    expect(root.classList.contains('is-loading')).toBe(false);
  });
});
