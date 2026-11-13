import { createChangelogDialog } from './changelogDialog';
import { renderChangelog, CHANGELOG_TEXT } from './changelogView';
import { createAboutDialog } from './aboutDialog';
import { mountAppShell } from '../test/appShell';

// jsdom has no showModal, so stand in for it and fire close like a browser does.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

const SAMPLE = `# Changelog

## [Unreleased]

### Added

- **New thing.** With \`code\`.

## [0.1.0] - 2026-11-13

### Added

- First release. <b>not bold</b>

## [0.2.0] - 2026-12-01

- Second release.

[Unreleased]: https://github.com/PrestonHager/LaTeXCollaborativeEditor/compare/v0.2.0...HEAD
[0.1.0]: https://github.com/PrestonHager/LaTeXCollaborativeEditor/releases/tag/v0.1.0
`;

const sampleView = { renderChangelog: (el: HTMLElement, version: string) => renderChangelog(el, version, SAMPLE) };

function setup(version = '0.1.0', load: () => Promise<typeof sampleView> = async () => sampleView) {
  mountAppShell();
  const el = document.getElementById('changelog-dialog') as HTMLDialogElement;
  const dialog = createChangelogDialog(el, { version, load });
  const body = document.getElementById('changelog-body')!;
  return { el, dialog, body };
}

describe('renderChangelog', () => {
  it('shows Unreleased first, then versions newest first, with dates', () => {
    const el = document.createElement('div');
    renderChangelog(el, '0.1.0', SAMPLE);
    const titles = [...el.querySelectorAll('.changelog-release h3')].map((h) => h.textContent);
    expect(titles).toEqual(['Unreleased (in this build)', '0.2.0', '0.1.0']);
    const dates = [...el.querySelectorAll('time')].map((t) => t.getAttribute('datetime'));
    expect(dates).toEqual(['2026-12-01', '2026-11-13']);
  });

  it("marks the running version as \"You're on this version\"", () => {
    const el = document.createElement('div');
    renderChangelog(el, '0.1.0', SAMPLE);
    const current = el.querySelectorAll('.changelog-release.is-current');
    expect(current.length).toBe(1);
    expect((current[0] as HTMLElement).dataset.version).toBe('0.1.0');
    expect(current[0].querySelector('.changelog-current')!.textContent).toBe("You're on this version");
  });

  it('marks nothing for a dev build or Unreleased', () => {
    const el = document.createElement('div');
    renderChangelog(el, 'dev', SAMPLE);
    expect(el.querySelector('.is-current')).toBeNull();
    renderChangelog(el, 'Unreleased', SAMPLE);
    expect(el.querySelector('.is-current')).toBeNull();
  });

  it('links release headings to their definitions and keeps HTML as text', () => {
    const el = document.createElement('div');
    renderChangelog(el, '0.1.0', SAMPLE);
    const [unreleased, second, first] = [...el.querySelectorAll('.changelog-release h3')];
    expect(unreleased.querySelector('a')!.href).toContain('/compare/v0.2.0...HEAD');
    expect(second.querySelector('a')).toBeNull();
    expect(first.querySelector('a')!.target).toBe('_blank');
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toContain('<b>not bold</b>');
    expect(el.querySelector('.changelog-release h4')!.textContent).toBe('Added');
  });

  it('says so when the file has no releases', () => {
    const el = document.createElement('div');
    renderChangelog(el, '0.1.0', '# Changelog\n');
    expect(el.textContent).toBe('The changelog is empty.');
  });

  it('renders the real CHANGELOG.md from the repo root', () => {
    const el = document.createElement('div');
    renderChangelog(el, '0.1.0');
    expect(CHANGELOG_TEXT).toContain('## [Unreleased]');
    expect(el.querySelector('.changelog-release h3')!.textContent).toBe('Unreleased (in this build)');
    expect(el.querySelector('.is-current h3')!.textContent).toBe('0.1.0');
    // No reference definitions leak into the text.
    expect(el.textContent).not.toMatch(/\[Unreleased\]:/);
  });
});

