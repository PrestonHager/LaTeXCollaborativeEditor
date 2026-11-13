import { docsUrl, type HelpTopic } from './helpLinks';
import type { IssueArea } from './issueLinks';

/** What a notice links to: a docs section, and the bug form when it might be our fault. */
export type NoticeHelp = {
  topic: HelpTopic;
  /** Add a "Report this" link for this area of the app. */
  report?: IssueArea;
  /** A fixed description for the bug form. Never the raw error, since that can hold file names. */
  summary?: string;
};

/**
 * Match a status or error message to the docs that explain it. Returns null for
 * ordinary messages like "Saved", which don't need a link.
 */
export function helpForMessage(message: string): NoticeHelp | null {
  if (/storage is full/i.test(message)) {
    return { topic: 'storageFull' };
  }
  if (/popup was blocked/i.test(message)) {
    return { topic: 'popupsBlocked' };
  }
  if (/session expired|sign-in expired/i.test(message)) {
    return { topic: 'driveSignIn' };
  }
  if (/^save error/i.test(message)) {
    return { topic: 'autosave', report: 'storage', summary: 'Saving the project failed.' };
  }
  return null;
}

type NoticeOptions = {
  getDocsBase: () => string;
  /** Build the prefilled bug form link for a notice's "Report this" link. */
  getBugUrl: (help: NoticeHelp) => string;
  timeoutMs?: number;
};

export type ShowNoticeOptions = {
  isError?: boolean;
  /** Keep it up until something replaces it. */
  sticky?: boolean;
  help?: NoticeHelp | null;
};

/**
 * Wire up the notice area in the header (see #app-notice in index.html). It shows one short
 * message at a time, with optional "Learn more" and "Report this" links after it.
 */
export function createNotice(root: HTMLElement, options: NoticeOptions) {
  const text = root.querySelector<HTMLElement>('[data-notice-text]')!;
  const learn = root.querySelector<HTMLAnchorElement>('[data-notice-learn]')!;
  const report = root.querySelector<HTMLAnchorElement>('[data-notice-report]')!;
  const timeoutMs = options.timeoutMs ?? 8000;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    text.textContent = '';
    learn.hidden = true;
    report.hidden = true;
    root.classList.remove('is-error');
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const show = (message: string, opts: ShowNoticeOptions = {}) => {
    clear();
    text.textContent = message;
    root.classList.toggle('is-error', Boolean(opts.isError));
    const help = opts.help;
    if (help) {
      learn.href = docsUrl(options.getDocsBase(), help.topic);
      learn.hidden = false;
      if (help.report) {
        report.href = options.getBugUrl(help);
        report.hidden = false;
      }
    }
    // Notices with links stay up longer, so there's time to click them.
    if (opts.sticky) return;
    timer = setTimeout(clear, help ? timeoutMs * 2 : timeoutMs);
  };

  clear();
  return { show, clear, text: () => text.textContent ?? '' };
}
