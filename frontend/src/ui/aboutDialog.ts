// Help > About. It loads on first use (app/lazyUi.ts); the footer's version label is in footerVersion.ts.
import { returnFocusOnClose } from './focusReturn';
import { commitUrl, formatBuildDate, type BuildInfo } from '../app/buildInfo';
import { REPO_URL } from './issueLinks';

/** The project's license (LICENSE at the repo root, docs/licensing.md). */
export const LICENSE_ID = 'GPL-3.0-or-later';
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
/** Written next to index.html by scripts/third-party-notices.mjs at build time. */
export const THIRD_PARTY_NOTICES_URL = './third-party-licenses.txt';

/** Make a link that opens in a new tab, like the other external links in the app. */
function externalLink(doc: Document, href: string, text: string): HTMLAnchorElement {
  const link = doc.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = text;
  return link;
}

/** Fill a container with "0.1.0 (commit abc1234, built 2026-11-13)", the commit linked to GitHub. */
export function renderVersionDetails(container: HTMLElement, info: BuildInfo) {
  const doc = container.ownerDocument;
  container.replaceChildren(doc.createTextNode(info.version));
  const url = commitUrl(info.commit);
  const date = formatBuildDate(info.builtAt);
  if (!url && !date) return;
  container.append(' (');
  if (url) {
    container.append('commit ', externalLink(doc, url, info.commit));
    if (date) container.append(', ');
  }
  if (date) container.append(`built ${date}`);
  container.append(')');
}

/**
 * Add "Free software under GPL-3.0-or-later (third-party licenses)" after the version line.
 * It's built here rather than in index.html so its bytes load with this lazy chunk.
 */
export function renderLicenseLine(body: HTMLElement) {
  const doc = body.ownerDocument;
  body.querySelector('.about-license')?.remove();
  const line = doc.createElement('p');
  line.className = 'about-license';
  line.append('Free software under ', externalLink(doc, LICENSE_URL, LICENSE_ID), ' (', externalLink(doc, THIRD_PARTY_NOTICES_URL, 'third-party licenses'), ')');
  const version = body.querySelector('#about-version')?.closest('p');
  if (version) version.after(line);
  else body.prepend(line);
}

/** Wire up the About dialog in index.html and fill in the app version and commit. */
export function createAboutDialog(dialog: HTMLDialogElement, info: BuildInfo, actions: { onViewChangelog?: () => void } = {}) {
  renderVersionDetails(dialog.querySelector<HTMLElement>('#about-version')!, info);
  renderLicenseLine(dialog.querySelector<HTMLElement>('.about-dialog-body') ?? dialog);
  const focusReturn = returnFocusOnClose(dialog);
  const close = () => dialog.close();
  dialog.querySelector('#about-done')!.addEventListener('click', close);
  dialog.querySelector('#about-close')!.addEventListener('click', close);
  // The changelog opens on top of About, so closing it lands back on this button.
  const changelogButton = dialog.querySelector<HTMLButtonElement>('#about-changelog');
  if (changelogButton) {
    changelogButton.hidden = !actions.onViewChangelog;
    changelogButton.addEventListener('click', () => actions.onViewChangelog?.());
  }
  // Clicking the dark area outside the box closes it, like the other dialogs.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  return {
    open() {
      focusReturn.remember();
      dialog.showModal();
    },
    close,
  };
}
