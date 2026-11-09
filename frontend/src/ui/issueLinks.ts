export const REPO_URL = 'https://github.com/PrestonHager/LaTeXCollaborativeEditor';

/** Options of the "Area" dropdown in .github/ISSUE_TEMPLATE. They have to match the form exactly. */
export const issueAreas = {
  collaboration: 'Collaboration (P2P sync, rooms)',
  storage: 'Storage (local saving, autosave, Google Drive)',
  signIn: 'Sign-in (Google account)',
  preview: 'Preview (LaTeX rendering, diagnostics)',
  editor: 'Editor (typing, undo, shortcuts)',
  ui: 'UI (menus, layout, accessibility)',
} as const;

export type IssueArea = keyof typeof issueAreas;

export type BugReportInfo = {
  appVersion: string;
  userAgent: string;
  hostname: string;
  /** Which part of the app the report is about, when we know. */
  area?: IssueArea;
  /** A fixed, short description of what went wrong. Never put document text, file names, or room ids here. */
  summary?: string;
};

/** Turn a user agent string into something like "Firefox 132 on Windows". */
export function describeBrowser(userAgent: string): string {
  // Order matters: Edge and Opera say Chrome too, and Chrome says Safari.
  const browsers: [string, RegExp][] = [
    ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/],
    ['Opera', /OPR\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
    ['Safari', /Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari/],
  ];
  const systems: [string, RegExp][] = [
    ['iOS', /iPhone|iPad|iPod/],
    ['Android', /Android/],
    ['ChromeOS', /CrOS/],
    ['Windows', /Windows/],
    ['macOS', /Mac OS X|Macintosh/],
    ['Linux', /Linux/],
  ];
  const browser = browsers.map(([name, re]) => {
    const match = re.exec(userAgent);
    return match ? `${name} ${match[1]}` : null;
  }).find(Boolean) ?? 'Unknown browser';
  const system = systems.find(([, re]) => re.test(userAgent))?.[0] ?? 'unknown OS';
  return `${browser} on ${system}`;
}

/** Pick the "Where are you running it?" option without sending the hostname itself. */
function whereOption(hostname: string): string {
  if (hostname === 'latex.prestonhager.com') return 'Hosted site (latex.prestonhager.com)';
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return 'Local dev server';
  return 'Other';
}

/**
 * Link to the bug report form with browser, OS, and app version filled in.
 * The person still sees the whole form and submits it themselves.
 */
export function bugReportUrl(info: BugReportInfo): string {
  const params = new URLSearchParams({ template: 'bug_report.yml' });
  params.set('browser', describeBrowser(info.userAgent));
  params.set('where', whereOption(info.hostname));
  params.set('extra', `App version: ${info.appVersion}`);
  if (info.area) params.set('area', issueAreas[info.area]);
  if (info.summary) params.set('what-happened', info.summary);
  return `${REPO_URL}/issues/new?${params.toString()}`;
}

/** Link to the feature request form. */
export function featureRequestUrl(area?: IssueArea): string {
  const params = new URLSearchParams({ template: 'feature_request.yml' });
  if (area) params.set('area', issueAreas[area]);
  return `${REPO_URL}/issues/new?${params.toString()}`;
}