describe('createChangelogDialog', () => {
  it('opens, loads once, and closes from its buttons and the backdrop', async () => {
    const load = vi.fn(async () => sampleView);
    const { el, dialog, body } = setup('0.1.0', load);
    await dialog.open();
    expect(el.open).toBe(true);
    expect(dialog.isOpen()).toBe(true);
    expect(body.getAttribute('aria-busy')).toBeNull();
    expect(body.querySelector('.is-current h3')!.textContent).toBe('0.1.0');
    (document.getElementById('changelog-done') as HTMLButtonElement).click();
    expect(el.open).toBe(false);

    await dialog.open();
    (document.getElementById('changelog-close') as HTMLButtonElement).click();
    expect(el.open).toBe(false);

    await dialog.open();
    // A click that started inside the box and ended on the backdrop doesn't close it.
    body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el.open).toBe(true);
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el.open).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shows a loading message, then an error it can retry from', async () => {
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return sampleView;
    });
    const { dialog, body } = setup('0.1.0', load);
    const opening = dialog.open();
    expect(body.textContent).toBe('Loading the changelog...');
    expect(body.getAttribute('aria-busy')).toBe('true');
    await opening;
    expect(body.textContent).toMatch(/Couldn't load the changelog/);
    dialog.close();
    fail = false;
    await dialog.open();
    expect(body.querySelectorAll('.changelog-release').length).toBe(3);
  });

  it('returns focus to what opened it', async () => {
    const { dialog } = setup();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    await dialog.open();
    opener.blur();
    dialog.close();
    expect(document.activeElement).toBe(opener);
  });

  it('works with jsdom-style dialogs that have no showModal', async () => {
    const { el, dialog } = setup();
    Object.defineProperty(el, 'showModal', { value: undefined });
    Object.defineProperty(el, 'close', { value: undefined });
    await dialog.open();
    expect(el.hasAttribute('open')).toBe(true);
    dialog.close();
    expect(el.hasAttribute('open')).toBe(false);
  });

  it("keeps keys typed in it away from the app's shortcuts", async () => {
    const { dialog, body } = setup();
    await dialog.open();
    const onKey = vi.fn();
    document.addEventListener('keydown', onKey);
    body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }));
    document.removeEventListener('keydown', onKey);
    expect(onKey).not.toHaveBeenCalled();
  });

  it('throws if the markup is missing', () => {
    expect(() => createChangelogDialog(document.createElement('dialog'), { version: '0.1.0' })).toThrow(/#changelog-body/);
  });

  it('loads the real lazy view by default', async () => {
    mountAppShell();
    const el = document.getElementById('changelog-dialog') as HTMLDialogElement;
    await createChangelogDialog(el, { version: '0.1.0' }).open();
    expect(el.querySelector('.changelog-release h3')!.textContent).toBe('Unreleased (in this build)');
  });

  it('opens from the About dialog, on top of it', async () => {
    const { el, dialog } = setup();
    const aboutEl = document.getElementById('about-dialog') as HTMLDialogElement;
    const about = createAboutDialog(aboutEl, { version: '0.1.0', commit: 'abc1234', builtAt: '' }, { onViewChangelog: () => void dialog.open() });
    about.open();
    const button = document.getElementById('about-changelog') as HTMLButtonElement;
    expect(button.hidden).toBe(false);
    button.focus();
    button.click();
    await vi.waitFor(() => expect(el.querySelector('.is-current')).not.toBeNull());
    expect(el.open).toBe(true);
    expect(aboutEl.open).toBe(true);
    dialog.close();
    expect(document.activeElement).toBe(button);
  });

  it('hides View changelog when About has nothing to open', () => {
    mountAppShell();
    createAboutDialog(document.getElementById('about-dialog') as HTMLDialogElement, { version: '0.1.0', commit: 'dev', builtAt: '' });
    expect((document.getElementById('about-changelog') as HTMLButtonElement).hidden).toBe(true);
  });
});
