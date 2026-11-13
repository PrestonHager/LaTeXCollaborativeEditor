// The changelog itself and the code that draws it (issue #140). changelogDialog.ts imports this
// lazily when the dialog opens, so neither the file nor the renderer is in the initial load.
// CHANGELOG.md at the repo root is the only copy: Vite bundles it as a string here.
import changelogText from '../../../CHANGELOG.md?raw';
import { parseChangelog, renderBlocks, resolveHref, type Release } from './changelogMarkdown';

export const CHANGELOG_TEXT: string = changelogText;

/** The heading text for a release: "Unreleased (in this build)" or "0.1.0". */
export function releaseTitle(release: Release): string {
  return release.unreleased ? 'Unreleased (in this build)' : release.version;
}

/** Draw the changelog into `container`, newest first, marking the release this build is on. */
export function renderChangelog(container: HTMLElement, currentVersion: string, text: string = CHANGELOG_TEXT) {
  const doc = container.ownerDocument;
  const { releases, links } = parseChangelog(text);
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
      a.textContent = releaseTitle(release);
      h3.append(a);
    } else {
      h3.textContent = releaseTitle(release);
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
    section.append(header);
    renderBlocks(section, release.blocks, links, 1);
    container.append(section);
  });
}
