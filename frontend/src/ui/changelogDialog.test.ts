import { createChangelogDialog } from './changelogDialog';
import { renderChangelog, renderUpdateChangelog, CHANGELOG_TEXT } from './changelogView';
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

const renderUpdate = vi.fn(async (el: HTMLElement, version: string, url: string) => {
  el.dataset.url = url;
  renderChangelog(el, version, SAMPLE, { update: true });
});
const sampleView = { renderChangelog: (el: HTMLElement, version: string) => renderChangelog(el, version, SAMPLE), renderUpdateChangelog: renderUpdate };

function setup(version = '0.1.0', load: () => Promise<typeof sampleView> = async () => sampleView) {
  mountAppShell();
  const el = document.getElementById('changelog-dialog') as HTMLDialogElement;
  const dialog = createChangelogDialog(el, { version, load, updateUrl: './CHANGELOG.md', now: () => 123 });
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

/** A deployed changelog one version ahead of the 0.1.0 build, with new Unreleased items. */
const DEPLOYED = `# Changelog

## [Unreleased]

- Something only in the update.

## [0.2.0] - 2026-12-01

- Second release.

## [0.1.0] - 2026-11-13

- First release.
`;

const respond = (text: string, ok = true) => vi.fn(async () => ({ ok, text: async () => text }));

describe('renderUpdateChangelog', () => {
  it("fetches the deployed file uncached and marks what's new in it", async () => {
    const el = document.createElement('div');
    const fetchImpl = respond(DEPLOYED);
    expect(await renderUpdateChangelog(el, '0.1.0', './CHANGELOG.md?t=1', fetchImpl)).toBe('update');
    expect(fetchImpl).toHaveBeenCalledWith('./CHANGELOG.md?t=1', { cache: 'no-store' });
    const sections = [...el.querySelectorAll<HTMLElement>('.changelog-release')];
    expect(sections.map((s) => s.querySelector('h3')!.textContent)).toEqual(['Unreleased (in the update)', '0.2.0', '0.1.0']);
    expect(sections.map((s) => s.classList.contains('is-new'))).toEqual([true, true, false]);
    expect(sections[1].querySelector('.changelog-new')!.textContent).toBe('New in the update');
    // The running version keeps its own badge.
    expect(sections[2].querySelector('.changelog-current')!.textContent).toBe("You're on this version");
    expect(el.querySelector('.changelog-note')).toBeNull();
  });

  it("doesn't mark an Unreleased section this build already has", async () => {
    const el = document.createElement('div');
    await renderUpdateChangelog(el, '0.1.0', 'x', respond(CHANGELOG_TEXT));
    expect(el.querySelector('.is-new')).toBeNull();
    expect(el.querySelector('h3')!.textContent).toBe('Unreleased (in the update)');
  });

  it('marks nothing as newer than a dev build, apart from a changed Unreleased', async () => {
    const el = document.createElement('div');
    await renderUpdateChangelog(el, 'dev', 'x', respond(DEPLOYED));
    expect([...el.querySelectorAll<HTMLElement>('.is-new')].map((s) => s.dataset.version)).toEqual(['Unreleased']);
  });

  it.each([
    ['a network error', vi.fn(async () => Promise.reject(new Error('offline')))],
    ['a 404', respond('Not found', false)],
    ['a page that is not a changelog', respond('<!doctype html><title>404</title>')],
  ])('falls back to the bundled copy and the GitHub link on %s', async (_name, fetchImpl) => {
    const el = document.createElement('div');
    expect(await renderUpdateChangelog(el, '0.1.0', 'x', fetchImpl)).toBe('fallback');
    const note = el.querySelector('.changelog-note')!;
    expect(el.firstElementChild).toBe(note);
    expect(note.textContent).toMatch(/Couldn't load the new version's changelog/);
    const link = note.querySelector('a')!;
    expect(link.href).toBe('https://github.com/PrestonHager/LaTeXCollaborativeEditor/blob/main/CHANGELOG.md');
    expect(link.target).toBe('_blank');
    expect(el.querySelector('.changelog-release h3')!.textContent).toBe('Unreleased (in this build)');
    expect(el.querySelector('.is-current h3')!.textContent).toBe('0.1.0');
  });

  it('uses the global fetch by default', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(DEPLOYED));
    const el = document.createElement('div');
    expect(await renderUpdateChangelog(el, '0.1.0', 'https://example.com/CHANGELOG.md')).toBe('update');
    expect(spy).toHaveBeenCalledWith('https://example.com/CHANGELOG.md', { cache: 'no-store' });
    spy.mockRestore();
  });
});

describe('createChangelogDialog', () => {
  it('shows the deployed changelog when opened for an update, and the bundled one from About', async () => {
    renderUpdate.mockClear();
    const { dialog, body } = setup();
    const description = document.getElementById('changelog-dialog-description')!;
    await dialog.open('update');
    expect(renderUpdate).toHaveBeenCalledWith(body, '0.1.0', './CHANGELOG.md?t=123', undefined);
    expect(body.dataset.url).toBe('./CHANGELOG.md?t=123');
    expect(description.textContent).toMatch(/new version/);
    expect(body.querySelector('h3')!.textContent).toBe('Unreleased (in the update)');
    // Each update open fetches again, in case another deploy landed.
    await dialog.open('update');
    expect(renderUpdate).toHaveBeenCalledTimes(2);
    dialog.close();
    await dialog.open();
    expect(description.textContent).toBe('Changes in each version, newest first.');
    expect(body.querySelector('h3')!.textContent).toBe('Unreleased (in this build)');
  });

  it('adds the cache-busting query after an existing one, and has defaults', async () => {
    mountAppShell();
    const el = document.getElementById('changelog-dialog') as HTMLDialogElement;
    renderUpdate.mockClear();
    await createChangelogDialog(el, { version: '0.1.0', load: async () => sampleView, updateUrl: './CHANGELOG.md?v=1', now: () => 5 }).open('update');
    expect(renderUpdate.mock.calls[0][2]).toBe('./CHANGELOG.md?v=1&t=5');
    mountAppShell();
    const el2 = document.getElementById('changelog-dialog') as HTMLDialogElement;
    await createChangelogDialog(el2, { version: '0.1.0', load: async () => sampleView }).open('update');
    expect(renderUpdate.mock.calls[1][2]).toMatch(/^CHANGELOG\.md\?t=\d+$/);
  });

  it('preloads the renderer once, and tries again after a failed load', async () => {
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return sampleView;
    });
    const { dialog, body } = setup('0.1.0', load);
    await expect(dialog.preload()).resolves.toBeUndefined();
    fail = false;
    await dialog.preload();
    await dialog.preload();
    expect(load).toHaveBeenCalledTimes(2);
    await dialog.open();
    expect(load).toHaveBeenCalledTimes(2);
    expect(body.querySelectorAll('.changelog-release').length).toBe(3);
  });

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
