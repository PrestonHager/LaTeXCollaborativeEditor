// The changelog itself and the code that draws it (issue #140). changelogDialog.ts imports this
// lazily when the dialog opens, so neither the file nor the renderer is in the initial load.
// CHANGELOG.md at the repo root is the only copy: Vite bundles it as a string here.
import changelogText from '../../../CHANGELOG.md?raw';
import { compareVersions } from '../app/buildInfo';
import { parseChangelog, renderBlocks, resolveHref, REPO_BLOB_BASE, type Release } from './changelogMarkdown';

export const CHANGELOG_TEXT: string = changelogText;

type FetchLike = (input: string, init?: RequestInit) => Promise<{ ok: boolean; text: () => Promise<string> }>;

type RenderOptions = {
  /**
   * Set when `text` is a newer deploy's changelog: Unreleased is labelled as the update's, and
   * sections newer than the running version (and an Unreleased that differs from this build's
   * bundled one) get "New in the update".
   */
  update?: boolean;
};

/** The heading text for a release: "Unreleased (in this build)" or "0.1.0". */
export function releaseTitle(release: Release, update = false): string {
  if (!release.unreleased) return release.version;
  return update ? 'Unreleased (in the update)' : 'Unreleased (in this build)';
}

/** True when a section of the deployed changelog isn't in this build. */
function isNewInUpdate(release: Release, currentVersion: string, bundledUnreleased: string | null): boolean {
  if (release.unreleased) return release.blocks.length > 0 && JSON.stringify(release.blocks) !== bundledUnreleased;
  return (compareVersions(release.version, currentVersion) ?? 0) > 0;
}

/** Draw the changelog into `container`, newest first, marking the release this build is on. */
export function renderChangelog(container: HTMLElement, currentVersion: string, text: string = CHANGELOG_TEXT, options: RenderOptions = {}) {
  const doc = container.ownerDocument;
  const { releases, links } = parseChangelog(text);
  const bundled = options.update ? parseChangelog(CHANGELOG_TEXT).releases.find((r) => r.unreleased) : undefined;
  const bundledUnreleased = bundled ? JSON.stringify(bundled.blocks) : null;
  container.replaceChildren();
  if (!releases.length) {
    const empty = doc.createElement('p');
    empty.className = 'changelog-empty';
    empty.textContent = 'The changelog is empty.';
    container.append(empty);
    return;
  }
  releases.forEach((release, index) => {
    const section = doc.createElement('section');
    section.className = 'changelog-release';
    const headingId = `changelog-release-${index}`;
    section.setAttribute('aria-labelledby', headingId);
    section.dataset.version = release.version;

    const header = doc.createElement('header');
    header.className = 'changelog-release-header';
    const h3 = doc.createElement('h3');
    h3.id = headingId;
    // The release heading links to its compare or release page when the file defines one.
    const href = links.get(release.unreleased ? 'unreleased' : release.version.toLowerCase());
    const url = href ? resolveHref(href) : null;
    if (url) {
      const a = doc.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = releaseTitle(release, options.update);
      h3.append(a);
    } else {
      h3.textContent = releaseTitle(release, options.update);
    }
    header.append(h3);
    if (release.date) {
      const date = doc.createElement('time');
      date.className = 'changelog-date';
      if (/^\d{4}-\d{2}-\d{2}$/.test(release.date)) date.dateTime = release.date;
      date.textContent = release.date;
      header.append(date);
    }
    if (!release.unreleased && release.version === currentVersion) {
      section.classList.add('is-current');
      const badge = doc.createElement('span');
      badge.className = 'badge changelog-current';
      badge.textContent = "You're on this version";
      header.append(badge);
    }
    if (options.update && isNewInUpdate(release, currentVersion, bundledUnreleased)) {
      section.classList.add('is-new');
      const badge = doc.createElement('span');
      badge.className = 'badge changelog-new';
      badge.dataset.variant = 'outline';
      badge.textContent = 'New in the update';
      header.append(badge);
    }
    section.append(header);
    renderBlocks(section, release.blocks, links, 1);
    container.append(section);
  });
}

/**
 * Fetch the new deploy's CHANGELOG.md (the build copies it next to index.html) and draw it in update mode.
 * If that fails, draw this build's copy with a note pointing at the latest one on GitHub.
 * Resolves to which one it drew.
 */
export async function renderUpdateChangelog(
  container: HTMLElement,
  currentVersion: string,
  url: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<'update' | 'fallback'> {
  try {
    const response = await fetchImpl(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('not ok');
    const text = await response.text();
    // A static host's 404 page or an SPA fallback isn't a changelog.
    if (!/^## /m.test(text)) throw new Error('not a changelog');
    renderChangelog(container, currentVersion, text, { update: true });
    return 'update';
  } catch {
    renderChangelog(container, currentVersion);
    const doc = container.ownerDocument;
    const note = doc.createElement('p');
    note.className = 'changelog-note';
    const link = doc.createElement('a');
    link.href = `${REPO_BLOB_BASE}CHANGELOG.md`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'the latest changelog on GitHub';
    note.append("Couldn't load the new version's changelog, so this is the one for the version you're on. See ", link, '.');
    container.prepend(note);
    return 'fallback';
  }
}
