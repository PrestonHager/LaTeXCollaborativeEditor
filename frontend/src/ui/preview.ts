/** Sandbox flags for the preview iframe. No allow-same-origin, so peer content can't reach the app. */
export const PREVIEW_SANDBOX = 'allow-scripts';

export function createPreviewPane(container: HTMLElement) {
  const root = document.createElement('div');
  root.className = 'preview';

  const content = document.createElement('div');
  content.className = 'preview-content';

  const frame = document.createElement('iframe');
  frame.className = 'preview-html-frame';
  frame.title = 'LaTeX preview';
  frame.setAttribute('sandbox', PREVIEW_SANDBOX);

  const loading = document.createElement('div');
  loading.className = 'preview-loading';
  loading.textContent = 'Updating preview...';

  content.appendChild(frame);
  root.appendChild(content);
  root.appendChild(loading);
  container.appendChild(root);

  return {
    /** Full HTML document from LaTeX.js (styles load from CDN inside iframe). */
    async renderHtml(html: string) {
      frame.srcdoc = html;
    },
    setLoading(isLoading: boolean) {
      root.classList.toggle('is-loading', isLoading);
    },
  };
}
