import indexHtml from '../../index.html?raw';

/** Put the real app shell from index.html into the test document, without its scripts. */
export function mountAppShell(): HTMLElement {
  const parsed = new DOMParser().parseFromString(indexHtml, 'text/html');
  parsed.querySelectorAll('script').forEach((script) => script.remove());
  document.body.innerHTML = parsed.body.innerHTML;
  return document.body;
}
