import bugForm from '../../../.github/ISSUE_TEMPLATE/bug_report.yml?raw';
import featureForm from '../../../.github/ISSUE_TEMPLATE/feature_request.yml?raw';
import { bugReportUrl, describeBrowser, featureRequestUrl, issueAreas, REPO_URL } from './issueLinks';

const template = (name: string) => (name === 'bug_report.yml' ? bugForm : featureForm);

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  operaCros: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
};

describe('describeBrowser', () => {
  it('names the browser, its major version, and the OS', () => {
    expect(describeBrowser(UA.chromeWin)).toBe('Chrome 130 on Windows');
    expect(describeBrowser(UA.edgeWin)).toBe('Edge 130 on Windows');
    expect(describeBrowser(UA.firefoxLinux)).toBe('Firefox 132 on Linux');
    expect(describeBrowser(UA.safariMac)).toBe('Safari 18 on macOS');
    expect(describeBrowser(UA.safariIphone)).toBe('Safari 18 on iOS');
    expect(describeBrowser(UA.chromeAndroid)).toBe('Chrome 130 on Android');
    expect(describeBrowser(UA.operaCros)).toBe('Opera 115 on ChromeOS');
    expect(describeBrowser('curl/8.0')).toBe('Unknown browser on unknown OS');
  });
});

describe('bugReportUrl', () => {
  it('opens the bug form with browser, version, and where filled in', () => {
    const url = new URL(bugReportUrl({ appVersion: '1.2.3', userAgent: UA.firefoxLinux, hostname: 'latex.prestonhager.com' }));
    expect(`${url.origin}${url.pathname}`).toBe(`${REPO_URL}/issues/new`);
    expect(url.searchParams.get('template')).toBe('bug_report.yml');
    expect(url.searchParams.get('browser')).toBe('Firefox 132 on Linux');
    expect(url.searchParams.get('where')).toBe('Hosted site (latex.prestonhager.com)');
    expect(url.searchParams.get('extra')).toBe('App version: 1.2.3');
    expect(url.searchParams.has('area')).toBe(false);
    expect(url.searchParams.has('what-happened')).toBe(false);
  });

  it('adds the area and a fixed summary when given', () => {
    const url = new URL(bugReportUrl({ appVersion: 'dev', userAgent: UA.chromeWin, hostname: 'localhost', area: 'storage', summary: 'Saving failed.' }));
    expect(url.searchParams.get('where')).toBe('Local dev server');
    expect(url.searchParams.get('area')).toBe(issueAreas.storage);
    expect(url.searchParams.get('what-happened')).toBe('Saving failed.');
  });

  it('never carries the hostname, room id, or anything from the page URL', () => {
    const href = bugReportUrl({ appVersion: 'dev', userAgent: UA.chromeWin, hostname: 'my-fork.example.com' });
    expect(new URL(href).searchParams.get('where')).toBe('Other');
    expect(href).not.toContain('my-fork');
    expect(href).not.toContain('room');
  });

  it('only uses field ids and options that the issue forms have', () => {
    const bug = template('bug_report.yml');
    const url = new URL(bugReportUrl({ appVersion: 'dev', userAgent: UA.chromeWin, hostname: 'localhost', area: 'ui', summary: 'x' }));
    for (const key of url.searchParams.keys()) {
      if (key === 'template') continue;
      expect(bug, key).toContain(`id: ${key}`);
    }
    for (const option of Object.values(issueAreas)) expect(bug).toContain(`- ${option}`);
    expect(bug).toContain('- Hosted site (latex.prestonhager.com)');
    expect(bug).toContain('- Local dev server');
  });
});

describe('featureRequestUrl', () => {
  it('opens the feature form, with the area when given', () => {
    const feature = template('feature_request.yml');
    expect(new URL(featureRequestUrl()).searchParams.get('template')).toBe('feature_request.yml');
    const url = new URL(featureRequestUrl('preview'));
    expect(url.searchParams.get('area')).toBe(issueAreas.preview);
    expect(feature).toContain('id: area');
    expect(feature).toContain(`- ${issueAreas.preview}`);
  });
});
