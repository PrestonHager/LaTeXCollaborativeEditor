/**
 * Every place in the app that links to the docs goes through this table, so links don't
 * scatter around and go stale. Paths are relative to the docs base (MkDocs directory URLs).
 * NOTE: only link to pages the docs actually have. helpLinks.test.ts checks the list.
 */
export const helpLinks = {
  gettingStarted: 'getting-started/',
  editing: 'editing-and-preview/',
  preview: 'editing-and-preview/#live-preview',
  diagnostics: 'editing-and-preview/#diagnostics',
  collaboration: 'collaboration/',
  share: 'collaboration/#share-button',
  connection: 'collaboration/#connection-status',
  saving: 'saving-and-storage/',
  autosave: 'saving-and-storage/#autosave-and-save-now',
  drive: 'saving-and-storage/#google-drive',
  localStorage: 'saving-and-storage/#local-storage-browser',
  projects: 'projects/',
  fileTree: 'projects/#file-tree',
  uploading: 'projects/#uploading-files',
  mainFile: 'projects/#main-file',
  interface: 'interface-layout/',
  settings: 'interface-layout/#settings',
  commandPalette: 'interface-layout/#command-palette',
  shortcuts: 'keyboard-shortcuts/',
  troubleshooting: 'troubleshooting/',
  p2pProblems: 'troubleshooting/#p2p-connection-problems',
  driveSignIn: 'troubleshooting/#drive-sign-in',
  popupsBlocked: 'troubleshooting/#popups-blocked',
  storageFull: 'troubleshooting/#storage-full',
  previewErrors: 'troubleshooting/#preview-errors',
  faq: 'faq/',
  supported: 'whats-supported/',
  howItFits: 'how-it-fits/',
} as const;

export type HelpTopic = keyof typeof helpLinks;

export const isHelpTopic = (value: string): value is HelpTopic => Object.hasOwn(helpLinks, value);

type DocsEnv = { VITE_DOCS_BASE_URL?: string; DEV?: boolean };

/** The docs base URL. MkDocs `serve` in dev, same-origin `docs/` in production, unless the env overrides it. */
export function documentationBaseUrl(env: DocsEnv, pageHref: string): string {
  const fromEnv = env.VITE_DOCS_BASE_URL?.trim();
  if (fromEnv) return fromEnv.endsWith('/') ? fromEnv : `${fromEnv}/`;
  if (env.DEV) return 'http://127.0.0.1:8000/';
  return new URL('docs/', pageHref).href;
}

/** Full URL of the docs page for a topic. */
export function docsUrl(base: string, topic: HelpTopic): string {
  return `${base}${helpLinks[topic]}`;
}

/**
 * Point every `[data-help]` link under root at its docs page. The markup lives in index.html,
 * so this only fills in the href and makes sure it opens in a new tab.
 */
export function wireHelpLinks(root: ParentNode, base: string) {
  root.querySelectorAll<HTMLAnchorElement>('a[data-help]').forEach((link) => {
    const topic = link.dataset.help ?? '';
    if (!isHelpTopic(topic)) {
      console.warn(`Unknown help topic "${topic}"`);
      return;
    }
    link.href = docsUrl(base, topic);
    link.target = '_blank';
    link.rel = 'noreferrer';
  });
}
