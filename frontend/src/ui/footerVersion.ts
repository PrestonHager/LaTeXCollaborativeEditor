// The version label in the page footer. Kept apart from the About dialog, which loads on first use.
import { commitUrl, formatBuildDate, type BuildInfo } from '../app/buildInfo';

/** Fill the small footer label: "v0.1.0", linked to the commit, with the full build in the tooltip. */
export function renderFooterVersion(link: HTMLAnchorElement, info: BuildInfo) {
  link.textContent = info.version === 'dev' ? 'dev build' : `v${info.version}`;
  const url = commitUrl(info.commit);
  if (url) link.href = url;
  else link.removeAttribute('href');
  const date = formatBuildDate(info.builtAt);
  const label = [`Version ${info.version}`, info.commit !== 'dev' ? `commit ${info.commit}` : '', date ? `built ${date}` : '']
    .filter(Boolean)
    .join(', ');
  link.title = label;
  link.setAttribute('aria-label', label);
}
