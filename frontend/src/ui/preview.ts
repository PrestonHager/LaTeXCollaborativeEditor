import { HtmlGenerator, parse } from 'latex.js';

const LATEX_JS_CDN_BASE = 'https://cdn.jsdelivr.net/npm/latex.js@0.12.6/dist/';

export function createPreviewPane(container: HTMLElement) {
  const root = document.createElement('div');
  root.className = 'preview';

  const content = document.createElement('div');
  content.className = 'preview-content';

  const loading = document.createElement('div');
  loading.className = 'preview-loading';
  loading.textContent = 'Updating preview...';

  root.appendChild(content);
  root.appendChild(loading);
  container.appendChild(root);

  let assetsInjected = false;

  const ensureAssets = (generator: HtmlGenerator) => {
    if (assetsInjected) return;
    const assets = generator.stylesAndScripts(LATEX_JS_CDN_BASE);
    document.head.appendChild(assets);
    assetsInjected = true;
  };

  return {
    async renderLatex(source: string) {
      const generator = new HtmlGenerator({ hyphenate: false });
      parse(source, { generator });
      ensureAssets(generator);
      const fragment = generator.domFragment();
      content.replaceChildren(fragment);
    },
    setLoading(isLoading: boolean) {
      root.classList.toggle('is-loading', isLoading);
    },
  };
}
