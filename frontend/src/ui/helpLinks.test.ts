import { docsUrl, documentationBaseUrl, helpLinks, isHelpTopic, wireHelpLinks } from './helpLinks';
import { mountAppShell } from '../test/appShell';

// The docs pages and anchors we've agreed exist. Only add one here once the docs have it.
const DOCS_CONTRACT = [
  'getting-started/',
  'editing-and-preview/',
  'editing-and-preview/#live-preview',
  'editing-and-preview/#diagnostics',
  'collaboration/',
  'collaboration/#share-button',
  'collaboration/#connection-status',
  'saving-and-storage/',
  'saving-and-storage/#autosave-and-save-now',
  'saving-and-storage/#google-drive',
  'saving-and-storage/#local-storage-browser',
  'saving-and-storage/#export',
  'projects/',
  'projects/#file-tree',
  'projects/#uploading-files',
  'projects/#main-file',
  'interface-layout/',
  'interface-layout/#settings',
  'interface-layout/#command-palette',
  'keyboard-shortcuts/',
  'troubleshooting/',
  'troubleshooting/#p2p-connection-problems',
  'troubleshooting/#drive-sign-in',
  'troubleshooting/#popups-blocked',
  'troubleshooting/#storage-full',
  'troubleshooting/#preview-errors',
  'faq/',
  'whats-supported/',
  'how-it-fits/',
];

describe('help links table', () => {
  it('only links to docs pages in the contract', () => {
    for (const [topic, path] of Object.entries(helpLinks)) {
      expect(DOCS_CONTRACT, `${topic} -> ${path}`).toContain(path);
    }
  });

  it('only uses known topics in index.html', () => {
    mountAppShell();
    const topics = Array.from(document.querySelectorAll<HTMLElement>('[data-help]')).map((el) => el.dataset.help ?? '');
    expect(topics.length).toBeGreaterThan(5);
    for (const topic of topics) expect(isHelpTopic(topic), topic).toBe(true);
  });

  it('puts help links on the share area, storage dialogs, preview, and settings', () => {
    mountAppShell();
    const topicIn = (selector: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(`${selector} [data-help]`)).map((el) => el.dataset.help);
    expect(topicIn('#share-area')).toContain('share');
    expect(topicIn('#projects-dialog')).toEqual(expect.arrayContaining(['localStorage', 'drive']));
    expect(topicIn('#preview-pane')).toContain('preview');
    expect(topicIn('.footer')).toContain('diagnostics');
    expect(topicIn('#settings-dialog')).toContain('settings');
    expect(topicIn('#export-dialog')).toContain('exporting');
  });

  it('gives every icon-only help link a label and a tooltip', () => {
    mountAppShell();
    const iconLinks = document.querySelectorAll<HTMLElement>('.help-link');
    expect(iconLinks.length).toBeGreaterThan(0);
    iconLinks.forEach((link) => {
      expect(link.getAttribute('aria-label')).toBeTruthy();
      expect(link.dataset.tooltip).toBeTruthy();
    });
  });

  it('builds the docs base from the env or the page', () => {
    expect(documentationBaseUrl({ VITE_DOCS_BASE_URL: ' https://docs.example.com ' }, 'https://app.test/')).toBe('https://docs.example.com/');
    expect(documentationBaseUrl({ VITE_DOCS_BASE_URL: 'https://docs.example.com/x/' }, 'https://app.test/')).toBe('https://docs.example.com/x/');
    expect(documentationBaseUrl({ DEV: true }, 'https://app.test/')).toBe('http://127.0.0.1:8000/');
    expect(documentationBaseUrl({}, 'https://app.test/editor/?room=abc')).toBe('https://app.test/editor/docs/');
  });

  it('fills in hrefs for data-help links and skips unknown topics', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    document.body.innerHTML = '<a data-help="share">a</a><a data-help="nope">b</a>';
    wireHelpLinks(document, 'https://docs.test/');
    const [good, bad] = Array.from(document.querySelectorAll('a'));
    expect(good.href).toBe(docsUrl('https://docs.test/', 'share'));
    expect(good.href).toBe('https://docs.test/collaboration/#share-button');
    expect(good.target).toBe('_blank');
    expect(good.rel).toBe('noreferrer');
    expect(bad.hasAttribute('href')).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
