// Help > About. It loads on first use (app/lazyUi.ts); the footer's version label is in footerVersion.ts.
import { returnFocusOnClose } from './focusReturn';
import { commitUrl, formatBuildDate, type BuildInfo } from '../app/buildInfo';

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

/** Wire up the About dialog in index.html and fill in the app version and commit. */
export function createAboutDialog(dialog: HTMLDialogElement, info: BuildInfo, actions: { onViewChangelog?: () => void } = {}) {
  renderVersionDetails(dialog.querySelector<HTMLElement>('#about-version')!, info);
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
